# Rounds, challenges, and word database implementation plan

> **For agentic workers:** Use the executing-plans workflow task by task in the existing checkout. No delegation is needed.

**Goal:** Deliver the approved five-set elimination game, timed human challenges, cumulative points, and reusable player-reviewed word analyses.

**Architecture:** The existing compare-and-swap room service owns all competition state and authorizes every action. Pure competition and challenge modules calculate transitions and points. The versioned SQL word cache is consulted before linguistic analysis; only host-confirmed proposals can replace draft analyses with player corrections.

**Tech stack:** Next.js 16, TypeScript, Node.js 24, pg/Neon, Gemini; existing Vercel configuration remains intact.

**Spec:** `docs/ROUNDS-AND-CHALLENGES.md` contains the approved timing, scoring, title exceptions, cache and review behavior.

## Constraints

- One round is exactly five sets; each set eliminates players until one remains.
- Final-three placement: one point each, then winner gets two additional points. Challenge winner gets two additional points.
- Debate 60 seconds per participant, vote 30 seconds; AI adjudicates only tied or absent votes.
- Active history is private. Homophones with different written syllables remain allowed.
- Keep `.env.local`, Neon plugin/MCP configuration, existing data, and the pg pool integration intact.

## Tasks

- [x] Add `lib/word-analysis.ts`, combined provider analysis, `word_analysis_cache`, and SQL contract tests. Preserve the old cache table and protect confirmed entries from model overwrites.
- [x] Update `lib/game.ts` and `lib/rooms.ts` to apply cached classifications, close losing word phases, hide history in public responses, and accept post-phase review proposals with host confirmation.
- [x] Add `lib/competition.ts` for survivor turns, set transitions and point ledgers. Test eight-player placement scoring, all five sets and cumulative totals.
- [x] Add `lib/challenge.ts` for server-time debate/voting, eligibility and results. Bind requests to challenge IDs; test stale votes, online impersonation, concurrent idempotency and vote privacy.
- [x] Add `challenge-panel.tsx` and `round-review.tsx`; update game board, rules and CSS. Verify a full shared-device challenge and review flow in the browser and at mobile width.
- [x] Apply non-destructive schema migration to Neon. Verify four authenticated HTTP sessions, five sets, real linguistic analysis, cache reuse, and real tie adjudication.
- [x] Run final test/build and diff checks; record service and browser verification evidence. Delivery uses the existing repository and branch after the final secret scan.
