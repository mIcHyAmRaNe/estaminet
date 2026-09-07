# Changelog

## Unreleased

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
