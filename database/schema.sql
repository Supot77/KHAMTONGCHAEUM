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

-- statement-breakpoint
CREATE TABLE IF NOT EXISTS word_analysis_cache (
  policy TEXT NOT NULL,
  model TEXT NOT NULL,
  word TEXT NOT NULL,
  analysis TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('model', 'players')),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (policy, model, word)
);
