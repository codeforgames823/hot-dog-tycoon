-- Hot Dog Tycoon — Leaderboard schema
-- Run on the shared Azure Postgres (or any Postgres) before first use.

CREATE TABLE IF NOT EXISTS hdt_leaderboard (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(24)  NOT NULL,
  career      VARCHAR(40)  NOT NULL,
  days        INTEGER      NOT NULL CHECK (days >= 1),
  networth    BIGINT       NOT NULL CHECK (networth >= 0),
  ip_hash     VARCHAR(32),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Sort/index for the typical leaderboard query
CREATE INDEX IF NOT EXISTS idx_hdt_leaderboard_score
  ON hdt_leaderboard (days ASC, networth DESC, created_at ASC);

-- Optional: prevent absurd duplicate spam from same ip+name within 1 minute
-- (kept simple — partial index on recent rows would be better in prod)
