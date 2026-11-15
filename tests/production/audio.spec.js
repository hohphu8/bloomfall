import { test, expect } from '@playwright/test';
import { createGame, legalMoves, play, recordOf } from '../../src/engine.js';

test('production audio follows cascades, persists volume and stays silent when muted', async ({ page }) => {
  const state = createGame('test-garden');
  const pair = legalMoves(state.board).find(pair => play(state, ...pair).combo > 1);
  expect(pair).toBeTruthy();
  const result = play(state, ...pair);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(record => {
    localStorage.setItem('bloomfall.garden.v1', JSON.stringify(record));
    window.__tones = [];
    const Audio = window.AudioContext || window.webkitAudioContext;
    window.AudioContext = new Proxy(Audio, {
      construct(Target, args) {
        const ctx = new Target(...args), create = ctx.createOscillator.bind(ctx);
        ctx.createOscillator = () => {
          const note = create(), start = note.start.bind(note);
          note.start = time => { window.__tones.push({ frequency: note.frequency.value, time }); start(time); };
          return note;
        };
        return ctx;
      },
    });
  }, recordOf(state));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sound & motion' }).click();
  await page.getByRole('checkbox', { name: /Garden sounds/ }).check();
  await page.getByRole('slider', { name: 'Sound volume' }).fill('80');
  await page.getByRole('button', { name: /All set/ }).click();
  await page.evaluate(() => { window.__tones = []; });
  await page.locator(`[data-slot="${pair[0]}"]`).click();
  await page.locator(`[data-slot="${pair[1]}"]`).click();
  await expect(page.getByTestId('score')).toHaveText(String(result.state.score));
  await expect(page.locator('#board')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.__tones.length)).toBeGreaterThan(result.combo * 3);
  await page.getByRole('button', { name: 'Sound & motion' }).click();
  await page.getByRole('checkbox', { name: /Garden sounds/ }).uncheck();
  await page.getByRole('button', { name: /All set/ }).click();
  const count = await page.evaluate(() => window.__tones.length);
  const next = legalMoves(result.state.board)[0];
  await page.locator(`[data-slot="${next[0]}"]`).click();
  await page.locator(`[data-slot="${next[1]}"]`).click();
  await expect(page.getByTestId('score')).toHaveText(String(play(result.state, ...next).state.score));
  await expect(page.locator('#board')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.__tones.length)).toBe(count);
  await page.reload();
  await page.getByRole('button', { name: 'Sound & motion' }).click();
  await expect(page.getByRole('slider', { name: 'Sound volume' })).toHaveValue('80');
  await expect(page.getByRole('checkbox', { name: /Garden sounds/ })).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/audio-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
