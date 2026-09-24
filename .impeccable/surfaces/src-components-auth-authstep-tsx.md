---
version: 1
slug: "src-components-auth-authstep-tsx"
primary_target: "src/components/auth/AuthStep.tsx"
related_targets: ["src/components/tavern/TavernSelect.tsx","src/styles/views/_auth.scss"]
---

# Surface brief: auth flow (AuthStep + TavernSelect)

Scope: `src/components/auth/AuthStep.tsx` (+ related TavernSelect, _auth.scss). Mode: Operate.
Audience/job: returning RK regular re-entering in seconds — pick account → pick tavern → enter. Proof: saved accounts preselected, recents-first, one-click Connect/Enter. Constraints: FR-first copy untouched, 290-char/socket/Midas parity untouched, keep `--tavern-*` night assets, no slow/heavy chrome, keyboard-operable, contrast ≥4.5:1.

## Direction contract

THESIS: The tavern wall is the page, hung dead-center. Auth is reading the centered slate while flavor orbs drift the ring around it — not filling a left-docked form. User-pinned centered composition beats the prior left-anchor; the wall world stays.
OWN-WORLD: Night interior full-bleed with dark scrim; centered slate panel with lisere trim; chalk-white text, ecu-gold single accent; Cinzel headings, Ubuntu body, Mono counts; one ambient motion moment — seven circular flavor orbs (Tournée, Écus, Places, Bredouille, Alcool, Comptoir, Ardoise) on an elliptical ring, dim + soft behind the slate, sharp + full rounding the front. No wrapper, no kicker, no glass.
STORY: Regular opens window, sees centered slate with their names and orbs circling, hits Connect, slate swaps to wider centered tavern slate with recents + cadres, hits Enter. Understands: my place kept me a seat. Does: two clicks.
FIRST VIEWPORT: Wall photo full-bleed, centered; auth slate ~480px with Comptes list as chalk rows, Connect brass button, head row title + actions; orbit ring radii ~280–360px, orbs 74–118px disappearing behind (z 0, blur, 0.5 opacity) to reappear front (z 3, sharp). Tavern step reuses same wall, wider centered slate ~720px: recents chips as chalk tallies, carousel cadres breathing, no orbit.
FORM: User-pinned centered + orbit extension of the ardoise sur mur de nuit family (prior seed key 47fb877f); precisely specified narrow request so no concept roll — pinned direction beats the roll. Raises carried forward: night negative space, literal stenciled labels, material account states.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
