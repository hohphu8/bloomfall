# GyosJS 0.5.6 rollout — 2026-11-15

The app now pins the published `gyosjs@0.5.6` CSP runtime from the official npm registry, replacing 0.5.1. The existing namespace import stays in place. No game rules, save/replay format, CSP policy or input behavior changed.

Verified locally on Windows with Node 22.18.0, Vite 6.4.6 and Playwright 1.55.1 (installed Chrome plus Playwright Firefox/WebKit):

- `npm ci --registry=https://registry.npmjs.org` and `npm audit --audit-level=high`: passed, zero audit findings.
- `npm run check`: 5 engine tests, production build, 46 development browser tests and 1 production smoke passed. The 2 existing CDP-only skips on Firefox/WebKit remain intentional.
- Browser coverage includes hold/drag/cancel, deterministic moves and replay, save/reload/undo, storage failures, pause, sound preferences and cleanup.

The [bundle report](PERFORMANCE.md) retains its measured 0.5.1 baseline; those byte counts are not silently relabeled as 0.5.6 measurements. This local validation is not a deployment or physical-device Safari test.
