-- ============================================================
-- BSPL Auction Feature Migration
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── bspl_auction table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS bspl_auction (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id               UUID NOT NULL REFERENCES bspl_seasons(id) ON DELETE CASCADE,
  player_id               UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'sold', 'unsold')),
  base_price              NUMERIC(5,2) NOT NULL,
  current_bid             NUMERIC(5,2) NOT NULL,
  current_bidder_team_id  UUID REFERENCES bspl_teams(id) ON DELETE SET NULL,
  winning_team_id         UUID REFERENCES bspl_teams(id) ON DELETE SET NULL,
  winning_bid             NUMERIC(5,2),
  opened_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at               TIMESTAMPTZ
);

-- Only one open auction per season at a time
CREATE UNIQUE INDEX IF NOT EXISTS bspl_auction_one_open_per_season
  ON bspl_auction (season_id)
  WHERE status = 'open';

-- Enable Realtime replication for live bid updates
ALTER TABLE bspl_auction REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE bspl_auction;

-- ─── Row Level Security ───────────────────────────────────────
ALTER TABLE bspl_auction ENABLE ROW LEVEL SECURITY;

-- Everyone can read auction state (live bid display)
DROP POLICY IF EXISTS "auction read all" ON bspl_auction;
CREATE POLICY "auction read all" ON bspl_auction
  FOR SELECT USING (true);

-- Only admins can INSERT / UPDATE / DELETE auction rows
-- (bid updates go through the API route which uses the service role key)
DROP POLICY IF EXISTS "auction admin write" ON bspl_auction;
CREATE POLICY "auction admin write" ON bspl_auction
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ─── Note ─────────────────────────────────────────────────────
-- The ALTER PUBLICATION line above handles Realtime enablement.
-- No manual dashboard step needed.
