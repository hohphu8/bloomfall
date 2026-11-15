# Game audio feedback — 2026-11-16

The owner found the previous single low-gain sine note too quiet and detached from cascades. This change keeps optional, locally synthesized sound but gives gameplay phases different feedback:

- A short rising swap, a descending invalid-swap cue and a soft falling-piece tap.
- Each clear combines a short low pop with staggered triangle notes. Cascades rise through five pitch steps; additional combos remain capped.
- A 0–100% slider, default 65%, is saved independently of sound enabled/disabled. Old preferences remain valid. Sound stays off by default; zero volume is silent. Changing the slider previews a clear only when sound is enabled.
- A shared gain/compressor and a maximum of 24 active or scheduled voices bound overlapping reduced-motion cascades. Oscillators/gains disconnect on completion. There are no audio files or playback timers.
- Mute, pause, game cancellation and hidden tabs stop scheduled voices. A generation check prevents a late AudioContext resume from playing canceled cues. Scope cleanup stops voices and closes the context. Browsers without Web Audio keep the explicit unavailable state.

Audio is a separate application module (`src/audio.js`); gameplay, scoring, seeded replay and recording formats are unchanged. GyosJS stays at 0.5.6, with no core changes or new API required.

Validation includes unit checks for cancellation during asynchronous resume, voice limits, zero volume and closure; the existing 200 seeded full-game reconstruction test; browser checks for preference persistence and AudioContext cleanup; and production playback through a multi-cascade move followed by a muted move. Mobile settings layout was inspected.

Results: 7 unit/engine/audio tests passed, production build passed, 46 browser cases passed across Chromium/Firefox/WebKit with 2 existing Chromium-only touch skips, and both production browser cases passed. Windows WebKit exposes no Web Audio in this setup; its existing unavailable/disabled-state checks pass, while Chromium and Firefox exercise real AudioContext creation and cleanup.

Automated checks verify scheduling and lifetime, not perceived loudness on a particular speaker or headphone. The owner should listen at a comfortable device volume and adjust the saved slider. No claim of physical-device audio certification or a measured universal loudness increase is made.

Future gameplay work should be driven by play sessions: goals/levels, meaningful special pieces or a daily challenge are plausible follow-ups. Online leaderboards would require authoritative replay validation and abuse controls; this change does not add a server or remote score submission.
