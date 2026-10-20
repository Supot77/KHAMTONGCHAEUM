-- Run once in the Neon SQL Editor, or use npm run db:setup.
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS syllable_cache (
  model TEXT NOT NULL,
  word TEXT NOT NULL,
  syllables TEXT NOT NULL,
  PRIMARY KEY (model, word)
);
