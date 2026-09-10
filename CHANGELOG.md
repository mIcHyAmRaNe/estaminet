# Changelog

## Unreleased

## 0.5.0

### Added
- Portrait calques load through a new `fetch_portrait_asset` Rust proxy
  (oxv CDN bytes returned as `data:` URLs): the canvas stays untainted
  with no CORS checks, missing calques resolve as a rejected promise
  instead of webview console noise; webp→png fallback server-side with
  mime sniffing, SSRF guard to the oxv images root, no session cookies
  leaked to the CDN.
- Manual update check in the About dialog (ArrowSync button with spinning
  state, up-to-date note, install-and-restart path when an update is
  pending); the shell silent startup check is untouched (new `autoCheck`
  option, manual-only instance never auto-checks; single-flight guard
  against concurrent checks).
- Floating status toast on the auth and tavern-select phases: pinned to
  the top of the window so it never shifts the form layout, visible
  ~3.2 s then a 0.4 s fade/slide exit, `prefers-reduced-motion`
  respected; errors stay inline and persistent.
- Static session identity chip on the tavern-select header (Person icon,
  username with ellipsis, green presence dot) replacing the session line.
- Recent taverns render as a single row: chips that do not fit entirely
  are hidden (no partial chips ever), re-measured on resize.
- Footer presence list as a floating layer portaled to `document.body`:
  escapes `.room-chat` `overflow:hidden`, positioned from the trigger
  rect, flipped above/below on available space, viewport-clamped,
  repositioned on scroll/resize, Escape closes, keyboard-focusable with
  a visible focus ring.

### Changed
- Chat input `maxlength` synced to the server limit (`MSG_DISPLAY_MAX`
  500 → 290, counter uses the same constant).
- Room seat layout repositioned (middle row and bottom rows lifted so
  cards no longer clip) with short-viewport guards under 700 px / 640 px
  heights; positioning only, same base transform preserved.
- Midas renderer fetches calque bytes via the Rust proxy (no
  `crossOrigin`/CORS); new `ArrowSync` Fluent icon and
  `about.checkForUpdates` / `about.checking` / `about.upToDate`,
  `session.connectedAs` strings (FR + EN); `status.sessionOpen`
  shortened to the identity label used by the chip.

## 0.4.0

### Added
- Social/economy parity with the official tavern client:
  - Tavern menu popup (dishes, ingredients, prices) built from
    `taverneMajMenus`; ordering reuses the existing `taverneCommandeRepas`
    (`/manger <id>`) emit.
  - Écus balance in the chat header (from `taverneMajPerso infos.argent`)
    with a +/- pulse on spends; optimistic spend is corrected by the
    authoritative purse event.
  - Per-player context menu (hover a portrait): offer a drink
    (`taverneOffreVerre`), whisper (prefills `/w`), open the official
    character sheet.
  - Tournée générale: dedicated emit plus an animated overlay notification
    with the official illustration.
  - Drink / meal / round chat lines rendered with their official mini
    icons.
- Herbal-tea rules: when the target (or you) refuses alcohol, offering or
  ordering "a drink" becomes a tisane and costs no écus (labels adapt, no
  optimistic spend); tournée générale serves a glass to everyone who
  accepts alcohol and a tisane to the others — you are served even alone.
- Drunkenness: header gauge on the official ~0–20 scale
  (`taverneChangeTauxAlcool`), proactive alcohol-consent toggle
  (`taverneAccepteAlcool`), per-player acceptance map drives the
  verre-vs-tisane labels.
- Moderation: kick / ban / unban entries in the player menu (rights are
  server-enforced, errors surface inline), blocking fatal overlays for
  kick / ban and `taverneRafraichirPage`, and a 30 s input mute for flood
  (`taverneBanFlood`) instead of a fatal ban.
- Church mode (`lieu === 'eglise'`): all drink UI is hidden.
- "X écrit…" typing line near the input, and linkified player names
  (`.lien-perso`) opening the official character sheet.
- Reserved-seat status badges (tavernier / noble / marié / curé) derived
  from the tavern ground type (`lieu`).
- Sound controller with four modes (tout / son / musique / aucun),
  persisted locally with migration from the legacy boolean toggle.
- Header context menu (Fluent `MoreVertical` icon) grouping copy chat log,
  portrait refresh, sound modes and language; the presence counter moved
  into a status-bar footer at the bottom of the room.
- New Tauri commands: `taverne_offre_verre`, `taverne_tournee_generale`,
  `taverne_accepte_alcool`, `taverne_kick`, `taverne_ban`, `taverne_unban`.
- Complete `taverneErreur` mapping (all 15 official codes).
- Entrance polish: staggered fadeInUp on seat cards, hover highlights,
  popup fades, `prefers-reduced-motion` respected.

### Changed
- Tavern images are now bundled locally (20 assets in
  `src/assets/images/interieurTaverne/`: background, portrait frames,
  chat zone, feature and status icons) instead of being fetched from the
  game CDN; portrait rendering stays remote by design.
- Font housekeeping: removed 4 unused Ubuntu `.ttf` files (the woff2 set
  stays), replaced the dead `--font-sans` token with `--font-body`, and
  deleted the stale `_room.scss` duplicate (`room.css` is the single
  source).

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
