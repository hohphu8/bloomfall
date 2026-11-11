import { test, expect } from "@playwright/test";
import { createGame, legalMoves, play, recordOf } from "../../src/engine.js";

test("sound and motion preferences persist, and audio closes on cleanup", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__audioContexts = [];
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    window.AudioContext = new Proxy(Audio, {
      construct(Target, args) {
        const context = new Target(...args);
        window.__audioContexts.push(context);
        return context;
      },
    });
  });
  await ready(page);
  await page.getByRole("button", { name: "Sound & motion" }).click();
  const supportsAudio = await page.evaluate(
    () => !!(window.AudioContext || window.webkitAudioContext),
  );
  if (supportsAudio)
    await page.getByRole("checkbox", { name: /Garden sounds/ }).check();
  else {
    await expect(
      page.getByRole("checkbox", { name: /Garden sounds/ }),
    ).toBeDisabled();
    await expect(page.locator("dialog")).toContainText("Sound is unavailable");
  }
  await page.getByRole("checkbox", { name: /Less movement/ }).check();
  await expect(page.locator("#game")).toHaveClass("less-motion");
  expect(
    await page
      .locator(".tile")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  expect(await page.evaluate(() => window.__audioContexts.length)).toBe(
    supportsAudio ? 1 : 0,
  );
  await page.getByRole("button", { name: /All set/ }).click();
  await page.evaluate(() => window.__bloomfall.dispose());
  if (supportsAudio)
    await expect
      .poll(() => page.evaluate(() => window.__audioContexts[0].state))
      .toBe("closed");
  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(64);
  await page.getByRole("button", { name: "Sound & motion" }).click();
  if (supportsAudio)
    await expect(
      page.getByRole("checkbox", { name: /Garden sounds/ }),
    ).toBeChecked();
  else
    await expect(
      page.getByRole("checkbox", { name: /Garden sounds/ }),
    ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: /Less movement/ }),
  ).toBeChecked();
});

async function ready(page, seed = "test-garden") {
  const state = createGame(seed);
  await page.addInitScript((record) => {
    if (!sessionStorage.getItem("test-seeded")) {
      localStorage.setItem("bloomfall.garden.v1", JSON.stringify(record));
      sessionStorage.setItem("test-seeded", "true");
    }
  }, recordOf(state));
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(64);
  await expect(page.locator("#game")).not.toHaveAttribute("g-cloak");
  return state;
}
async function move(page, pair) {
  await page.locator(`.tile[data-slot="${pair[0]}"]`).click();
  await page.locator(`.tile[data-slot="${pair[1]}"]`).click();
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
}

test("valid swaps, keyed identity, save, reload and undo agree with the deterministic engine", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const initial = await ready(page);
  const pair = legalMoves(initial.board)[0],
    expected = play(initial, ...pair).state;
  const survivor = initial.board.find((t) =>
    expected.board.some((n) => n.id === t.id),
  );
  const element = await page
    .locator(`[data-id="${survivor.id}"]`)
    .elementHandle();
  await move(page, pair);
  await expect(page.getByTestId("moves")).toHaveText("23");
  await expect(page.getByTestId("score")).toHaveText(String(expected.score));
  expect(await element.evaluate((el) => el.isConnected)).toBe(true);
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    expected,
  );
  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(64);
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    expected,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("moves")).toHaveText("24");
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    initial,
  );
  expect(errors).toEqual([]);
});

test("restart during animation cancels stale work and leaves a fresh saved board", async ({
  page,
}) => {
  const initial = await ready(page);
  const pair = legalMoves(initial.board)[0];
  await page.locator(`[data-slot="${pair[0]}"]`).click();
  await page.locator(`[data-slot="${pair[1]}"]`).click();
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page.getByRole("button", { name: "Start again", exact: true }).click();
  await page.waitForTimeout(900);
  await expect(page.locator(".tile")).toHaveCount(64);
  await expect(page.getByTestId("score")).toHaveText("0");
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    initial,
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("bloomfall.garden.v1")).moves,
    ),
  ).toEqual([]);
});

test("keyboard selection, hints, pause and dialogs stay usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await ready(page);
  const tile = page.locator('[data-slot="0"]');
  await tile.focus();
  await page.keyboard.press("Enter");
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-slot="1"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".selected")).toHaveCount(0);
  await page.getByRole("button", { name: "Show a possible match" }).click();
  await expect(page.locator(".hinted")).toHaveCount(2);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".pause-cover")).toBeVisible();
  await page.getByRole("button", { name: /Back to the garden/ }).click();
  await expect(page.locator(".pause-cover")).toBeHidden();
  await page.getByRole("button", { name: "How to play" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("replay is deterministic, return restores the own garden and invalid links fail softly", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const initial = await ready(page);
  let replay = createGame("another-garden");
  for (let i = 0; i < 3; i++)
    replay = play(replay, ...legalMoves(replay.board)[0]).state;
  await page.evaluate((record) => {
    void window.__bloomfall.replay(record);
  }, recordOf(replay));
  await expect(page.locator(".board-message")).toContainText(
    "Replay complete",
    { timeout: 20000 },
  );
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    replay,
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("bloomfall.garden.v1")).seed,
    ),
  ).toBe(initial.seed);
  await page.getByRole("button", { name: "Return to my garden" }).click();
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    initial,
  );
  await page.goto("/?replay=broken");
  await expect(page.locator(".tile")).toHaveCount(64);
  await expect(page.locator(".board-message")).toContainText(
    "could not be opened",
  );
});

test("blocked storage does not prevent a match", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(64);
  const pair = await page.evaluate(() => window.__bloomfall.legalMoves()[0]);
  await move(page, pair);
  await expect(page.getByTestId("moves")).toHaveText("23");
  await expect(page.locator(".save-status")).toContainText(
    "Storage unavailable",
  );
});

test("share link reconstructs the same run in a fresh context", async ({
  page,
  browser,
}) => {
  const state = await ready(page);
  const pair = legalMoves(state.board)[0];
  await move(page, pair);
  await page.getByRole("button", { name: /Share your replay/ }).click();
  const url = await page.locator("#share-url").inputValue();
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const friend = await context.newPage();
  await friend.goto(url);
  await expect(friend.locator(".board-message")).toContainText(
    "Replay complete",
    { timeout: 20000 },
  );
  expect(await friend.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    play(state, ...pair).state,
  );
  await context.close();
});

test("pause holds an unfinished move and rapid input cannot spend extra moves", async ({
  page,
}) => {
  const initial = await ready(page),
    pair = legalMoves(initial.board)[0];
  await page.locator(`[data-slot="${pair[0]}"]`).click();
  await page.locator(`[data-slot="${pair[1]}"]`).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    initial,
  );
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: /Back to the garden/ }).click();
  // Synthetic rapid clicks exercise the controller guard even during moving geometry.
  await page.locator('[data-slot="0"]').dispatchEvent("click");
  await page.locator('[data-slot="1"]').dispatchEvent("click");
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    play(initial, ...pair).state,
  );
});

test("stop replay during a cascade restores the saved garden without stale frames", async ({
  page,
}) => {
  const initial = await ready(page);
  let replay = createGame("cascade-garden");
  for (let i = 0; i < 3; i++)
    replay = play(replay, ...legalMoves(replay.board)[0]).state;
  await page.evaluate((record) => {
    void window.__bloomfall.replay(record);
  }, recordOf(replay));
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "Return to my garden" }).click();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    initial,
  );
  await expect(page.locator(".tile")).toHaveCount(64);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bloomfall.garden.v1")),
    ),
  ).toEqual(recordOf(initial));
});

test("a whole garden finishes, opens results and can undo the final move", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let expected = await ready(page, "finish-garden"),
    beforeLast;
  for (let i = 0; i < 24; i++) {
    const pair = legalMoves(expected.board)[0];
    beforeLast = expected;
    expected = play(expected, ...pair).state;
    await move(page, pair);
  }
  await expect(page.locator("dialog")).toBeVisible();
  await expect(page.locator(".result-score")).toContainText(
    String(expected.score),
  );
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    expected,
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    beforeLast,
  );
});

test("corrupt saves recover and a custom seed validates without losing the current garden", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("bloomfall.garden.v1", "{broken"),
  );
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(64);
  await expect(page.locator(".save-status")).toContainText(
    "Old save could not be opened",
  );
  const initial = await page.evaluate(() => window.__bloomfall.snapshot());
  await page.getByRole("button", { name: /Explore another garden/ }).click();
  await page.locator("#seed-input").fill("not valid!");
  await page.getByRole("button", { name: /Plant this garden/ }).click();
  await expect(page.locator(".input-error")).toContainText(
    "letters, numbers or hyphens",
  );
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    initial,
  );
  await page.locator("#seed-input").fill("my-little-garden");
  await page.getByRole("button", { name: /Plant this garden/ }).click();
  await expect(page.locator("dialog")).toBeHidden();
  expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
    createGame("my-little-garden"),
  );
});

test("touch swipes in both axes swap without scrolling the mobile board", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Uses Chrome touch dispatch; other engines exercise pointer/keyboard controls.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  let state = await ready(page);
  const cdp = await page.context().newCDPSession(page);
  for (const delta of [8, 1]) {
    const pair = legalMoves(state.board).find(([a, b]) => b - a === delta);
    expect(pair).toBeTruthy();
    const from = await page.locator(`[data-slot="${pair[0]}"]`).boundingBox();
    const to = await page.locator(`[data-slot="${pair[1]}"]`).boundingBox();
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const scroll = await page.evaluate(() => scrollY);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [end],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    state = play(state, ...pair).state;
    await expect(page.getByTestId("moves")).toHaveText(String(state.moves));
    await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
    expect(await page.evaluate(() => window.__bloomfall.snapshot())).toEqual(
      state,
    );
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
  }
  await expect(
    page.getByRole("button", { name: /Share your replay/ }),
  ).toBeVisible();
  await cdp.detach();
});

test("scope cleanup cancels animation and releases scheduled work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window),
      cancel = window.cancelAnimationFrame.bind(window);
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = await ready(page),
    pair = legalMoves(state.board)[0];
  await page.locator(`[data-slot="${pair[0]}"]`).click();
  await page.locator(`[data-slot="${pair[1]}"]`).click();
  await page.evaluate(() => window.__bloomfall.dispose());
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__bloomfall)).toBeUndefined();
  expect(await page.evaluate(() => window.__pendingFrames.size)).toBe(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bloomfall.garden.v1")),
    ),
  ).toEqual(recordOf(state));
  expect(errors).toEqual([]);
});
