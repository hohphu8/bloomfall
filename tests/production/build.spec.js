import { test, expect } from "@playwright/test";
import { createGame, legalMoves, play, recordOf } from "../../src/engine.js";

test("built assets mount, play offline, save and omit development hooks", async ({
  page,
  context,
}) => {
  const state = createGame("production-garden");
  const pair = legalMoves(state.board)[0],
    expected = play(state, ...pair).state;
  const errors = [],
    failures = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  await page.addInitScript(
    (record) =>
      localStorage.setItem("bloomfall.garden.v1", JSON.stringify(record)),
    recordOf(state),
  );
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(64);
  expect(await page.evaluate(() => window.__bloomfall)).toBeUndefined();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await context.setOffline(true);
  await page.locator(`[data-slot="${pair[0]}"]`).click();
  await page.locator(`[data-slot="${pair[1]}"]`).click();
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("score")).toHaveText(String(expected.score));
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bloomfall.garden.v1")),
    ),
  ).toEqual(recordOf(expected));
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});
