# Bundle follow-up — 2026-11-15

Bloomfall remains on **GyosJS 0.5.1** and the **CSP entry**. The only application change is `import * as Gyos from 'gyosjs/csp'` instead of importing the default all-API object. All property accesses are static, allowing Vite to remove more unused exports while keeping the existing `Gyos.scope(...)` usage. No game rules, save/replay format, CSP policy or dependency version changed.

Measured with Node 22.18.0 / Vite 6.4.6, production build, decimal kB:

| Main application JS | Before | After |
| --- | ---: | ---: |
| Raw | 245.88 kB | 203.37 kB |
| gzip (Node zlib) | 77.74 kB | 64.64 kB |

About 16.9% less gzip JavaScript in this build. These are **application + runtime** bytes, not library-only size or a measured loading-time improvement. Dynamic namespace access or passing the whole namespace around can retain more exports. The default object's `version` property is not a named export; this app does not use it.

The [cross-project report](https://github.com/gyosjs/gyosjs/blob/main/docs/performance-follow-up.md) records raw evidence and a runner for default/selected imports and standard/CSP variants. The standard build is smaller but changes the policy requirement; it was not adopted. No new core entry is needed for this saving.

Validation: engine tests, three-browser gameplay/lifecycle suite and production smoke (`npm run check`). Source reports the historical 0.5.0/0.5.1 timings separately in [dogfood notes](GYOSJS-DOGFOOD.md); this bundle measurement does not replace those observations with an FPS claim.
