# How to test KickFlow when something changes

Read this BEFORE diagnosing a "feature stopped working" report, and before any release.

KickFlow drives kick.com, a site we do not own. **The dominant failure mode is not a bug in our
code — it is Kick silently changing something our code recognises.** The unit suite cannot see that,
by construction, so this file exists to say which check answers which question.

---

## 1. Pick the check by the question you are actually asking

| The question | Run | Answers in |
|---|---|---|
| Did I break the code? | the offline gate (§2) | ~30 s |
| A feature seems dead on kick.com | the anchor probe (§3) | ~2 min |
| Did a player-bar change break the layout at some width? | the geometry gate (§2.1) | ~50 s |
| Did a chat change break layout, pointer or hydration? | the chat gates (§7) | ~2 min |
| Before a release | §2, then §3 | ~3 min |

**The offline gate can be fully green while every feature is dead on the live site.** That is not a
hypothetical: the quality lock was dead for weeks with a green suite, twice.

---

## 2. The offline gate — run this on every change

```
npm run typecheck      # 0 errors
npx vitest run         # all green; the total must not go DOWN
npm run build          # writes dist/
```

**What it proves:** the code compiles, the logic behaves, the bundle builds.
**What it cannot prove:** that any selector, icon path, class string, label or endpoint still
matches kick.com. A unit test builds its own DOM, so it agrees with itself.

**The extension the browser runs is `dist/`, not `src/`.** After changing anything under `src/`,
`npm run build` or you are testing yesterday's code. Then press ↻ on the KickFlow card in
`chrome://extensions` — an extension that has not been reloaded is still the old code, and stale
entries stay on the extension's error page until "Clear all" is pressed.

### 2.1 The geometry gate — run this after ANY change to the player bar or its CSS

```
node tests/playwright/player-bar-visual.mjs [--report=<file.json>]
```

Renders the real controls and the real stylesheet in a fixture of Kick's desktop shell, then
sweeps 128 viewport widths (800px up to 1996px) and asserts, at every one of them:

1. no two sibling controls in the bar intersect;
2. no control of ours escapes the bar;
3. **KickFlow does not move a single control Kick owns** — every Kick rect equals the rect it has
   when our cluster is absent, measured in the same pass;
4. every KickFlow control is reachable: mounted in the bar, or a row of the `⋯` overflow menu;
5. fullscreen is the terminal control of Kick's right group.

Every number is a real `getBoundingClientRect()`. **Never let it assert against a width, padding
or min-width constant that `bootstrap.ts` also owns** — a gate computed from the layout's own
constants agrees with itself while the screen is broken. The fixture's Kick-side geometry is a
dated snapshot of the live bar, so it can drift from kick.com; only a live run notices that.

Screenshots for a human land in `output/playwright/player-bar-<width>.png`. **They are not the
evidence** — the assertions are.

---

## 3. The live anchor probe — this is what catches Kick-side rot

```
node tests/playwright/kick-anchor-probe.mjs [channelSlug] [--headless]
```

Loads the real extension into a real Chromium against a real live channel. It discovers a live
channel itself from Kick's public livestreams endpoint; pass a slug to pin one. It prints one line
per anchor ("which of our ~31 anchors still match?") and exits **non-zero** if anything is `MISS`
or `UNLOADABLE`.

- `MATCH` — the anchor still matches live Kick.
- `MISS` — **real rot.** The evidence block in `output/playwright/kick-anchor-probe.json` carries the
  live alternative (e.g. every control-bar button's icon path), so the new value is read off
  reality, never guessed.
- `NOT_CHECKABLE` — the surface was not exercisable in this run (panel not open, stream has no
  captions, no session). **This is an honest answer, not a failure.** Do not "fix" it by loosening
  a check.
- `UNLOADABLE` — the probe could not load the value from the production module. Fix that first;
  every other verdict in the run is suspect.

Reference results: logged out **18 MATCH / 13 NOT_CHECKABLE**, logged in **21 / 10**, both with
0 MISS (2026-08-28).

Its mandatory realtime anchor runs the production `isKickRealtimeUrl` validator against observed
sockets. It rejects the legacy Pusher endpoint, viewer sockets, lookalike hosts and missing
observations. This checks the current native chat boundary; it does not prove message delivery
or account-gated surfaces. Socket evidence omits query strings and URL credentials.

---

## 4. Getting a logged-in session (needed for the session-gated anchors)

**Kick refuses an automated login (`429 POST /mobile/login`).** It is not bot detection (that is
403), and a normal browser logs in fine at the same moment. Do not fight it. Create the session by
hand instead:

1. Start a plain Chrome (no Playwright, no automation flags) with a **new, separate** profile
   directory, for example `--user-data-dir=<repo>/output/playwright/kick-test-profile`, and open
   `https://kick.com/`.
2. Log in by hand, then **close the window**.
3. Run the probe with `KICK_PROFILE_DIR=<that directory>`.

Never type a credential into a script, and never point a probe at your everyday Chrome profile:
one profile directory admits ONE browser process, so a running Chrome would block it and the probe
would hang with no browser at all. The `output/` folder is git-ignored; keep it that way.

---

## 5. Traps that have already cost real time

- **Never copy a Kick constant into a probe.** Load it from the production module. A probe with its
  own literal goes stale exactly when the thing it watches changes — this has now happened to a unit
  fixture AND to a probe, both times reporting green/wrong while the live site had moved.
- **Reveal the control bar ADJACENT to the measurement.** Kick re-hides it after a few seconds of
  pointer inactivity, so revealing and then waiting measures a hidden bar and reports false MISSes.
- **A `MISS` is only real if the surface was reachable.** An offline channel, a pre-roll ad or an
  unopened panel means `NOT_CHECKABLE`. A probe that cries wolf gets ignored, which is the same
  outcome as having no probe.
- **Throttle live runs.** kick.com rate-limits, and the limit is easy to hit with a handful of runs
  in half an hour. Pin a channel and run once rather than looping.

---

## 6. Adding a new "this feature died" warning

A give-up earns a `logger.warn` only when **all three** hold:

1. It is terminal — retries are exhausted and the code will not recover on its own.
2. The cause is a Kick-side anchor that stopped matching.
3. A user would experience the feature as dead.

Otherwise it stays at `debug`. **Repeating paths (an interval, a mutation observer) warn once per
controller, and a test must assert they do not fire twice.** Two warnings added on 2026-08-28 failed
rule 1 and 2 respectively and fired on healthy sessions; a channel that cries wolf is one the reader
stops reading, which destroys the property these warnings exist to create.

Every warning message must name the constant a human has to check.

## 7. Standalone chat regression gates (2026-10-23)

Run these from the repository root after changing chat rendering or the footer/navbar controls.
They use production modules and styles in a disposable browser; no logged-in profile is required.

```
node tests/playwright/chat-layout.mjs
node tests/playwright/chat-pointer.mjs
node tests/playwright/controls-hydration.mjs
```

The layout gate checks popout/composer boundaries, paused-reader geometry and fractional trim
offsets. The pointer gate checks held clicks and drags across asynchronous card loading,
scroll-follow suspension, immediate settings feedback and automatic player-menu dismissal.
The control gate checks eight viewport widths, real pointer reachability and unchanged native
footer/navbar child sequences before mounting, after clicks and after disposal.

For a bounded rendering replay, use
`node tests/playwright/chat-performance.mjs --soak-seconds=0`. Its three measured phases exercise
ordinary traffic, bursts, and scrolling/cards with a synthetic local video. Synthetic video and
headless animation-frame measurements do not establish native stream or physical display performance.

Pass `--output=<directory>` to these chat gates to choose an artifact directory. Set
`KICKFLOW_TEST_CHROMIUM` to an existing test Chromium executable if needed. As with the earlier
offline gate, these checks complement a live probe; they cannot detect future changes to Kick.
