-- Run once in the Neon SQL Editor, or use npm run db:setup.
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL DEFAULT 0
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

-- statement-breakpoint
CREATE INDEX IF NOT EXISTS rooms_idle_activity_idx ON rooms (COALESCE(NULLIF(last_active_at,0),updated_at));

-- statement-breakpoint
-- Authoritative dictionary: exact written word, independent of the current model.
CREATE TABLE IF NOT EXISTS word_dictionary (
  word TEXT PRIMARY KEY,
  analysis TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('model','players')),
  model TEXT NOT NULL,
  policy TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS word_analysis_history (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  analysis TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  policy TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
-- statement-breakpoint
CREATE INDEX IF NOT EXISTS word_analysis_history_word_idx ON word_analysis_history(word,updated_at);
-- statement-breakpoint
CREATE TABLE IF NOT EXISTS word_analysis_jobs (
  word TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  lease_until BIGINT NOT NULL
);
-- statement-breakpoint
-- Preserve every legacy version. Re-running setup never overwrites a newer dictionary.
INSERT INTO word_analysis_history(id,word,analysis,source,model,policy,updated_at)
SELECT policy || ':' || model || ':' || word || ':' || updated_at,word,analysis,source,model,policy,updated_at
FROM word_analysis_cache WHERE 1=1 ON CONFLICT(id) DO NOTHING;
-- statement-breakpoint
INSERT INTO word_dictionary(word,analysis,source,model,policy,updated_at)
SELECT word,analysis,source,model,policy,updated_at FROM (
 SELECT *,ROW_NUMBER() OVER (PARTITION BY word ORDER BY CASE WHEN source='players' THEN 0 ELSE 1 END,updated_at DESC,model,policy) AS rank
 FROM word_analysis_cache
) AS ranked WHERE rank=1 ON CONFLICT(word) DO NOTHING;
