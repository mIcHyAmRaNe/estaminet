# Changelog

## Unreleased

## 0.3.0

### Added
- Tavern typing indicator: emit `taverneDebuteMessage` /
  `taverneAnnuleMessage` via new `ws_typing_start` / `ws_typing_stop`
  commands; animated ellipsis on the typing player's card (seated and
  standing).
- Audible `message_tchat.mp3` cue on incoming room messages and received
  whispers, with a mute toggle in the chat header (persisted locally).
- Manual portrait refresh button in the chat header (clears the avatar
  cache and remounts the cards).
- Enter/leave system messages for unstable connections (relayed socket
  connect/disconnect, deduped against presence) and angry leaves
  (`taverneQuitteTaverneColere`).

- Auto-update via GitHub Releases (Tauri updater plugin, signed
  `latest.json` artifacts; restart to apply through the process plugin).
- Build provenance attestations plus per-platform SHA256SUMS files on
  every release; the release workflow publishes immediately (no draft)
  so update checks never 404.

### Changed
- Empty seats no longer render a doubled `cadreVide` frame inside the
  medallion; the outer card frame is kept.

## 0.2.0

### Added
- Multi-account support: save several username + password accounts, pick one
  from the list then Connect (no more disconnect/reconnect dance).
- Per-account removal from the account list; logout forgets only the
  current account.
- Two-step flow: 1) login (saved account or credentials) -> 2) tavern
  select (carousel + recent taverns) -> Enter joins the room.
- Recent taverns: global last-5 list, stored locally, shown above the
  carousel. Click selects, Enter still joins.
- New Tauri commands: `list_accounts`, `save_account`, `remove_account`,
  `try_auto_login_for`, `ws_disconnect` (leave room, stay signed in).

### Changed
- Credential store now holds an array of accounts in the existing
  `estaminet` keyring entry (same file fallback); legacy single-account
  entries migrate automatically on first read.
- `login` with remember off no longer wipes saved accounts.
- Leaving a room back to tavern select keeps the session (no re-auth);
  going back to accounts tears it down.

### Deprecated
- `try_auto_login` / `get_saved_login` kept as single-account shims,
  slated for removal next release.
