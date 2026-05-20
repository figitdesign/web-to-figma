---
"@figit/dom-to-figma": patch
---

Internal cleanup surfaced by Knip: drop unused exports and dead type aliases, remove the no-longer-needed `@vitest/browser` devDependency (Vitest 4 only needs the provider package). No runtime or behavior changes. The published `.d.ts` no longer exposes a handful of internal-only types (e.g. `FigmaShadowEffect`, `FigmaBlendMode`, `DecorationRect`) that were exported but never consumed from outside the package.
