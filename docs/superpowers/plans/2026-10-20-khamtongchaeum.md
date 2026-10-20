# Khamtongchaeum Implementation Plan

> **For agentic workers:** Use executing-plans inline in the current conversation; no subagent dispatch is needed.

**Goal:** Deliver both play modes with nonblocking syllable checks and safe rollback in the user's chosen folder.

**Architecture:** A pure game state machine is shared by a versioned Postgres room service and the React interface. Separate check requests own model work so submission never waits on inference. Round and word identities protect live play against stale results.

**Tech Stack:** TypeScript, React 19, Next.js 16/Vercel, Neon Postgres via pg, Gemini REST API, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-20-khamtongchaeum-design.md`

## Global Constraints

- Authoritative project root: `D:\KHAMTONGCHAEUM`.
- Only written syllables in the immediately previous word participate in automatic rejection.
- AI never judges semantic connection or noun validity; players do.
- Advance immediately after submission; never pause the turn clock for validation.
- No paid fallback and no client-exposed API keys.
- Use the user-selected Vercel deployment and Supot77/KHAMTONGCHAEUM repository. Keep Neon configuration and existing secrets intact.

## Task 1: State machine and meaningful regression tests

Files: `lib/game.ts`, `tests/game.test.ts`.
Interface: `createGame`, `submitWord`, `skipTurn`, `applySegments`, `rollback`, `scoreboard`, `publicGame`, `advanceTimeout`.

- [ ] Write tests using `node:assert/strict`, e.g. `assert.deepEqual(duplicates(['จันทร์'], ['จันทน์']), [])` and `assert.deepEqual(duplicates(['ปลา'], ['ปลา','ดาว']), ['ปลา'])`.
- [ ] Run `node --experimental-strip-types --test tests/game.test.ts`; confirm imports fail before implementation.
- [ ] Implement room-independent state mutation, immutable IDs, exact written comparison, rollback event, provisional score and restored turn.
- [ ] Test lost descendants, downstream reuse, old-round results, manual appeal and timeout boundaries.

## Task 2: Durable room service and provider

Files: `lib/rooms.ts`, `lib/gemini.ts`, `lib/storage.ts`, `database/schema.sql`, `app/api/room/route.ts`, `app/api/check/route.ts`, `app/api/status/route.ts`, `.env.example`, tests for service/provider.
Interface: `RoomStore.read/insert/write`, `RoomService.command/read/check`, `LanguageProvider.seed/segment`.

- [ ] Define an in-memory CAS store for tests; verify two clients cannot submit the same turn, non-host cannot start/reject, and public state contains no token hashes.
- [ ] Implement SQL CAS with bounded retries, command deduplication, membership tokens, room leases and retry deadlines.
- [ ] Implement JSON-schema Gemini calls with a 25-second abort deadline and lossless written segmentation validation; never trust a model boolean about duplicates.
- [ ] Add SQL schema and generate immutable SQL migrations with `npm run db:generate`.
- [ ] Test provider output validation and retry/no-key behavior without making billable requests.

## Task 3: Responsive game interface

Files: `app/page.tsx`, `app/components/*`, `app/globals.css`, `app/layout.tsx`, `public/favicon.svg`, `DESIGN.md`.
Interface: authenticated room client with stable operation IDs, one poll and one check request per client, session restore and monotonic version handling.

- [ ] Build setup for shared/online/create/join and timer controls.
- [ ] Build lobby/start, current-word board, pending status, timer, submit/pass, player scoreboard and round end.
- [ ] Add rollback notice with culprit and reset list; host rejection/manual-resolution controls; accessible rules/settings dialogs.
- [ ] Show missing provider configuration and explicit human-check mode; no fabricated AI output.
- [ ] Verify no horizontal overflow at 390px, keyboard labels/focus, timer and pending submissions across two clients.

## Task 4: Validate and deliver

Files: `README.md`, `docs/VERIFICATION.md`, `neon.ts`, `vercel.json`, tracked source and deployment artifact.

- [ ] Run unit/service tests, `tsc --noEmit`, Next.js production build, and apply Neon schema.
- [ ] Open the real preview, test both modes and screenshot desktop/mobile. Fix observed defects, then rerun affected checks.
- [ ] Document exact commands, game rules, Gemini setup, private audience limits and actual validation outcomes.
- [ ] Synchronize exact source, package and publish private using the existing Site ID. Preserve any returned saved-version/deployment IDs.
- [ ] Hand off verified URL and chosen source folder, with live-LLM or access limitations called out.

## Final platform update
The user selected Vercel/GitHub and an existing Neon production project. The initial Sites platform was superseded. CLI 8.8.0/plugin 2.3.0, Neon deploy, schema creation, 17 tests, production Next build and both Neon end-to-end smoke tests are complete. See docs/NEON_SETUP.md and docs/VERIFICATION.md. Vercel publication is user-managed.
