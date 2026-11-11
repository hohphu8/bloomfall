# Bloomfall

Build one complete, standalone match-3 game to exercise GyosJS reactive DOM. No server, account, advertising, multiplayer, or game engine in the first version. No remote push: the owner will choose the repository.

## Product

- A warm botanical board, 8 × 8, six visually distinct pieces, 24 moves.
- Daily seed and random gardens. Match at least three; cascades multiply points. Invalid swaps cost no moves. Stuck boards reshuffle deterministically.
- Keyboard, tap and swipe controls; reduced motion and optional synthesized sound.
- Automatic local save after settled moves, resume, undo, confirmed restart.
- Deterministic replay encoded into a shareable URL. Replay never overwrites the player's saved game.
- Honest offline/local-storage status, accessible instructions and results.

## Implementation and evidence

1. Pure deterministic engine and invariants; initial local commit.
2. GyosJS keyed board, computed HUD, cancellation-aware animation controller; playable local commit.
3. Browser regressions, responsive/visual review, lifecycle and performance probes; document findings and final local commit.

State is authoritative in the engine. UI frames are projections. Renderer does not own moves, random numbers or scoring. Stable tile IDs permit DOM identity checks. Every async run has a generation/lifetime so restart, undo, replay stop and disposal cannot apply stale frames. Saves store a validated move log and are reconstructed through the engine.

Do not add core APIs for convenience. Reproduce any suspected GyosJS defect independently, check the documented contract, then add a regression before changing private source. Keep app mistakes distinct from framework defects.

Performance results must include environment, workload and limitations. Inspect frame latency, DOM identity/churn and teardown trends; do not claim universal FPS or leak-freedom from one run.
