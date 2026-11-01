# Contributing to KickFlow

Thanks for taking the time. KickFlow is a small personal project, so issues and focused pull requests are the
easiest to take in.

## Build and test

```sh
npm ci
npm run typecheck   # must report 0 errors
npx vitest run      # all green; the test count should not go down
npm run build       # writes dist/
```

Load the folder as an unpacked extension (`chrome://extensions` > Developer mode > Load unpacked), then press
reload on the KickFlow card after each build and refresh the Kick tab. The browser runs `dist/`, not `src/`.

A green offline gate does not prove a feature works on kick.com: unit tests build their own DOM. Read
[TESTING.md](TESTING.md) before calling a Kick-facing change done; it explains the live anchor probe and the
Playwright gates under `tests/playwright/`.

## Pull requests

- Branch from `main`, keep one topic per pull request, and describe what you checked (offline gate, live probe,
  or a manual check on a channel).
- Add or update a test with every behaviour change. Kick selectors, icon paths and class strings live in
  `src/content/shared/selectors.ts` and the modules that own them; load them in tests and probes instead of
  copying the literal.
- Keep to the existing style: TypeScript, small modules under `src/content/chat/` and `src/content/player/`,
  user-facing text through `src/content/shared/i18n.ts` with both English and Turkish.
- Do not commit a logged-in browser profile, credentials or anything from `output/`.
- Commit `dist/` only when you are preparing a release.
- The README hero, feature table, picture gallery and social preview are generated from
  `docs/showcase/showcase.yml`; see [docs/showcase/UPDATING.md](docs/showcase/UPDATING.md) before editing them.

## Be kind

Assume good intent, keep feedback about the code, and remember that everyone here is a volunteer.
