import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const browser = await chromium.launch({
  channel: process.platform === "win32" ? "chrome" : undefined,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "no-preference",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.addInitScript(() => {
  localStorage.setItem(
    "bloomfall.garden.v1",
    JSON.stringify({ v: 1, seed: "audit-garden", moves: [] }),
  );
  const request = requestAnimationFrame.bind(window),
    cancel = cancelAnimationFrame.bind(window);
  window.__pendingFrames = new Set();
  window.requestAnimationFrame = (callback) => {
    const handle = request((time) => {
      window.__pendingFrames.delete(handle);
      callback(time);
    });
    window.__pendingFrames.add(handle);
    return handle;
  };
  window.cancelAnimationFrame = (handle) => {
    window.__pendingFrames.delete(handle);
    cancel(handle);
  };
});
await page.goto(process.env.BLOOMFALL_URL || "http://127.0.0.1:4186/");
await page.locator(".tile").first().waitFor();
const measurements = await page.evaluate(async () => {
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));
  const response = [],
    intervals = [];
  let additions = 0,
    removals = 0,
    retained = 0,
    survivors = 0,
    tracking = true,
    previous;
  const sample = (time) => {
    if (previous !== undefined) intervals.push(time - previous);
    previous = time;
    if (tracking) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      additions += [...record.addedNodes].filter((node) =>
        node.matches?.(".tile"),
      ).length;
      removals += [...record.removedNodes].filter((node) =>
        node.matches?.(".tile"),
      ).length;
    }
  });
  observer.observe(document.getElementById("board"), { childList: true });
  for (let i = 0; i < 24; i++) {
    const before = new Map(
      [...document.querySelectorAll(".tile")].map((el) => [el.dataset.id, el]),
    );
    const [a, b] =
      window.__bloomfall.legalMoves()[
        i % window.__bloomfall.legalMoves().length
      ];
    document.querySelector(`[data-slot="${a}"]`).click();
    const start = performance.now();
    document.querySelector(`[data-slot="${b}"]`).click();
    await nextFrame();
    response.push(performance.now() - start);
    while (window.__bloomfall.busy()) await nextFrame();
    await nextFrame();
    for (const element of document.querySelectorAll(".tile")) {
      if (before.has(element.dataset.id)) {
        survivors++;
        if (before.get(element.dataset.id) === element) retained++;
      }
    }
  }
  tracking = false;
  await nextFrame();
  observer.disconnect();
  const percentile = (items, p) =>
    [...items].sort((a, b) => a - b)[
      Math.min(items.length - 1, Math.floor(items.length * p))
    ];
  return {
    moves: 24,
    score: window.__bloomfall.snapshot().score,
    inputToNextRafMs: {
      median: percentile(response, 0.5),
      p95: percentile(response, 0.95),
      max: Math.max(...response),
    },
    rafIntervalMs: {
      samples: intervals.length,
      median: percentile(intervals, 0.5),
      p95: percentile(intervals, 0.95),
      max: Math.max(...intervals),
    },
    dom: {
      additions,
      removals,
      survivingTileComparisons: survivors,
      retainedIdentities: retained,
      finalTiles: document.querySelectorAll(".tile").length,
    },
    controller: window.__bloomfall.metrics(),
  };
});
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
await page.evaluate(async () => {
  window.__auditHarness = await import("/tests/browser/lifecycle-harness.js");
});
const lifecycle = [];
for (let cycle = 0; cycle < 12; cycle++) {
  await page.evaluate(() => {
    localStorage.setItem(
      "bloomfall.garden.v1",
      JSON.stringify({ v: 1, seed: "audit-garden", moves: [] }),
    );
    window.__auditHarness.remount();
  });
  await page.locator(".tile").first().waitFor();
  await page.evaluate(() => {
    const [a, b] = window.__bloomfall.legalMoves()[0];
    document.querySelector(`[data-slot="${a}"]`).click();
    document.querySelector(`[data-slot="${b}"]`).click();
    window.__bloomfall.dispose();
  });
  await page.waitForTimeout(100);
  await cdp.send("Runtime.discardConsoleEntries");
  await cdp.send("HeapProfiler.collectGarbage");
  const metrics = Object.fromEntries(
    (await cdp.send("Performance.getMetrics")).metrics.map((item) => [
      item.name,
      item.value,
    ]),
  );
  lifecycle.push({
    cycle,
    pendingFrames: await page.evaluate(() => window.__pendingFrames.size),
    retiredRootsRetained: await page.evaluate(
      () =>
        window.__auditHarness.retiredRoots.filter((ref) => ref.deref()).length,
    ),
    heapBytes: metrics.JSHeapUsedSize,
    nodes: metrics.Nodes,
    eventListeners: metrics.JSEventListeners,
  });
}
const result = {
  runtime: process.env.BLOOMFALL_RUNTIME_LABEL || "published gyosjs@0.5.1",
  measuredAt: new Date().toISOString(),
  browser: browser.version(),
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  mode: "Vite development, headless Chrome, full motion, no CPU/network throttling",
  limitations:
    "Input latency ends at the next rAF callback, not actual pixel presentation. Heap includes Vite and browser state; 12 cycles cannot prove leak-freedom. No mobile hardware or 60 FPS guarantee.",
  measurements,
  lifecycle,
  pageErrors: errors,
};
if (process.env.BLOOMFALL_HEAP === "1") {
  const chunks = [];
  cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) =>
    chunks.push(chunk),
  );
  await cdp.send("HeapProfiler.takeHeapSnapshot");
  await mkdir(".local", { recursive: true });
  await writeFile(".local/audit.heapsnapshot", chunks.join(""));
}
const reportPath =
  process.env.BLOOMFALL_REPORT || "docs/evidence/browser-audit.json";
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      ...result,
      measurements: {
        ...measurements,
        controller: { frames: measurements.controller.frames },
      },
    },
    null,
    2,
  ),
);
await browser.close();
if (
  errors.length ||
  lifecycle.some(
    (item) => item.pendingFrames !== 0 || item.retiredRootsRetained !== 0,
  ) ||
  measurements.dom.retainedIdentities !==
    measurements.dom.survivingTileComparisons
)
  process.exitCode = 1;
