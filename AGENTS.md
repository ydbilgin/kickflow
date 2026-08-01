# kickflow — agent rules

## 🔒 GLOBAL HARD RULES — standing carrier for cx / ax / cursor (added 2026-08-01)

> Claude subagents receive `~/.claude/CLAUDE.md` automatically. **cx, ax and cursor do not** — they read only this
> file, so anything they can violate has to be reachable from here. Full text:
> `C:\Users\ydbil\.claude\CLAUDE.md` (readable by absolute path).
> Inlined below is only what an EXECUTING agent can break. **Edit both in the same change** or one silently goes
> stale. `mirror-of: ~/.claude/CLAUDE.md` · `synced-to C:\Users\ydbil\.claude\CLAUDE.md 2026-08-01`.

- **🔑 SECRETS NEVER REACH GIT.** No token, API key, cookie, credential blob, or `.env` value may enter a tracked
  file, stage, commit, push, log, fixture, or release artifact. Revoke a leaked token before deleting it.
- **🚫 NO AI CO-AUTHOR.** Never add `Co-Authored-By: Claude`, `Co-Authored-By: Codex`, or a generated-by signature
  to a commit, PR, or file. Author and contributor identity remain Yasin Derya Bilgin only.
- **🚫 NEVER KILL A PROCESS BY NAME.** Never use image-name or process-name termination such as `taskkill /IM` or
  `Stop-Process -Name`. Capture and target a PID from your own process; re-scan verified children by PID.
- **🖥️ KEEP THE MACHINE USABLE.** Work must not make the machine freeze. Classify downstream local effect, choose
  the resource and FULL/LIGHT mode from measurement, control cost at the source, and run long commands in the
  background. There is no universal worker cap. Method: `C:\Users\ydbil\.claude\MACHINE_RESOURCE_RUNBOOK.md`.
- **🚫 NO BATCH LOCAL ML WITHOUT OWNER APPROVAL.** Ask whether one cropped frame is enough before batch OCR,
  speech-to-text, or vision work. If approved, use the smallest region, one sample, and explicit thread caps.
- **📐 EVERY INTERFACE MUST BE RESPONSIVE.** The browser extension interface must be machine-verifiable: sibling
  rectangles do not intersect, child rectangles stay inside parents, labels fit their contents rectangles, and
  headers fit their labels. Assert against style-derived values. Do not shrink fonts, hide content, or clip overflow.
- **✍️ WRITE FOR THE AGENT, AND WRITE SMALL.** Durable text is read by an agent with no session memory. Use plain
  English, one fact per line, full paths and dates, one body per idea, and remove whole items instead of compressing
  load-bearing enforcement clauses.
- **🔒 KNOWLEDGE HIERARCHY.** `C:\Users\ydbil\.claude\KNOWLEDGE_HIERARCHY.md` is the canonical home and conflict
  order. Open it before writing, copying, or retiring a fact. Use one canonical home and one mirror per loader
  boundary; report extra copies instead of creating another body.
- **🏛️ ARCHITECTURE REFERENCE.** `C:\Users\ydbil\.claude\CLEAN_ARCHITECTURE_REFERENCE.md` is binding. Read the
  relevant sections and run C1-C12 on implementation changes. Do not create a second architecture body here.
