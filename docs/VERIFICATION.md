# Verification — 2026-10-20

Authoritative source: `D:\KHAMTONGCHAEUM`. Final target: Next.js 16.3.4 on Vercel, Lakebase Postgres through Neon, Gemini 3.5 Flash-Lite.

## Build and tests

`npm run build` passed after Neon setup:

```text
✓ Compiled successfully in 744ms
Finished TypeScript in 2.2s
✓ Generating static pages using 7 workers (5/5)
Route (app)
┌ ○ /
├ ƒ /api/check
├ ƒ /api/room
└ ƒ /api/status
```

`npm test` passed all 17 tests (0 failures). Coverage includes written homophones, comparison with only the previous word, strict original spelling, asynchronous rollback, score removal, restored turn, replay, stale round/word results, expired turns, concurrent submissions, command idempotency, host authorization, SQL compare-and-swap, cache upsert and model isolation.

The built app was started with `npm start`; it reported `Ready in 159ms`. The initial local-only check returned HTTP 200. After restarting with pulled Neon variables, both application smoke tests below ran against `backend: neon`.

## Neon service proof

Selected project: `lingering-hat-67473382`, organization `org-calm-resonance-38081632`, branch `production` (`br-icy-dust-azboc4uf`), region `aws-ap-southeast-1`, Postgres 18.

Initial inspection connected successfully and found no existing game columns or user tables. `npm run db:setup` then reported `Database schema is ready.` It creates only `rooms` and `syllable_cache` through a direct connection and transaction. No existing data was removed.

`neon deploy` succeeded:

```text
Auth complete (profile DEFAULT)
Applying to branch production (br-icy-dust-azboc4uf)
No changes — branch production already matches the policy.
Utilized services: Postgres
Pulled 3 Neon variables into .env.local
Postgres DATABASE_URL, DATABASE_URL_UNPOOLED
Branch NEON_BRANCH
```

`node scripts/smoke-online.mjs --require-neon`:

```json
{"backend":"neon","mode":"online","players":2,"authorization":"PASS","sharedState":"PASS","rollback":"PASS","reuse":"PASS","score":"PASS","roomEnded":true,"result":"PASS"}
```

This test uses two distinct player tokens through actual HTTP routes. It creates/joins a room, rejects guest-only attempts to start or play out of turn, submits both turns, reads shared state, rolls back a word and its descendant, reuses the reset word, confirms a point and ends the round.

`node scripts/smoke-live.mjs --allow-live --require-neon`:

```json
{"backend":"neon","model":"gemini-3.5-flash-lite"}
{"phase":"before check","words":["เรือ","ปลา","ปลาดาว","ท้องฟ้า","เมฆ"],"pending":4,"turn":"ทดสอบ บี"}
{"phase":"after check","seed":"เรือ","chain":["เรือ","ปลา"],"culprit":"ทดสอบ บี","repeated":["ปลา"],"reusable":["ท้องฟ้า","เมฆ"],"replay":"accepted","result":"PASS"}
```

This test makes actual Gemini requests. Four words were accepted and turns advanced before the model returned. The result then removed the offending word and its descendants and accepted replay of a reset word. Both tests left clearly named test rooms ended on the selected production branch.

## Browser verification

- Shared-device setup and actual model interaction were exercised in the in-app browser.
- Two independent browser tabs created/joined the same online room, alternated submissions and showed matching turns. Host rejection reset the descendant word and scores.
- Desktop visual review at 1280px and setup-page review in a 390px iframe passed. No horizontal overflow was visible; cross-iframe DOM measurement was unavailable, so this is a visual check.
- Browser checks initially ran on the original local adapter. The final Next.js/Neon migration was verified by production build and the real HTTP/Neon tests above; it was not verified on a physical phone or a published Vercel URL.

## Resolved issues

- Windows Sites npm helper resolved npm scripts incorrectly. Its platform is no longer used; standard Next/npm scripts now build correctly.
- Gemini 2.5 Flash-Lite returned 404 for new accounts and recommended 3.5 Flash-Lite. The replacement was verified live. A strict segmentation guard rejects standalone vowel fragments and rewritten spellings.
- `neon init -y` initially linked offline because no CLI account was signed in. The user completed browser OAuth, after which deploy/status/direct Postgres access succeeded.
- Obsolete Cloudflare types and connector files were archived under ignored `work/legacy-sites`; they are not part of the final build.
- Sites source publication was rejected by automatic approval review before any source upload. The user then explicitly chose GitHub/Vercel instead; no Sites source was uploaded or Site deployed.

## Remaining boundaries

- Thai segmentation has not been benchmarked across a large corpus; human review remains available.
- The application database connection, CLI and plugin installation are verified. The Neon MCP endpoint is configured by the enabled official plugin, but no Neon MCP tool call has run in this chat because the current tool set has not refreshed.
- Vercel deployment itself is user-managed and has not been performed here. Vercel needs its own environment variables; `.env.local` is intentionally excluded from GitHub.
