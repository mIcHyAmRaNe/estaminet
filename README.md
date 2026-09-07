# Estaminet

Desktop client for the RK tavern chat — Tauri 2 (Rust) + Preact.

## Getting started

```bash
bun install
bun run tauri dev      # dev: Vite @ 1420 + Tauri window
bun run build          # tsc + vite build
bun run tauri build    # production bundle
```

## Structure

- `src/` — Preact + TypeScript frontend (hooks in `src/lib/hooks/`, constants in `src/lib/config.ts`)
- `src-tauri/` — Rust backend: Tauri commands (`commands/`), HTTP/WS networking (`network/`), logs and credentials (`utils/`)

## Notes

- Logs: `~/.estaminet/logs/taverne_<id>_<date>.log`
