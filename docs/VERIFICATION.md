# Room departure, fine Thai reading policy and shared dictionary editor — 2026-10-21

Online leave removes the member and revokes the old session; ownership passes to the earliest remaining member. Active departures eliminate once and retain the five-second continuation or finish the set. Spectator departures preserve the current clock; pending sends and debates recover safely. Empty rooms and shared-device rooms are deleted with a revision guard. Only departed ID/name are retained for historical word evidence, with no departed token hash.

The model prompt now explicitly requires กรุงเทพมหานคร → กรุง / เทพ / ม / หา / น / คร and มหาสมุทร → ม / หา / ส / มุทร, preserving original written spans and existing noun/title rules. New results use the v2 fine-syllable policy; cached/human-confirmed words are not bulk rewritten.

Added /dictionary and authenticated /api/dictionary over the existing word_dictionary table. All current room members, including non-hosts, can edit spelling, segments and category. Membership is rechecked inside the database transaction, stale updates return 409, and dictionary/history changes roll back together. Renaming preserves the old spelling as rejected with a suggestion and never deletes legacy data. The page disables background model checks for that page instance. Existing round-review host confirmation remains separate.

Related validation only: 13 room-leave tests and 10 dictionary/prompt tests passed, plus 3 selected existing review/provenance/human-overwrite regressions (26 total). Build compiled, passed TypeScript and generated 8 pages including /dictionary and /api/dictionary. No full-suite run. A test-only missing callback brace was fixed before the final passing dictionary run.

Live Gemini smoke (one two-word request, no database writes):
```json
{"model":"gemini-3.5-flash-lite","words":[{"word":"กรุงเทพมหานคร","syllables":["กรุง","เทพ","ม","หา","น","คร"],"category":"noun"},{"word":"มหาสมุทร","syllables":["ม","หา","ส","มุทร"],"category":"noun"}],"dictionaryWrites":0,"result":"PASS"}
```

Real HTTP and Postgres transactions on the isolated Neon QA branch passed:
```json
{"guestDictionaryEdit":"PASS","table":"word_dictionary","syllables":["ม","หา","ส","มุทร"],"staleEditStatus":409,"hostTransfer":"PASS","departedSessionRevoked":"PASS","leaveDuringSet":"PASS","emptyAndSharedRoomsDeleted":"PASS","modelCalls":0,"result":"PASS"}
```

Two independent browser sessions also proved a non-host could save มหาสมุทร with the fine segmentation in the dictionary UI. The original host then used the actual exit dialog, returned home, disappeared from the other member's roster, and that member gained the host badge and controls. The last member exited successfully. Screenshots: word-dictionary-editor.png and room-host-transferred.png in task outputs. QA data alone was edited; no production data, schema, env variables or provider credentials were changed.

The free-provider research and quota-aware routing proposal is in FREE-MODEL-ROUTING.md. Groq/OpenRouter candidates are not installed or routed to yet and their Thai accuracy was not tested. Cerebras currently documents a time-limited trial rather than an ongoing free allowance. Existing pg SSL future-compatibility advisory remains; Vercel production deployment is not verified.

---

# Pause clocks during word submission — 2026-10-21

The UI freezes its displayed time at send, displays a spinner/pending state and prevents double submission. The server persists a bounded reservation before dictionary lookup. Other players' reads cannot time out this reserved turn. Final commit uses the current server clock for the next player's full turn budget. Lookup failures restore the reserved remainder; transport retries reuse commandId. A 3-second server receipt grace absorbs short network delay near zero; no client-supplied click timestamp is trusted. Abandoned reservations recover after 35 seconds, and late results cannot revive cancelled/ended turns. Model analysis stays asynchronous and does not pause play.

Changed: lib/game.ts, lib/rooms.ts, board and send hook, rules, package test scripts, tests/submission-clock.test.mjs, README and word-checking documentation. Pending public state excludes the submitted text and internal request ID. No schema, environment, dictionary or production data changes.

Only related tests were run for this change:
- npm run test:submission: 11 passed, 0 failed. SQLite-backed service tests cover both modes, delayed dictionary reads crossing the original deadline, full next-turn budgets, failure/refund/retry, grace boundaries, overlapping identical retries, foreign commands, stale leases, cancellation, untimed games and invalid submissions.
- Six selected existing regressions passed: expired submission, concurrent/authorized turn submission, stable command IDs and three cached/asynchronous word-check pipeline cases.
- Three selected full-word duplicate regressions passed, including both modes through the SQL store.
- npm run build passed compilation, TypeScript and all six pages. A stale expired request also cannot commit or release a newly reserved request reusing its old ID. No full-suite run.

Browser QA used the isolated Neon branch through a local-only proxy delaying submit requests by 2 seconds. The UI displayed a frozen 15-second clock and “พักเวลา กำลังส่งคำ” while retaining the old word; after success it showed เหล็ก and the next player. Screenshots: submission-clock-paused.png and submission-clock-success.png in task outputs. The exact near-zero acceptance boundary and slow server processing were proved with controlled clocks in service tests. The first browser attempt to wait for the 2-second label missed its interaction window and timed out without submitting; this is not counted as a successful near-zero browser test. Proxy Origin forwarding was corrected without changing application Origin validation. No model calls were requested by browser QA.

The existing pg SSL future-compatibility advisory remains. Vercel production deployment is not verified.

---

# Selectable round length and exact-word history check — 2026-10-21

Current change: choose 3 or 5 separate sets per round at room creation. The server rejects other values; existing rooms default to five. Each set clears its live word/reset/review history, returns all players and starts a fresh seed. Set scores aggregate into round scores, then round points reset when the next round starts; room totals persist. The final board displays the round winner or tied winners.

A synchronous whole-word check compares the new normalized spelling against the entire live chain in this set, including the opening and pending words. It excludes removed/reset words and previous sets. A match eliminates immediately and records original word ID, original speaker, original turn and current turn. Exact duplicates do not wait for or request another language analysis. Adjacent written-syllable checks and differently spelled homophones retain their rules. Evidence appears in notices, reset history and the five-second countdown without disclosing the full chain.

Changed files: lib/game.ts, competition.ts, rooms.ts, verification-label.ts; home, board, countdown and rules/footer UI; package scripts; tests/rounds-duplicates.test.mjs; scripts/smoke-rounds-duplicates.mjs; README and word-checking documentation. No schema, env or production dictionary changes.

Validation was deliberately limited to related functionality per the user request:

- npm run test:rounds: 19 passed, 0 failed (11 new tests plus 8 continuation/word/score regressions).
- Three selected pipeline regressions passed: immediate cached noun checks without a key/during cooldown, dependent neighbor recheck, and cache progress during an in-flight model request. No full-suite run for this change.
- npm run build passed compilation, TypeScript and all six pages.
- Real HTTP on the isolated Neon QA branch: shared-device 3 sets and online 5 sets, each repeating เหล็ก → แมว → เหล็ก. All eight sets detected the exact duplicate immediately with speaker and turn-1 evidence. Fresh set histories accepted เหล็ก again; final round scores were [3,9] and [5,15]. Round 2 restarted at set 1 with previous round summaries preserved. The smoke script requested zero model calls (manual language checking); SQL unit cases separately cover cached automatic language checking.

Browser QA also completed all three sets through the actual UI: selected 3 sets, repeated เหล็ก → แมว → เหล็ก in each set, observed the immediate original-speaker/turn-1 notice, accepted the first เหล็ก again after each new-set reset, and saw the final round winner with [3,9] points and the new-round (3 sets) control. Screenshots: round-set-selector.png and three-set-round-duplicate-result.png in the task outputs.

Test fixtures initially mixed the fake service clock with a real SQL-store clock and allowed the random seed to equal the first submitted word; fixtures were corrected to use the same clock and deterministic opening. All final targeted checks pass. The unchanged pg SSL-mode future-compatibility advisory remains. Vercel production deployment has not been verified.

---

# Automatic set continuation and database openings — 2026-10-21

Latest change: after an elimination with multiple survivors, a server-timed five-second overlay announces the next survivor and retains the last usable word. Any authenticated reader can advance it, with CAS preventing double starts. Old-phase results cannot eliminate again; pending tails are archived and released. Set winners still end their set. Initial nouns come from the dictionary, without a model call. No schema or environment-file changes.

Changed areas: game/challenge/room state, SQL adapter and storage, Gemini seed removal, board/countdown/challenge/review components, styles, tests, smoke scripts and README/WORD-CHECKING documentation.

Verification: npm test passed 73/73 tests with zero failures; npm run build compiled, passed TypeScript and generated all six pages. Real HTTP against the isolated Neon QA branch completed five sets and ten automatic continuations:

```json
{"sets":5,"automaticContinuations":10,"countdownMs":5000,"guestCanResume":"PASS","sameAnchor":"PASS","fullTurnBudget":"PASS","databaseOpenings":"PASS","modelCalls":0,"scores":[0,5,5,15],"result":"PASS"}
```

Browser QA: shared-device three-player room opened with database noun หน้า; surrender showed centered five-second countdown naming the next player and same anchor. Screenshot saved as automatic-continuation-countdown.png in the task outputs. Existing production data was not modified by this QA workflow. No Vercel production deployment URL was verified.

Known separate gap: exact whole-word reuse after intervening turns is not checked across the live chain. Current syllable checks compare adjacent words only. Additional duplicate checking is proposed, not implemented by this change.

---

# Word verification pipeline — 2026-10-21

This is the current report for the cache-first runtime and explicit model-review upgrade. Earlier reports below describe previous versions. The overnight set-4 incident cannot be conclusively reconstructed from the surviving evidence; the change addresses verified queue coupling, missing verdict visibility and incomplete five-set coverage rather than claiming a proven single root cause.

## Changes

- Exact-word dictionary reads happen on submit, independently of model configuration, in-flight jobs or backoff. Known non-nouns return type/reason/suggestions immediately; known nouns compare as soon as their neighbor is ready.
- Language status and game verdict are separate. Reverse arrival rechecks dependent neighbors; ended phases retain explicit historical findings without changing scores. Pre-upgrade facts missing a new verdict are reconciled without model calls.
- Active words take priority over archived work. Per-word SQL claims prevent ordinary concurrent-room duplicate requests; leases expire for crash recovery. Final application re-reads authoritative data to protect human corrections.
- Added model-independent `word_dictionary`, append-only `word_analysis_history` and expiring `word_analysis_jobs`. Legacy tables are preserved. Application pg/SQLite adapters transact dictionary/history writes together.
- Added authenticated `/api/review`, persisted request/answer/error states, stale proposal guards, retry, side-by-side proposal/model result, and explicit host confirmation. Model review alone never writes the dictionary. New stable UI keys preserve the expanded form and edits while responses arrive.

## Deterministic tests and build

`npm test`: **65 tests, 65 passed, 0 failed**. This includes 22 new regressions exercising immediate cache hits without a key or during cooldown, reverse results, independent cache progress while a model call is in flight, automatic five-set cached/new-word elimination, historical findings, live-word priority, cross-room single-flight, uncertain/error handling, exact written homophones, migration idempotency, provenance rollback, human overwrite protection, authenticated reviews, failure/retry, stale requests and model revisions.

`npm run typecheck` passed. Production `npm run build` passed with routes `/`, `/api/check`, `/api/review`, `/api/room`, `/api/status`, `/_not-found`. Final output after the last source change:

```text
ℹ tests 65
ℹ pass 65
ℹ fail 0
✓ Compiled successfully in 735ms
Finished TypeScript in 1990ms
✓ Generating static pages using 8 workers (6/6) in 769ms
```

The final production build was started with `npm start` on port 5173: `Ready in 164ms`. A direct production read through the final SQL adapter also confirmed the existing word แมว is found under a different model name and a missing-word lookup succeeds.

## Migration on Neon QA branch, then production

Created the isolated branch `qa-word-pipeline-20261021` (`br-silent-sky-az8af4ee`) from the existing production branch. It expires automatically at `2026-10-22T23:59:00Z`. The user's env files and CLI context were not replaced.

Ran the versioned schema through `scripts/verify-word-migration.mjs` on that branch, then applied the same migration to production. Both reported:

```json
{"legacyRows":138,"legacyUnchanged":"PASS","dictionary":138,"history":138,"modelIndependentRead":"PASS","humanProtection":"PASS","globalLease":"PASS","qaWritesRolledBack":true,"result":"PASS"}
```

The legacy cache was hashed before and after migration to prove its contents remained unchanged. PostgreSQL tests of reads across model names, protected human upserts and lease ownership used transaction-rollback fixtures. No user word was deleted or overwritten by those fixtures. The added tables and backfill remain on production for the new app.

## Real Neon/Gemini HTTP five-set proof

Started the production build against the isolated Neon QA branch on port 5174 (`Ready in 140ms`; final UI build restart `Ready in 183ms`). `node scripts/smoke-word-pipeline.mjs --allow-live` returned:

```json
{"sets":[{"set":1,"seed":"ช้าง","word":"ปลาดาว","source":"database","result":"duplicate"},{"set":2,"seed":"เรือ","word":"ปลาดาว","source":"database","result":"duplicate"},{"set":3,"seed":"เรือ","word":"ปลาดาว","source":"database","result":"duplicate"},{"set":4,"seed":"เรือ","word":"ปลาดาว","source":"database","result":"duplicate"},{"set":5,"seed":"เรือ","word":"ปลาดาว","source":"database","result":"duplicate"}],"cacheHits":10,"review":{"verdict":"revise","syllables":["ปลา","ดาว"],"reason":"ผู้เล่นเสนอให้รวมเป็นพยางค์เดียว ซึ่งขัดกับหลักการแบ่งพยางค์ตามการอ่าน จึงต้องแก้ไขกลับเป็นสองพยางค์"},"explicitHumanConfirmation":"PASS","scoresFrozenDuringReview":"PASS","scores":[15,5],"result":"PASS"}
```

Gemini supplied all five seeds and the actual review response. The ten cached word submissions did not call classification. Separate deterministic five-set tests mix cached nouns and new deferred-model words, so the HTTP cache-only result is not represented as proof of all asynchronous timings.

## Browser proof and genuine new-word analysis

Through the actual UI, created a named QA room, started normal automatic mode, submitted a cached noun, submitted the previously absent word กล้องจุลทรรศน์อิเล็กตรอน, and observed it classified and segmented by the actual model. A read of the QA dictionary confirmed:

```json
{"newWord":"กล้องจุลทรรศน์อิเล็กตรอน","source":"model","category":"noun","syllables":["กล้อง","จุล","ทรรศน์","อิ","เล็ก","ตรอน"]}
```

Then submitted ปลา and ปลาดาว; the UI immediately identified the duplicate author and correct winner. Opened the review, proposed one chunk with an explicit question, received a model revision to ปลา / ดาว with a direct explanation, and confirmed it. The UI displayed ยืนยันเข้าฐานคำแล้ว and บันทึกแล้ว: ปลา / ดาว. QA corrections stayed on the QA branch, not the user's production dictionary.

During the first browser pass, proposal changes remounted and collapsed the details element. Fixed the React key and dirty-form synchronization, rebuilt/restarted and repeated the browser request successfully with the form remaining open. Native AX clicking one button had no effect; the semantic Playwright locator activated it and the resulting request/answer/confirmation was verified.

At 390×844, a read-only DOM geometry check returned `overflow=[]`, `scrollWidth=375`, `width=390` for the review fields, buttons and panels. Reset the viewport after testing. Browser error logs were empty. Screenshots in the conversation outputs: `word-review-model-response.png`, `word-review-confirmed.png`, `word-review-mobile.png`.

## Limits and follow-up evidence

One supplemental four-player HTTP competition run failed on a transient Neon `read ECONNRESET` while advancing a later phase. A full retry passed with five sets, challenge authorization, private votes, concurrent vote idempotency, human confirmation, elimination and cross-session score persistence:

```json
{"backend":"neon","sets":5,"challengeAuthorization":"PASS","votePrivacy":"PASS","concurrentVoteIdempotency":"PASS","humanConfirmation":"PASS","elimination":"PASS","scores":[{"name":"QA เซ็ต โฮสต์","score":0},{"name":"QA เซ็ต คน 1","score":5},{"name":"QA เซ็ต คน 2","score":7},{"name":"QA เซ็ต คน 3","score":15}],"savedAcrossSessions":"PASS","result":"PASS"}
```

Inspection of the supplemental server output also exposed unhandled pg idle-client error events. Added a sanitized pool error listener so idle resets cannot terminate the server or print client credentials; a deterministic regression covers it. Active-query network errors can still require a retry. The existing pg SSL-mode compatibility advisory is still emitted; this upgrade does not claim to resolve all network errors. Model reading/classification/title knowledge can still be incorrect; review and human confirmation are the correction mechanism.

The new build was verified locally against real Neon and Gemini. Production Neon schema is ready, but no Vercel production URL was supplied or verified. Schema must precede the new frontend deployment. Existing Neon cleanup and one-hour room expiration were preserved and remain covered by deterministic tests.

---

# Verification — 2026-10-21

This update verifies the room-expiry implementation in commit `383fbac` and documents the current word-analysis pipeline. The 2026-10-20 report below is historical; its database row counts and 36-test total are not current measurements.

## Current deterministic checks and production build

`npm test` reported **43 tests, 43 passed, 0 failed**. Coverage now also includes the exact one-hour boundary, rejection of expired-room access and revival, successful presence renewal, background writes that do not renew activity, unauthorized heartbeat rejection, cache-preserving cleanup and scheduled-delivery idempotency.

`npm run build` completed successfully:

```text
✓ Compiled successfully in 3.4s
Finished TypeScript in 2.7s
✓ Generating static pages using 7 workers (5/5) in 682ms
Routes: /, /api/check, /api/room, /api/status, /_not-found
```

`npm start` reported `Ready in 210ms` on port 5173. No application source was changed after this build; the follow-up adds only the expiry smoke script and documentation.

## Real Neon expiry test

```text
node --experimental-strip-types scripts/smoke-expiry.mjs --allow-test-rooms --require-neon
```

```json
{"backend":"neon","expiryMs":3600000,"accessAfterExpiry":410,"heartbeatCannotRevive":"PASS","activeRoomPreserved":"PASS","physicalDelete":"PASS","sharedWordCachePreserved":"PASS","deleted":1,"result":"PASS"}
```

The script creates explicitly named QA rooms and ages only those room codes with a matching QA-name guard. It proves the same shared SQL cleanup removes the expired row while leaving the active room and shared word cache intact. The first script attempt assumed the legacy `syllable_cache` existed and failed; live inspection showed it is absent. The script now checks table existence and tests preservation only if present. No table was recreated and no user data was overwritten.

## Native scheduled cleanup

The existing deployed Neon Function `roomcleanup` and enabled `expired-rooms` trigger were verified. The schedule is `*/15 * * * *`, independent of the Vercel frontend. Actual function application logs show scheduled invocations and deletion counts, including:

```text
{"job":"expired-rooms","scheduledAt":"2026-10-20T15:00:00Z","deleted":2}
{"job":"expired-rooms","scheduledAt":"2026-10-20T15:15:00Z","deleted":0}
{"job":"expired-rooms","scheduledAt":"2026-10-20T15:30:00Z","deleted":3}
{"job":"expired-rooms","scheduledAt":"2026-10-20T15:45:00Z","deleted":4}
```

These are application-log message bodies with UTC schedule timestamps. The scheduler continues at 15-minute intervals. Logical expiration is enforced at one hour; physical deletion follows a cleanup sweep and is subject to service availability. The pg SSL-mode compatibility advisory still appears on stderr; it did not prevent connections or cleanup.

## Browser expiry proof

Created a shared-device QA room through the actual browser UI, enabled manual checking and used the seed ทะเล to avoid a model call. A guarded SQL update aged only this QA room past one hour. The browser's next state read returned to the setup screen with:

```text
ห้องหมดอายุหรือไม่พบห้องนี้แล้ว กรุณาตั้งวงใหม่ (ห้องไม่มีผู้ใช้งานครบ 1 ชั่วโมงจะถูกลบ)
```

Screenshot: `outputs/khamtongchaeum-room-expired.png` in the conversation's artifact directory. This confirms the client clears the old room session and displays the server's expiry notice.

## Current word-cache reuse

The twelve-case analysis smoke was rerun against the real shared database:

```json
{"cases":12,"modelCalls":0,"secondRead":"all database hits; no model calls","result":"PASS"}
```

This proves reuse and expected classifications for those fixtures; it does not prove all Thai syllable boundaries or title facts. Existing cached analyses were preserved. No Gemini call was needed for this follow-up's cache or expiry checks. See [WORD-CHECKING.md](WORD-CHECKING.md) for the current implementation, human-review safeguards and known limitations.

## Deployment boundary

The current local production build was tested against real Neon, and the deployed Neon cleanup trigger was verified from actual overnight logs. No Vercel production URL was supplied or verified in this follow-up. Credentials and the existing Neon/MCP configuration were preserved.

---

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
