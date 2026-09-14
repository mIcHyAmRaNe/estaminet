# Changelog

## [0.5.8] - 2026-09-14

### Removed
- Dead files: `src/styles/main.scss`, `src/components/layout/AppShell.tsx`,
  `src/components/ui/ThemeSwitcher.tsx` (+ `Moon` icon), `src/lib/utils/date-utils.ts`.
- Dead wrappers in `src/api/tauri.ts`: `tryAutoLogin`, `getSavedLogin`,
  `saveAccount`, `getSessionLogin`, `getLogDir`, `getFullLog` + `Api` type.
- Dead code: `AppResult`, `log_debug`, `CHAT_WSS_HOST`,
  `PLACE_RESERVED_DEFAULT`, credential `save/load/delete/delete_all` shims,
  `Session.remember`, `sound.ts` toggles, `groupIdsByMsg`, `isChopine` alias,
  `Tavern.image`, unused `config.ts` consts, dead CSS in `_auth.scss`/`room.css`,
  fluent `jsx-fix.d.ts` shims.
- Dead CSS blocks: `.field-hint`, `.auth-toggle`, `.remembered-*`,
  `.room-close-btn`, `.room-date-separator`, `.room-typing-indicator`,
  `.room-loading`, `.sound-popup`.

### Changed
- Frontend dedup: new `useStatusToast`, `usePopover`, `filterTaverns` +
  `recenterAfterFilter`, `mergePlacements` + `resetPresence` +
  `withTransientError`, `login-utils.ts` (`displayLogin`/`loginKey`),
  `CharacterCard`, `profileUrl` single source; constants centralized in
  `lib/config.ts` (`LIEU_EGLISE`, `CHAT_SLASH_ALLOWLIST`, `WHISPER_DEDUP_MS`,
  `RECONNECT_*`, `ECUS_PULSE_MS`, `PORTRAIT_WARN_TTL_MS`).
- Backend dedup: single `socket_io()` builder in `network/` (`send_event` /
  `send_payload` collapse 10× send blocks), `Session::close_tx` collapses
  3× teardown, portrait canonicalization shared (`canonicalize_portrait_json`
  + `code_visage_of`), `logs::append_line`, `keyring_soft`,
  `default_browser_headers`, `From<AuthError> for AppError`.
- Fixed unheard `ws-error` emits folded into `ws-closed` (was wedging
  `is_connected` true); `tauri.conf.json` version realigned 0.5.5 → 0.5.8.

## [0.5.7] - 2026-09-14

### Fixed
- Portrait JSON canonicalized at fetch layer (`extract_portrait_json`):
  `login` normalized to session login, `equipement` filtered to worn
  items (`miniature == "o"`). Renderer (`renderer.ts`) also filters
  before drawing, so self/others/display all stay aligned with the
  browser's 12-item payload.

## [0.5.6] - 2026-09-14

### Fixed
- `changeSalon` payload now matches the official browser exactly:
  portrait `login` normalized to session login (display-case drift fixed),
  `equipement` filtered to worn items (`miniature == "o"`), and raw send
  logged to the tavern file for byte-level verification.

## Unreleased

## [0.5.5] - 2026-09-13

### Fixed
- Own avatar seen by others is no longer the default male portrait:
  `ws_connect` now fetches your real portrait JSON (`ZoomPersonnage.php`,
  session cookies, `extract_portrait_json`) and sends it in `changeSalon`;
  falls back to the default only when the fetch fails
  (`config::URL_ZOOM_PERSONNAGE`, `commands/taverne.rs`,
  `commands/chat.rs`, `network/socket.rs`).
- Avatar no longer flashes the previous account on switch / room
  enter-leave: portrait cache is cleared on join, account pick, logout,
  and leave-to-taverns (`App.tsx`), and `AvatarPortrait` drops the old
  `<img>` synchronously on login change so the letter fallback shows
  until the fresh portrait loads.

## [0.5.4] - 2026-09-11

### Added
- New Estaminet app icon: all 16 Tauri variants regenerated from the
  1024px source (`bun run tauri icon`, `src-tauri/icons/`).

### Removed
- Unused assets: `src/assets/preact.svg`, `public/tauri.svg`,
  `public/assets/tavern-placeholder.svg`,
  `interieurTaverne/iconeMini_rentrer.png` + `iconeMini_sortir.png`.
- Dead code: `src/App.css` (unimported), `src/lib/store/chatStore.ts`
  (zero importers), `src/lib/fluent.ts`, `src/types/fluent.d.ts`,
  5 dead `icons.tsx` exports (`Send`, `PersonCircleOff`, `Translate`,
  `SpeakerOn`, `SpeakerOff`) + their `?raw` imports, unused
  `config.ts` exports (`CDN_IMAGES`, `TAVERN_BG`, `TAVERN_BG_NIGHT`,
  `CDN_TAVERN`, `PORTRAIT_RETRY_MS`, `COPIED_TTL_MS`, `PLACE_MAX`,
  `PLACE_SIMPLE_CANDIDATES`, `MSG_DISPLAY_MAX` dup).

### Changed
- `MSG_MAX_LEN` is the single canonical chat limit (`ChatRoom.tsx`
  updated); fixed `config.ts:55` two-consts-on-one-line glitch.
- `room.css` CDN backgrounds now use `var(--tavern-*)`; the 2
  remote-only button URLs are canonical in `config.ts`
  (`CDN_SEND_BTN`/`CDN_SEND_ICON`).
- Fluent JSX types canonical in `jsx-fix.d.ts` only (`vite-env.d.ts`
  block removed); `AvatarPortrait.tsx` console warns gated behind
  `import.meta.env.DEV`.

### Fixed
- `src/main.tsx` `@ts-ignore` removed: the root cause was
  `src/types/fluent.d.ts` shadowing Preact's real types and hiding
  `render`; deleting it restores proper type resolution.

## [0.5.3] - 2026-09-11

### Fixed
- The in-app updater never worked: release artifacts are signed with the
  CI minisign keypair, but the public key embedded in the app
  (`tauri.conf.json` `plugins.updater.pubkey`) belonged to a different
  keypair, so every download failed signature verification before
  install — the Install button silently reset the banner and looked
  dead. The embedded pubkey now matches the CI signing key. Every
  install ≤ 0.5.2 must update to 0.5.3 manually once; auto-update works
  from there on (same drift affected Linux and Windows alike).
- Updater failures are no longer swallowed: install and manual-check
  errors surface in the update banner and the About dialog
  (`update.failed`, FR + EN, red alert line) instead of silently
  resetting to "available"; the silent startup check is unchanged.

## [0.5.1] - 2026-09-10

### Fixed
- Fix Windows terminal spam: `attrib.exe` spawned on every WS event
  (message, typing, enter/leave) replaced by `windows-rs`
  (`SetFileAttributesW`) with one-time folder hide at creation
  (`src-tauri/src/utils/logs.rs`, `windows` 0.58 dependency).

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
