# AGENTS.md — Estaminet

> **Package manager: Bun — not npm.** All commands use `bun`.

## Quick start

```bash
bun install
bun run tauri dev      # dev: Vite @ 1420 + Tauri window (beforeDevCommand = bun run dev)
bun run build          # tsc + vite build
bun run tauri build    # production bundle
```

> `src-tauri/tauri.conf.json` already sets `beforeDevCommand: "bun run dev"` and `beforeBuildCommand: "bun run build"`. Do not replace with `npm`.

## Stack

- **Desktop:** Tauri 2 (Rust + webview), `src-tauri/` (Cargo)
- **Frontend:** Preact 10 + TypeScript 6 (strict) + Vite 8, `src/`
- **Runtime:** Bun (bun.lock), `package.json` scripts are `vite` / `tauri`

## Project structure

```
src/
  main.tsx                 # entry
  App.tsx                  # thin shell: auth vs tavern view
  api/tauri.ts             # typed Tauri invoke wrappers (api.*)
  lib/
    config.ts              # constants: taverns, limits, timeouts, URLs
    types.ts               # shared types (Tavern, ChatMessage, props)
    hooks/                 # useTaverne, useAutoScroll, useBredouille
    store/                 # (reserved) app state if app grows beyond hooks
    utils/                 # message-utils, date-utils, icons, guards
    i18n/                  # fr (add locales here)
  components/
    auth/LoginForm.tsx
    chat/ { ChatRoom, MessageList, ChatHeader, AvatarPortrait }
    layout/AppShell.tsx
    ui/ { ... }
  styles/
    _base.scss  views/ { _auth.scss, room.css }  index.css -> base+views
src-tauri/src/
  lib.rs, main.rs, error.rs
  commands/ { auth, chat, taverne, logs }
  network/ { client, session, socket, auth, models }
  utils/ { cookies, logs }
  config.rs                # consts: URLs, USER_AGENT, limits
```

## Conventions

- **No `@ts-nocheck` / `@ts-ignore` in new code.** Keep `strict: true`.
- Hooks live in `src/lib/hooks/` (single source). Do not duplicate in `src/hooks/`.
- Centralize constants in `src/lib/config.ts` (Rust: `src-tauri/src/config.rs`). No hardcoded tavern IDs / URLs in components or sockets.
- Errors: Rust uses `AppError` (thiserror) → mapped to `String` for Tauri; frontend `api.*` surfaces typed errors. Use `utils/logs.rs` + `utils/cookies.rs` — no duplication in `network/socket.rs`.
- Chat protocol: `42["event", ...]` (socket.io). Keep builders in `commands/chat.rs` (`socket_io()` helper).
- Styles: SCSS via Vite. `_base.scss` holds tokens, `views/*` holds view CSS. Keep `index.css` as `@import` barrel.

## Tauri commands (lib.rs)

`get_taverns`, `get_taverne_places`, `get_portrait_json`, `fetch_portrait_asset`, `login`, `try_auto_login`, `get_saved_login`, `is_connected`, `get_session_login`, `logout`, `disconnect`, `ws_connect`, `ws_send`, `change_place`, `save_chat_log`, `get_log_dir`, `get_full_log`

Events: `ws-message`, `ws-connected`, `ws-closed`, `ws-error`.

## Common tasks

```bash
bun run dev              # Vite only
bun run tauri dev        # full app
cargo check --manifest-path src-tauri/Cargo.toml
bunx tsc --noEmit
```

## Notes

- Logs: `~/.estaminet/logs/taverne_<id>_<date>.log` (see `utils/logs.rs`)
- Midas portrait: vendored renderer in `src/lib/midas/renderer.ts` (calque bytes via `fetch_portrait_asset` Rust proxy → data: URLs — CORS-free, canvas untainted; webp→png fallback server-side) → offscreen canvas → `toDataURL` → `<img>` in `AvatarPortrait.tsx` (WebKitGTK canvas repaint bug workaround). No `window.RAR` / no external midas.js.
- Chat limits: `message.len() > 290` rejected (see `commands/chat.rs`)
- `src-tauri/target/` and `node_modules/` are ignored — do not commit
