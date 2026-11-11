# GyosJS dogfood: Bloomfall

## Scope and outcome

Bloomfall is one complete, standalone reactive-DOM match-three game, built against the published `gyosjs@0.5.0` package. The rules engine uses no framework; GyosJS owns the rendered board and controls. No core source or npm package was patched to make this game work.

This workload exercises repeated keyed reordering, replacement and removal, multiple derived HUD values, animation cancellation, replay, browser storage and scope teardown. It does not establish suitability for a continuous physics simulation, canvas rendering, large boards, multiplayer or worker-heavy applications.

## Integration choices

- `Gyos.scope`, `signal`, `computed` and `batch` project engine frames into the UI. The engine's authoritative state remains in the scope closure. A partial animation frame is never saved as a completed move.
- `*for` with primitive `g-key="tile.id"` preserves individual button identity across falling and swapping. The game updates data; it does not replace board HTML manually.
- `gyosjs/csp` handles template expressions without requiring dynamic JavaScript evaluation. This alone is not a claim of compatibility with every strict CSP header: inline style bindings and the host's policy need separate review.
- One `AbortController` owns a move/replay run. Restart, undo, switching garden, stopping replay and scope teardown cancel old async work. A separate lifetime controller owns media-query, visibility and pagehide listeners. Audio closes on unmount.
- Keyboard uses actual buttons and roving tabindex. Native dialogs provide modal focus containment. Shapes and accessible labels identify the six pieces. Touch gestures are captured only inside the board; reduced motion is available in settings and follows the OS preference.

## Verification

Final validation on 2026-11-11: **5 engine tests passed**, **37 browser tests passed / 2 intentionally skipped**, **1 production smoke test passed**, and `npm audit --audit-level=high` reported **0 vulnerabilities**. The production test used its own port 4196 after port 4187 was found occupied; the existing server was left alone.

The checked-in tests cover:

| Area              | Evidence                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine invariants | 200 complete seeded games / 4,800 successful moves: no unresolved matches, valid unique tile IDs, legal next moves, decreasing move count, input immutability and identical replay reconstruction |
| Rules edge cases  | Invalid adjacency/row wrap, invalid swaps without move loss, overlapping match de-duplication, corrupted/unsupported/bounded replay input, deterministic reshuffle of a known dead board          |
| Browser gameplay  | Play, save/reload, undo, a complete 24-move game and results, custom-seed validation, damaged save recovery, blocked storage                                                                      |
| Async lifetime    | Restart mid-animation, pause/resume, rapid input, stop replay mid-run, cleanup while work is pending                                                                                              |
| Replay            | Another seed's replay, own-save preservation, restoring own board, invalid URL recovery, share link opened in a fresh browser context                                                             |
| Input/settings    | Narrow viewport without horizontal overflow, keyboard focus/selection, hints, native-dialog Escape, two-axis touch swipe on Chromium, persisted sound/motion settings, AudioContext closure       |
| Production        | Built assets load, development audit hooks are absent, a match and save succeed with networking offline after load, no gameplay requests                                                          |

The cross-browser suite runs Chromium, Firefox and WebKit. The physical-touch dispatch test is Chromium-only because it uses CDP; this is not a claim of iPhone/Android device certification. Desktop 1440 × 1000 and mobile 390 × 844 screenshots were inspected. The Windows Playwright WebKit build here exposes no Web Audio: its test verifies the explicit unavailable message and disabled sound option; Chromium/Firefox verify AudioContext creation and closure. Physical screen-reader and audio-output review are still useful follow-up checks, rather than implied by automation.

## Measured behavior

Raw results and environment: [browser-audit.json](evidence/browser-audit.json). This run used Windows, an Intel i5-10210U, Node 22.18.0 and headless Chrome 157, Vite development mode, full animations and no throttling. The workload was the deterministic `audit-garden` seed, 24 moves, score 3,480.

| Measurement                             | Result                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Surviving tile identity                 | 1,430 / 1,430 comparisons retained the same DOM object                                      |
| Final tile count                        | 64                                                                                          |
| Input handler through next rAF callback | Median 29.1 ms; p95 71.1 ms; maximum 267.8 ms                                               |
| rAF intervals                           | Median 16.6 ms; p95 49.8 ms; maximum 398.9 ms, over 1,206 intervals                         |
| Board child-list notifications          | 1,087 additions and 1,087 removals; these include reordering existing nodes                 |
| 12 mount/cleanup/GC cycles              | Zero retired roots retained via WeakRef and zero pending animation frames after every cycle |
| DOM nodes / listeners after cleanup     | Stable at 3,809 / 16 in the measured browser page, including the harness/template           |
| Used JS heap after explicit GC          | About 3.79–3.96 MB across the cycles; initial warm-up growth, not a universal memory bound  |

The 24 moves generated only **115 new tile IDs**, so the child-list count must not be reported as 1,087 newly allocated tiles. Most notifications represent retained nodes being moved. This is a concrete candidate for a later keyed-list optimization investigation. Before modifying the core, compare a minimal reproduction, actual retained-node moves and browser costs; preserve focused inputs, nested scope lifetime and transition semantics.

These measurements show visible scheduling outliers. They do **not** prove a constant 60 FPS or a mobile latency target. Input timing ends at a rAF callback, not confirmed pixel presentation. Instrumentation, development code, warm-up and other machine activity affect the results. A production trace on slower physical devices should precede performance promises.

An early lifecycle probe appeared to retain every old root. Heap inspection traced that to Playwright `waitForSelector()` handles held by the audit itself. Replacing those calls with locator waits removed the retention: the final evidence contains weak-reference checks. No GyosJS leak fix was justified by that false positive.

## What should follow for GyosJS

1. **Document this integration pattern.** A small guide on deterministic domain state, reactive view projections, cancellation and keyed DOM would help developers build interactive applications without inventing another API.
2. **Investigate keyed reordering cost with an isolated benchmark.** The identity behavior is correct, while mutation counts suggest room to reduce moves. Do not infer a core defect solely from this game's timing.
3. **Evaluate an optional smaller entry point.** This game's production JS bundle is about 243 KB raw / 76.7 KB gzip with the current published CSP entry. Check what is retained before proposing a split; preserving the existing public API is essential.
4. **Use a different second workload.** A board-game/replay app with a worker-owned rules engine would test async computation and cancellation boundaries that this 64-cell match-three game cannot establish.

No new GyosJS API or version bump is required for this delivery. This game remains on the published release. The next project should be chosen from the remaining roadmap after reviewing this game and its evidence.
