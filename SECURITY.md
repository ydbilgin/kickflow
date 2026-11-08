# Security policy

## Supported versions

Only the [latest release](https://github.com/ydbilgin/kickflow/releases/latest) receives fixes.

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting:
<https://github.com/ydbilgin/kickflow/security/advisories/new>

Do not open a public issue for a security problem. Include the KickFlow version, the browser and version, and
the steps to reproduce.

## What KickFlow touches

- **Permissions:** `storage` and `activeTab`, plus content scripts on `https://kick.com/*` only. No background
  worker, no optional permissions.
- **Page access:** it reads and changes the Kick page's chat and player DOM. Two scripts run in the page itself to
  observe Kick's own chat socket and forward public chat events (messages, deletions, bans, subscriptions,
  gifts) to the content script; they never read what the page sends.
- **Storage:** settings in `chrome.storage.local`; chat is held in memory for the session only (at most 30,000
  messages, three hours). Kick's caption preference and a small layout record are kept in the site's local
  storage.
- **Network:** requests go to Kick's own endpoints (channel, profile, chat history, videos), from the user's
  browser. KickFlow has no server, analytics or telemetry endpoint.
- **Downloads:** captured frames (PNG) and clips (WebM) are saved only when the user asks.

Reports about the bridge between the page and the content script, or any way a
web page could make KickFlow act on forged data are especially welcome.
