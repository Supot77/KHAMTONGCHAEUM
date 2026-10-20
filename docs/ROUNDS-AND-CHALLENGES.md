# Rounds, sets, challenges, and the shared word database

Approved requirements from this conversation, 2026-10-20:

- One round contains five sets. A set eliminates losing players until one remains. All players return for the next set.
- Each elimination ends the current word chain. Survivors start a new chain with a model-selected noun. Pending later results cannot change a declared elimination.
- The final three survivors (or all players when a set starts with fewer than three) receive one point each. The set winner receives two additional points, making three placement points. Every challenge winner receives two additional points.
- Scores persist across sets and rounds in the same database-backed room. No cross-room identity or account system is introduced.
- Only active players other than the current turn player and the latest word's owner can challenge the latest submitted link. At least three active players are needed.
- The owner speaks for 60 seconds, the challenger for 60 seconds, then the other active players vote for 30 seconds. The normal turn clock pauses. Participants can finish their speaking turns early.
- A connected verdict makes the challenger lose; a disconnected verdict makes the owner lose. The winner receives two points. Votes are hidden until resolution; one vote per eligible player.
- A tie or no votes invokes the model for a short semantic verdict using only the two words and debate statements. This is the sole exception to human-only semantic judgment. On a provider failure the case stays unresolved and retryable.
- Shared-device mode lets the host operate controls for named participants. Online mode binds all actions to the authenticated player token.
- Active play exposes only the latest word. A challenge exposes the disputed pair. Full word details appear after an elimination for review.
- Cache lookup precedes model analysis. Existing entries supply syllables and word classifications; code decides noun admissibility and exact written-syllable overlap. Model drafts are stored separately from player-confirmed entries.
- Players can propose post-game corrections. Only host confirmation writes those corrections to the shared word cache. Model writes cannot overwrite confirmed entries. Corrections affect future checks, not completed results.

Implementation: JSON game state keeps competition, elimination, point and challenge ledgers in the existing `rooms` table. A versioned `word_analysis_cache` table stores reusable classifications and segmentation. All room mutations retain compare-and-swap and command idempotency. Timers advance from server time on requests; no persistent process or scheduled job is required on Vercel.

Validation: deterministic engine/service/SQL tests, production build, HTTP smoke tests against Neon, real model classification and tie-break tests, then browser checks of play, challenge, summary, and narrow layouts.
