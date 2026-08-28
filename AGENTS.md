# kickflow — agent rules

## TESTING — OPEN `TESTING.md` BEFORE DIAGNOSING A DEAD FEATURE OR CUTTING A RELEASE (added 2026-08-28)

- **`F:\Laureth\products\kickflow\TESTING.md`** says which check answers which question: the offline
  gate (`npm run typecheck` · `npx vitest run` · `npm run build`), the three live probes under
  `tests/playwright/`, how to read `MATCH` / `MISS` / `NOT_CHECKABLE`, and how to obtain a logged-in
  session when one is needed.
- **The offline gate can be fully green while every feature is dead on kick.com.** That is not a
  hypothetical — the quality lock was dead for weeks behind a green suite, twice. A unit test builds
  its own DOM, so it can never notice Kick changing a selector, an icon path or a class string. Only
  a live probe can.
- **The browser runs `dist/`, not `src/`.** After editing `src/`, `npm run build`, and the owner
  must press ↻ on `chrome://extensions` — old entries also linger on the extension's error page
  until "Clear all" is pressed, so a stale warning is not evidence of a live failure.

## PROJECT FACT THAT MISROUTES WORK IF YOU GET IT WRONG (added 2026-08-19)

> `mirror-of: C:\Users\ydbil\.claude\projects\F--Laureth-products-kickflow\memory\kickflow-owner-runs-mode-a.md`
> `synced-to` that path 2026-08-19. One copy, for the cx loader boundary - cx never reads Claude's auto-memory.

- **The owner runs Mode A (`chatMode: 'own'`, KickFlow's own overlay list), NOT native.** He said so directly
  on 2026-08-07. **Never read the code default as evidence about him**: the default in
  `src/content/chat/feature-flags.ts:88` is `'native'`, and that is exactly the mistake that was made -
  `STATUS.md` recorded "native" from round 86 through round 96, the line was quoted into a brief as a
  measured fact, and a whole dispatch analysed the wrong subsystem and answered a question nobody had.
  When a brief needs his mode, take it from his own words or ask; one line of confirmation is cheaper than
  a wrong dispatch.

## GLOBAL HARD RULES — standing carrier for cx / ax / cursor (added 2026-08-01)

> Claude subagents receive `~/.claude/CLAUDE.md` automatically. **cx, ax and cursor do not** — they read only this
> file, so anything they can violate has to be reachable from here. Full text:
> `C:\Users\ydbil\.claude\CLAUDE.md` (readable by absolute path).
> Inlined below is only what an EXECUTING agent can break. **Edit both in the same change** or one silently goes
> stale. `mirror-of: C:\Users\ydbil\.claude\CLAUDE.md` · `synced-to C:\Users\ydbil\.claude\CLAUDE.md 2026-08-19`.

- **SECRETS NEVER REACH GIT.** No token, API key, cookie, credential blob, or `.env` value may enter a tracked
 file, stage, commit, push, log, fixture, or release artifact. Forbidden FILE names, the COMPLETE list of nine
 and never an abbreviation of it: `cred_blob_*.bin`, `snapshot*_*.json`, `agy_snapshots/`, `cookies_*.txt`,
 `*_cookies.txt`, `*.cred`, `token*.json`, `.env`, `*secret*`. **`cookies_*.txt` alone is NOT ENOUGH -
 `cred_blob` and `agy_snapshots/` are the two patterns that actually leaked on 2026-06-19.** For CONTENT the
 SHAPE is the match rule, never the bare prefix - settle a suspicion with the tool, never by eye:
 `python C:\Users\ydbil\.claude\scripts\secrets_audit.py --root <DIRECTORY> --quiet` takes a DIRECTORY, not a
 file, and empty output means clean. Scan `git status` and `git diff` before every commit, and add every one of
 those file patterns to `.gitignore`. Revoke a leaked token BEFORE deleting it - deleting the file leaves the
 token public. (Real incident: five Google refresh tokens went public in a repo, 2026-06-19.)
- **NO AI CO-AUTHOR.** Never add `Co-Authored-By: Claude`, `Co-Authored-By: Codex`, or a generated-by signature
 to a commit, PR, or file. Author and contributor identity remain Yasin Derya Bilgin only.
- **NEVER KILL A PROCESS BY NAME.** Never use image-name or process-name termination such as `taskkill /IM` or
 `Stop-Process -Name`. Capture and target a PID from your own process; re-scan verified children by PID.
- **NO WINDOW THE OWNER DID NOT ASK FOR.** He plays fullscreen games on this machine, and a console window
 that appears for a fraction of a second takes the foreground and drops him out of the game. **Never launch a
 `.cmd`, `.bat` or a PowerShell-shim wrapper from a background dispatch** - a batch file needs `cmd.exe`, a
 `.ps1` shim needs `powershell.exe`, both are console programs, and Windows hands each a NEW VISIBLE console
 when the parent has none. **Call the real target directly and delete the wrapper from the chain.** **A hiding
 flag is NOT a fix:** `CREATE_NO_WINDOW` and `-WindowStyle Hidden` apply only to the process you start and DO
 NOT REACH ITS GRANDCHILDREN. Verify by polling for a process owning a non-zero `MainWindowHandle`, never by
 checking for the flag - a creation flag never appears in a recorded command line. A window the owner ASKED for
 is outside this rule. Detail: `C:\Users\ydbil\.claude\AX_CX_FLASH_NOTE.md`. Owner directive 2026-08-13.
- **KEEP THE MACHINE USABLE.** Work must not make the machine freeze. Classify downstream local effect, choose
 the resource and FULL/LIGHT mode from measurement, control cost at the source, and run long commands in the
 background. There is no universal worker cap. Method: `C:\Users\ydbil\.claude\MACHINE_RESOURCE_RUNBOOK.md`.
- **NO BATCH LOCAL ML WITHOUT OWNER APPROVAL.** Ask whether one cropped frame is enough before batch OCR,
 speech-to-text, or vision work. If approved, use the smallest region, one sample, and explicit thread caps.
- **EVERY INTERFACE MUST BE RESPONSIVE.** The browser extension interface must be machine-verifiable: sibling
 rectangles do not intersect, child rectangles stay inside parents, labels fit their contents rectangles, and
 headers fit their labels. Assert against style-derived values. Do not shrink fonts, hide content, or clip overflow.
- **WRITE FOR THE AGENT, AND WRITE SMALL.** Durable text is read by an agent with no session memory. Use plain
 English, one fact per line, full paths and dates, one body per idea, and remove whole items instead of compressing
 load-bearing enforcement clauses.
- **KNOWLEDGE HIERARCHY.** `C:\Users\ydbil\.claude\KNOWLEDGE_HIERARCHY.md` is the canonical home and conflict
 order. Open it before writing, copying, or retiring a fact. Use one canonical home and one mirror per loader
 boundary; report extra copies instead of creating another body.
- **ARCHITECTURE REFERENCE.** `C:\Users\ydbil\.claude\CLEAN_ARCHITECTURE_REFERENCE.md` is binding. Read the
 relevant sections and run C1-C12 on implementation changes. Do not create a second architecture body here.
