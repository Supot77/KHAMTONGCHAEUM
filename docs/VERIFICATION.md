# Verification — 2026-10-20

Source: `D:\KHAMTONGCHAEUM`. Next.js 16.3.4, Node 24.18.0, Vercel target, Neon Postgres, Gemini 3.5 Flash-Lite. This replaces the original 17-test report for the earlier continuous-play prototype.

## Final build and deterministic tests

`npm test`:

```text
ℹ tests 36
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

Coverage includes written homophones, adjacent-only comparison, delayed non-noun/duplicate results, hidden active history including archived phases, uncertain classifications, cache hits for accepted and rejected words, human confirmation, model overwrite protection, stale results, turn expiry, survivor turns, eight-player finalist points, all five sets, cumulative rounds, online authorization, vote privacy, stale challenge IDs, timed debate/voting, AI tie-break dispatch, command idempotency and real SQLite SQL/CAS behavior.

`npm run typecheck` passed. The final `npm run build` also includes TypeScript checking and reported:

```text
✓ Compiled successfully in 6.8s
Finished TypeScript in 3.3s
✓ Generating static pages using 7 workers (5/5) in 734ms
Route (app)
┌ ○ /
├ ƒ /api/check
├ ƒ /api/room
├ ƒ /api/status
└ ○ /_not-found
```

The final build was started using `npm start`: `Ready in 292ms` on port 5173.

## Neon schema and persistence

The existing user-selected production project and pooled pg integration were preserved. `node scripts/setup-db.mjs` reported `Database schema is ready.` It added only `word_analysis_cache`; the existing room and legacy syllable tables were retained. No tables or data were deleted.

Read-only inspection after testing returned:

```json
{"connected":true,"legacySyllableRows":11,"analysisRows":[{"source":"model","count":15},{"source":"players","count":1}]}
```

`source=model` is a reusable draft. `source=players` requires host confirmation and cannot be overwritten by a model cache write. Tests use named QA rooms and synthetic player sessions on the selected Neon branch.

## Four-session, five-set HTTP proof

`node scripts/smoke-competition.mjs --require-neon`, rerun against the final build:

```json
{"backend":"neon","sets":5,"challengeAuthorization":"PASS","votePrivacy":"PASS","concurrentVoteIdempotency":"PASS","humanConfirmation":"PASS","elimination":"PASS","scores":[{"name":"QA เซ็ต โฮสต์","score":0},{"name":"QA เซ็ต คน 1","score":5},{"name":"QA เซ็ต คน 2","score":7},{"name":"QA เซ็ต คน 3","score":15}],"savedAcrossSessions":"PASS","result":"PASS"}
```

The challenger earns two extra points. Third/final survivors earn placement points and each set winner earns two additional points. A read through another authenticated session confirms persisted scores. The test submits the final vote twice concurrently using the same command ID and proves points are awarded once. Guests can propose word corrections but cannot confirm global cache writes.

## Real model and database reuse

`node --experimental-strip-types scripts/smoke-analysis.mjs --allow-live` checked twelve classifications: วิ่ง, การวิ่ง, สุข, ความสุข, แดง, สีแดง, ส้ม, การบ้าน, ถ้าเราเจอกันอีก, แปลรักฉันด้วยใจเธอ, ฉันเดินไปซื้อข้าวที่ตลาดทุกวัน, ความโต๊ะ.

Initial run: twelve expected classifications passed using three model calls, with complete second reads from Neon. Repeating the script against the stored entries reported:

```json
{"cases":12,"modelCalls":0,"secondRead":"all database hits; no model calls","result":"PASS"}
```

This proves classification decisions and cache reuse, not perfect segmentation. The model divided a portion of the rejected long sentence incorrectly while preserving all letters. This remains an unconfirmed draft; the post-phase review flow is provided to correct such errors. The prompt now includes an example addressing that boundary. No test claims all Thai readings or all titles are validated.

`node scripts/smoke-live.mjs --allow-live --require-neon` used a model-selected seed, accepted four pending submissions immediately, then detected the duplicate and eliminated its author:

```json
{"phase":"after check","seed":"เรือ","chain":["ปลา"],"culprit":"ทดสอบ บี","repeated":["ปลา"],"reusable":["ท้องฟ้า","เมฆ"],"survivors":2,"elimination":"PASS","summary":"PASS","result":"PASS"}
```

`node scripts/smoke-tiebreak.mjs --allow-live` generated a genuine 1–1 vote and invoked the real model. It returned `connected=true`, explaining that fish inhabit the sea; the app eliminated the challenger and awarded two bonus points. The run reported `result=PASS`.

The first tie-break attempt hit the old 25-second upstream timeout. After raising it to 45 seconds, with a 55-second browser check timeout, 65-second job lease and existing 60-second Vercel route budget, the retry passed. Model failures keep the challenge unresolved and retryable. pg also emits an advisory about future SSL-mode semantics; connections and tests succeeded with the current verified TLS behavior.

## Browser verification

Through the actual shared-device UI: created four players, submitted a word, confirmed the earlier word disappeared from active play, opened a challenge from an eligible player, completed both speaking turns, cast two votes, observed elimination and the correct three points for the owner (two challenge plus one finalist), proposed a noun/segmentation review and explicitly confirmed it. The UI displayed that the word was saved for future use.

At 390×844, the review form and controls fit the viewport; a read-only DOM check found no elements overflowing the right edge. The viewport override was reset. No browser error logs were observed. Screenshots are delivered in the conversation output folder.

## Deployment boundary

The app was tested locally against the real Neon service and model. No Vercel production deployment or production URL was verified in this run. The existing Neon plugin/MCP, CLI login, env files, Vercel/Next configuration and database credentials were preserved. All credentials remain excluded from Git.
