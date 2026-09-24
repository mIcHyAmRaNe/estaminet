# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary (confirmed 2026-09-16): multi-account socializer. RK player who juggles saved accounts and recent taverns and wants fast re-entry.

Situation + job: open desktop window → pick account (saved passwordless or login + remember) → pick tavern (recents-first) → sit at a place and chat / participate in tavern rituals. Values not retyping credentials and not losing place on drops.

Other audiences: undecided. No secondary audience confirmed.

## Product Purpose

Desktop client for the Renaissance Kingdoms tavern chat (Tauri 2 + Preact), version 0.5.9.

What it does: auth with saved accounts, tavern select with recents, live room (messages, presence, places, typing, drinks / menus / tournée / ecus, kick / ban / unban, logs, updater).

Why it exists (confirmed differentiator): desktop speed + persistence versus playing the tavern in a browser on renaissancekingdoms.com — native window, saved accounts, recents, local logs, auto-reconnect.

Success means: returning user reaches their tavern room in seconds, stays connected through drops, and finds the same tavern rules as official.

## Positioning

The persistent desktop tavern: same RK tavern rules, but remembers accounts, recents, and logs and reconnects quietly. A neighboring browser flow could not truthfully copy saved passwordless sessions + recents + local log files + single-flight socket handling in one window.

## Operating Context

Three-phase flow confirmed in `src/App.tsx`: `auth` → `tavern` → `room`.

- Auth: `api.listAccounts`, `api.login`, `api.tryAutoLoginFor`, `api.removeAccount`, `api.logout` / `api.disconnect`.
- Tavern select: `api.getTaverns` (backend `src-tauri/resources/taverns.json` is source of truth), `DEFAULT_TAVERN_ID 85905`, recents (`estaminet.recentTaverns`, max 5).
- Room: `api.wsConnect`, `api.wsSend`, `api.ws_typing_start/stop`, `api.wsDisconnect`, `api.changePlace`, drink / tournée / alcool / kick / ban commands, `api.saveChatLog`.
- Protocol: socket.io `42["event", ...]`, `wss://chat.lesroyaumes.com/socket.io/`, HTTP base `https://www.renaissancekingdoms.com` (see `src-tauri/src/config.rs`).
- Portraits: Midas calques via `fetch_portrait_asset` Rust proxy → data URLs, vendored renderer in `src/lib/midas/renderer.ts`.
- Logs: `~/.estaminet/logs/taverne_<id>_<date>.log`.
- Dev: Bun, `bun run tauri dev` (Vite + Tauri window), `bun run build` (`tsc + vite build`).
- Languages shipped: `fr` default, `en` second (`src/lib/i18n/`, key `estaminet.locale`).

## Capabilities and Constraints

Confirmed functionality: saved + password login, tavern list + recents, socket connect / send / typing / disconnect, place select (8 default, 10 max), menus / drinks / tournée / ecus + pulse, accepte-alcool toggle, kick / ban / unban, flood-mute 30s (input disabled, not fatal), copy + log save, silent updater banner, portrait-warning toast.

Hard constraints (confirmed):
- Official parity: 290-char limit (`MSG_MAX_LEN`), socket.io behavior, French tavern rules, Midas portrait behavior. Do not diverge to “improve” the ritual.
- FR-first, EN second. Do not ship French regressions; do not invent copy tone beyond existing `fr.ts` / `en.ts`.
- Centralize constants (`src/lib/config.ts` ↔ `src-tauri/src/config.rs`); no hardcoded tavern IDs / URLs in components.

Explicitly undecided:
- Desktop-only scope was not confirmed as hard constraint in interview. Current build is Tauri desktop; mobile / pure-web scope remains open — do not assume.
- Success metrics, moderation policy beyond kick / ban, and offline behavior beyond logs: undecided.

Terminology: taverne / lieu / place, tournée, ecus, bredouille, alcool. Keep official terms.

## Brand Commitments

Name: Estaminet. Existing tavern decor assets bundled locally (`--tavern-*` vars in `src/styles/_base.scss` are single source for CSS). No confirmed voice guide, logo lockup, or marketing claims. Do not invent brand personality.

## Evidence on Hand

- Code: `src/App.tsx` (phases), `src/lib/config.ts`, `src-tauri/src/config.rs`, `src-tauri/src/commands/`, `src-tauri/src/network/`, `src/lib/midas/renderer.ts`, `src/components/chat/AvatarPortrait.tsx`.
- Docs: `README.md`, `AGENTS.md`, `docs/RELEASE.md`, `CHANGELOG.md`.
- i18n: `src/lib/i18n/fr.ts`, `src/lib/i18n/en.ts`.
- Absences future work must not fabricate: no testimonials, customers, benchmarks, pricing, or deployment claims on hand.

## Product Principles

1. Re-entry speed beats discovery — optimize for the returning regular, not first-run marketing.
2. Official parity first — match the RK ritual before adding convenience.
3. Persistence remembers — accounts, recents, logs, and socket state survive interruptions.
4. Quiet reliability — single-flight connects, voluntary-close vs abnormal-drop handling, no noisy failure.
5. FR-first clarity — plain tavern language; EN trails without forking meaning.

## Accessibility & Inclusion

Confirmed direction: French-first, keyboard-operable primary flow, readable contrast. No WCAG certification claimed. Specific audit gaps (focus indicators, screen-reader announcements, touch targets) are not yet assessed — assess in `audit` / `critique`, do not claim conformance.
