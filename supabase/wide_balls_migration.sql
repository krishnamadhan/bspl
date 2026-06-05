-- wide_balls_migration.sql
-- Run from: Supabase Dashboard → SQL Editor → paste & run
-- Effect: allows ball_number = 0 (wide balls) in bspl_ball_log
-- After running this, every new simulated match will include wides in ball_log.
-- Previously simulated matches retain their old rows (no wides); re-simulate to backfill.

ALTER TABLE bspl_ball_log DROP CONSTRAINT IF EXISTS bspl_ball_log_ball_number_check;

ALTER TABLE bspl_ball_log
  ADD CONSTRAINT bspl_ball_log_ball_number_check
    CHECK (ball_number BETWEEN 0 AND 10);
-- Convention: ball_number 0 = wide, 1–6 = legal ball in over, 7–10 = no-ball (reserved)
