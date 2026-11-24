# Changelog

Newest first. Each entry says what you notice after updating.

## 1.13.0 (2026-11-24)

### Player

- **Every stream opens at the highest quality.** New switch *Open every stream at the highest quality* (Player
  tab, on by default). A quality you pick by hand, in Kick's own menu or on KickFlow's chip, holds for that stream
  only and the chip says *THIS STREAM*; the next stream opens at the highest again. Before, one 720p pick carried
  over to every later stream. Switch it off to keep the old behaviour (your last pick is remembered). It works
  even when the quality button itself is off.
- **The quality chip shows the right rendition at once** after a pick in Kick's gear menu, and the menu no
  longer reopens while it closes. The highest available rendition is checked again for each stream, and that
  hidden check no longer reveals the player bar.
- **Automatic catch-up is gentler.** It no longer drains the live buffer, comes back after you seek to live,
  and returning to live keeps the rewind window you had. The speed menu stays open while you switch Auto.
- The seek line is found on Kick's current player again.

### Chat

- **Removed messages stay visible in Kick's own chat too**, with one notice per deleted message. A banned
  user's line that arrives just after the ban is marked as well. The list of bans and deletions now outlives the
  chat history.
- **Replies:** replying works through Kick's own message box, after switching channel inside the page, in
  locked chats and while a reply thread is open. A quoted line always jumps to its message; the side
  conversation (*Thread*) has its own button. When a reply cannot be sent, the line says what to do (for
  example, reload the page).
- **@mentions** are drawn in the mentioned chatter's name colour; links are KickFlow green.
- **Paused chat:** the pill shows how many new messages arrived.
- **User cards:** avatar previews, Kick's default picture for viewers without one, steadier loading, badges and
  emotes that behave like Kick's own.
- KickFlow's chat stays in place under Kick's drops and rewards dialogs and other overlays, and no longer pauses
  itself on long streams.
- New switch *Hide quick emote bar* (Chat tab, on by default): hides the emote shortcuts above the chat input;
  the emote picker still works.

### Pages

- **A "Türkçe" chip on category pages**, next to Kick's language filter: one click shows only Turkish streams.
  The choice is remembered and applied again on other categories. Click the chip again, or use Kick's own
  language menu, to show all languages.

### Turkish

- The popup and the status lines read in plain Turkish when the interface language is Turkish. English text is
  unchanged.

### Performance

- Less work on every Kick page: no page-wide `:has()` restyles, timers that run only while something is
  visible, fewer layout reads during chat scrolling, and a closed settings panel that no longer rewrites the page
  every second.
- The shipped scripts carry no inline source map: `dist/content.js` is about 0.9 MB instead of 2.5 MB. Debug
  build: `KICKFLOW_SOURCEMAP=inline node build.mjs`.

### In the code, no switch yet

Ultrawide fill and ambient side bands, a loudness leveller and per-channel volume ship in the code but stay off:
this release has no switch for them. Channel, category and tag blocking is on but does nothing until a block
list exists, and this release has no editor for that list.

## 1.12.1 (2026-10-23)

Chat and player fixes. See the [v1.12.1 release](https://github.com/ydbilgin/kickflow/releases/tag/v1.12.1).
