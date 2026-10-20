# คำต้องเชื่อม — approved design

Project location: `D:\KHAMTONGCHAEUM`. User approved the game flow in chat on 2026-10-20, including asynchronous validation and rollback.

## Rules

- A Thai noun-chain game. Participants judge noun validity and semantic connection; the LLM must never judge either.
- One application supports shared-device play (2–8 named players) and online rooms (2–8 players with a six-character room code).
- The model selects the opening Thai noun from a curated single-syllable noun vocabulary. The turn clock begins after the opening word arrives.
- The LLM splits Thai words into reading-based syllables, preserving every original written character. Code compares written syllable strings only against the immediately previous word. Homophones with different spellings are allowed.
- Submission advances the turn immediately. Validation runs through a separate request; the clock never pauses for it. Pending points and words are explicitly provisional.
- If a delayed result detects a repeated syllable, retain the chain before the offending word; remove the offending word and its descendants. Identify the speaker, their word, previous word, and repeated syllable. Show the descendants as reusable words, remove their points, and restore the offender's turn with a fresh turn deadline.
- Resetting never forbids a word globally. Only adjacency is checked. The offending word can be used in another legal context too.
- Host can reject a word based on human judgment using the same rollback mechanism. AI rejection can be appealed by the host, correcting the segmentation or accepting the adjacency for that exact word pair.
- Default turn time is 30 seconds, configurable to 15/30/45/60 seconds or off; timeout skips the turn. Passing is also available. The host ends the round; results are provisional while checks remain outstanding.

## Implementation

Next.js/React/TypeScript on Vercel. Lakebase Postgres through Neon stores versioned room JSON and a segmentation cache. The app uses pg with a shared pool and attachDatabasePool; local-only development can use SQLite. Mutations use compare-and-swap updates with command IDs for idempotency. Clients use authenticated POST requests and poll every second. Room/player bearer tokens are random, stored as hashes on the server, and never included in public state.

Validation requests acquire a 45-second room lease. Seed and word jobs carry round IDs and immutable word IDs. Results for deleted words or old rounds are discarded. Claims expire after disconnects. Requests batch up to 12 uncached words, validate strict JSON and lossless original spelling, and cache successful segmentations. Rate limits and errors keep words unresolved rather than marking them correct. Retry uses bounded backoff; the host may retry or resolve manually.

Only `GEMINI_API_KEY` on the server is used; default model `gemini-3.5-flash-lite`, configurable through `GEMINI_MODEL`. No automatic paid fallback, no API key in browser storage or bundles. Free usage depends on the account's actual free-tier quota. Missing configuration is visible before starting. Manual play is an explicit opt-in fallback with a user-entered opening word, never presented as model-generated.

## Visual system

Thai game-night board: pale periwinkle #F3F4FE, ink #29294B, violet #6356D8, mint #DFF4D6, coral #F5B8AA, white #FFFFFF. Rounded Thai display (Mitr), readable body (Sarabun/system Thai), tabular numerals for time and score. The signature is a chain of offset word tiles joined with small link marks. Setup focuses on the two modes; play focuses on the current word, input and clock. Secondary columns show players and reset history. Mobile stacks the board and keeps input easy to reach. Keyboard focus and reduced motion are required.

## Verification

Pure state-machine tests: homophones, exact spelling, adjacency-only checks, invalid segmentation, async rollback, restored turn, points, reuse, stale results, expired turn submissions, idempotency, host/member authorization. Service tests with an in-memory compare-and-swap store: concurrent submissions, joining, LLM failure/retry, private-state redaction. Browser QA: both modes, two independent sessions, submit while checks are pending, timer, rollback, mobile width, no-key messaging. A mock provider is used only inside tests; live LLM verification requires the owner's key. Build/typecheck before Vercel deployment; report any unverified boundary explicitly.
