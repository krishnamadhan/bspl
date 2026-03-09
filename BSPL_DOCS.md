# BSPL — Full Documentation

**Fantasy Cricket Platform** — Next.js 14 + Supabase + Vercel

---

## Table of Contents

1. [Stack & Architecture](#1-stack--architecture)
2. [Project Structure](#2-project-structure)
3. [Database Schema](#3-database-schema)
4. [Season Lifecycle](#4-season-lifecycle)
5. [Simulation Engine](#5-simulation-engine)
6. [API Routes Reference](#6-api-routes-reference)
7. [Key Business Rules](#7-key-business-rules)
8. [Known Limitations & TODOs](#8-known-limitations--todos)
9. [Deployment (Vercel + Supabase)](#9-deployment-vercel--supabase)

---

## 1. Stack & Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) with TypeScript |
| Styling | Tailwind CSS |
| Backend/DB | Supabase (PostgreSQL + Auth + Row Level Security) |
| Hosting | Vercel (serverless functions for API routes) |
| State management | React useState/useEffect + Supabase realtime polling |

### Data flow

```
Browser (client component)
  → Supabase Browser Client (RLS-filtered)
  → PostgreSQL

Browser (admin page)
  → Next.js API Route (server function on Vercel)
      → adminClient() (service role, bypasses RLS)
      → PostgreSQL

Browser (match page, server component)
  → Supabase SSR Client (user cookie, RLS-filtered)
  → PostgreSQL
```

### Two Supabase clients

| Client | Where used | RLS |
|--------|-----------|-----|
| `createClient()` (browser) | Client components, user-facing pages | Enforced — user sees only their own data |
| `createClient()` (SSR/server) | Server components | Enforced — user's session |
| `adminClient()` (service role) | All `/api/admin/*` routes | **Bypassed** — sees everything |

**Important**: The admin page (`/admin`) is a client component. It uses the browser Supabase client for most reads, which means RLS applies. Bot lineup submissions created by the service role are readable (since bot team `owner_id = admin.id`). Real player lineups may not be readable via the browser client if RLS policies restrict access. The simulation always uses `adminClient()` so real lineups are correctly picked up regardless.

---

## 2. Project Structure

```
src/
├── app/
│   ├── (auth)/                    # Login + Register pages
│   ├── (game)/                    # Player-facing pages (layout with nav)
│   │   ├── dashboard/page.tsx     # Season overview, standings, next match
│   │   ├── draft/page.tsx         # Player auction/draft board
│   │   ├── matches/
│   │   │   ├── page.tsx           # Match list
│   │   │   └── [id]/page.tsx      # Match detail: lineup submission + replay + scorecard
│   │   ├── standings/page.tsx     # Points table + NRR
│   │   ├── stats/page.tsx         # Top scorers, wicket-takers
│   │   ├── team/page.tsx          # My team roster, stamina, next match
│   │   └── teams/[id]/page.tsx    # View any team's roster
│   ├── admin/page.tsx             # Admin console (all controls)
│   └── api/
│       ├── admin/
│       │   ├── _lib/
│       │   │   ├── helpers.ts         # adminClient, requireAdmin, buildSimTeam, getBotTossChoice
│       │   │   ├── pick_xi.ts         # Auto-select best XI + bowling order from a roster
│       │   │   └── simulate_one.ts    # Core match simulation + DB writes
│       │   ├── add-bot-team/          # Create a single bot team with auto-draft
│       │   ├── auto-lineups/          # Fill bot lineups for all open matches
│       │   ├── create-season/
│       │   ├── delete-season/
│       │   ├── delete-team/
│       │   ├── end-season/
│       │   ├── generate-schedule/     # Round-robin schedule
│       │   ├── lineup-counts/         # Service-role lineup count (solves RLS visibility)
│       │   ├── lock-draft/
│       │   ├── open-lineups/[id]/     # Open a single match + auto-fill bots
│       │   ├── reopen-draft/
│       │   ├── reset-stamina/
│       │   ├── run-season/            # One-click full season simulation
│       │   ├── schedule-final/        # Create Final match
│       │   ├── schedule-q2/           # Create Qualifier 2
│       │   ├── setup-test-season/     # Dev-only: 6 preset bots + snake draft
│       │   ├── simulate/[id]/         # Simulate a single match
│       │   ├── simulate-all/          # Simulate all lineup_open matches
│       │   └── start-playoffs/        # Start playoffs (flexible 2–4+ teams)
│       ├── match/[id]/complete/       # Finalize a live match (manual)
│       └── teams/create/
├── components/
│   ├── draft/DraftBoard.tsx           # Player picker with budget tracking
│   ├── matches/
│   │   ├── LineupSubmitter.tsx        # XI selector + bowling order + toss
│   │   ├── MatchReplay.tsx            # Animated ball-by-ball replay
│   │   └── MatchStatusPoller.tsx      # Auto-refreshes page when match goes live→completed
│   ├── stats/StatsView.tsx
│   └── team/TeamRoster.tsx            # Squad cards with stamina/confidence
├── lib/
│   ├── simulation/
│   │   ├── engine.ts                  # Ball-by-ball simulation engine
│   │   ├── formulas.ts                # Batting SR, wicket prob, matchup modifiers
│   │   └── types.ts                   # SimPlayer, SimTeam, SimVenue, etc.
│   └── supabase/
│       ├── client.ts                  # Browser Supabase client
│       └── server.ts                  # SSR Supabase client (reads user cookie)
└── types/                             # Shared TypeScript types
```

---

## 3. Database Schema

### Core tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profile: `id`, `nickname`, `is_admin` |
| `players` | Master player pool: stats, role, price, bowler_type |
| `bspl_venues` | Venue modifiers: pace/spin advantages, dew factor |
| `bspl_seasons` | Season metadata: status, budget, squad limits |
| `bspl_teams` | Teams per season: name, color, owner, is_bot, budget_remaining |
| `bspl_rosters` | Team–player link: `(team_id, player_id, purchase_price)` |
| `bspl_matches` | Match rows: teams, venue, condition, status, result |
| `bspl_lineups` | Submitted XI + bowling order per match per team |
| `bspl_innings` | Per-innings summary: runs, wickets, overs |
| `bspl_ball_log` | Ball-by-ball: outcome, runs, batsman, bowler, wicket |
| `bspl_stamina` | Per-team per-player: stamina (0–100), confidence (0.7–1.3) |
| `bspl_player_stats` | Season stats: runs, balls, wickets, economy, etc. |
| `bspl_points` | Points table: played, won, lost, points, NRR |

### Season statuses

```
draft_open → draft_locked → in_progress → playoffs → completed
```

### Match statuses

```
scheduled → lineup_open → (live) → completed
```
> `live` is optional — matches can go directly `lineup_open → completed` when admin simulates. The replay plays from `bspl_ball_log` data regardless of status.

### Match types

`league` | `qualifier1` | `eliminator` | `qualifier2` | `final`

### Lineup constraints (enforced in LineupSubmitter.tsx)

- Exactly 11 players
- At least 1 wicket-keeper (multiple WKs allowed)
- At least 3 bowlers/all-rounders in XI
- Overs matching match format assigned in bowling order (5 for T5, 10 for T10, etc.)
- Max 2 overs per bowler (T5/T10) or 4 overs (T20)
- No consecutive overs by the same bowler
- Minimum 3 distinct bowlers (T5/T10) or 5 distinct (T20)

---

## 4. Season Lifecycle

### Admin flow (step by step)

```
1. Create Season
   POST /api/admin/create-season
   { name, budget_cr, min_squad, max_squad }
   → status: draft_open

2. Add Bot Teams (one at a time, as many as you want)
   POST /api/admin/add-bot-team
   { name }
   → Creates team, stratified random draft of 20 players

   OR use Dev Tools: "Setup Test Season" (creates 6 preset bots in one click)

3. Lock Draft
   POST /api/admin/lock-draft
   → status: draft_locked
   → real players can no longer draft

4. Generate Schedule
   POST /api/admin/generate-schedule
   → Creates round-robin matches (every team vs every other team once)
   → Shuffled conditions using Fisher-Yates
   → status: in_progress
   → Match 1 immediately set to lineup_open

5. Run Matches (one of three approaches):

   a) Per-match:
      POST /api/admin/open-lineups/{id}   → lineup_open + auto-fill bots
      POST /api/admin/simulate/{id}        → simulate (uses submitted + auto-fill)

   b) Batch:
      POST /api/admin/simulate-all         → simulate all lineup_open matches

   c) Full auto:
      POST /api/admin/run-season           → opens all scheduled, fills bots, simulates all

6. Reset Stamina (optional, recommended before playoffs)
   POST /api/admin/reset-stamina
   → all players: stamina = 100, confidence = 1.0

7. Start Playoffs
   POST /api/admin/start-playoffs
   → 2–3 teams: Direct Final
   → 4+ teams: IPL format (Q1 + Eliminator, then Q2 + Final)
   → status: playoffs

8. Run Playoff Matches (same as step 5)
   For IPL format after Q1 + Eliminator complete:
   POST /api/admin/schedule-q2     → creates Q2
   POST /api/admin/schedule-final  → creates Final after Q2 done

9. End Season
   POST /api/admin/end-season
   → status: completed
```

### Player flow

```
1. Register at /register
2. Create a team during draft_open
3. Draft players at /draft (live auction board)
4. Wait for admin to open lineup window
5. Submit lineup at /matches/{id} when status = lineup_open
6. Watch replay + scorecard at /matches/{id} after simulation
7. Monitor /team for stamina and confidence
8. Check /standings for points table
```

---

## 5. Simulation Engine

### Overview

The simulation (`src/lib/simulation/engine.ts`) runs a complete 5-over T5 (or T10/T20 depending on config) match ball by ball, producing:
- Ball log (each ball: batsman, bowler, outcome, runs, wicket)
- Batting scorecard (runs, balls, fours, sixes, SR, dismissal)
- Bowling scorecard (overs, runs, wickets, economy)
- Stamina updates (playing reduces stamina; bench recovers +25%)
- Confidence updates (performance vs expected)
- Winner

### Input: SimTeam

```typescript
{
  team_id: string
  players: SimPlayer[]          // full squad with stats, stamina, confidence
  batting_order: string[]       // 11 player IDs in submitted order
  bowling_order: string[]       // 5 over assignments (can repeat, max 2 per bowler)
}
```

### Key formulas (`src/lib/simulation/formulas.ts`)

**Effective batting SR**:
```
effectiveSR = baseSR × phaseModifier × staminaMod × confidenceMod × venueMod × conditionMod × matchupMod
```

**Wicket probability per ball**:
```
wicketP = baseWicketProb × bowlerPhase × bowlerConfidence × battingConfidence × venueMod × matchupMod
```

**Matchup modifiers**:
- LHB vs spin → high variance (1.10 boost to both SR and wicket prob)
- RHB vs pace → slight advantage for batter

**Confidence delta**:
- Batsman: runs_scored vs expected_runs_per_ball × balls_faced
- Bowler: economy delta (actual - expected)

### Cricket notation arithmetic

Overs stored as cricket notation: `1.4` = 1 over + 4 balls (NOT 1.4 decimal overs).

Always convert via helpers before arithmetic:
```typescript
cnToBalls(cn): number  // 1.4 → 10 balls
ballsToCn(balls): number  // 10 → 1.4
```

Economy formula: `runs / (balls / 6)` — uses decimal overs.

### Toss logic

- 50/50 coin flip for toss winner
- Winner's `toss_choice` determines bat/bowl first
- Bot toss choice:
  - `dew_evening` → bowl (chasing team benefits from dew)
  - `overcast` → bowl (pacers get swing)
  - else → bat

### Seed strategy

```typescript
const seed = (Date.now() ^ hashMatchId(matchId)) % 1_000_000
```
XOR ensures different results for matches simulated at the same millisecond.

### Data insertion order (critical for retryability)

```
1. Atomic lineup_open → live (concurrent request gets 0 rows → error)
2. Insert innings rows (throws if fails → catch resets to lineup_open)
3. Insert ball_log
4. Update match → completed
5. Upsert stamina         (throws on failure → admin sees HTTP 500)
6. Upsert player_stats    (throws on failure)
7. Upsert fantasy_scores  (throws on failure)
8. Upsert points table    (throws on failure)
```
Steps 5–8 run after `completed` — a failure means the match shows completed with correct innings data but missing/stale stats. Admin can use undo-simulate then re-simulate to recover.

### Ball outcome calibration (sim_audit.js, 10 000 matches)

```
Avg innings score: 55.3 runs  RPO: 11.07  Avg wickets: 2.6
Chase win rate: 51%  Tie rate: 2.4%
Boundary %: 66.7%  Wicket-per-ball: 1-in-10.4
```
All metrics within real-world T5 benchmarks (55–68 runs, 11–13.5 RPO, 2–6 wkts).

### Wicket type distribution

```
Caught ~45%  Bowled ~25%  LBW ~15%  Run out ~15%
```
Dropped catches: 30% go to boundary, 35% for 2, 35% for 1.

### pickXI algorithm (`_lib/pick_xi.ts`)

Auto-selects best XI from a roster:
1. Select top players by role quota (WK × 1, BAT × 3, AR × 3, BOWL × 4)
2. Sort within role by stats (SR for batters, economy for bowlers)
3. Generate bowling order (5 slots, max 2 per bowler, no back-to-back)
4. Fallback 1: relax max-overs cap if can't assign 5 distinct bowlers
5. Fallback 2: single bowler repeat if still can't fill 5 slots

### Bot team draft (`add-bot-team/route.ts`)

Stratified random selection for variety:
- Per role, take top 3× candidate pool
- Split into elite (top half) and good (bottom half) tiers
- Random pick within each tier
- Multiple bots get different rosters (not all the same top-N)

---

## 6. API Routes Reference

### Admin routes (all require `is_admin = true`)

| Method | Route | What it does |
|--------|-------|-------------|
| POST | `/api/admin/create-season` | Create new season |
| POST | `/api/admin/lock-draft` | Lock draft → `draft_locked` |
| POST | `/api/admin/reopen-draft` | Reopen draft |
| POST | `/api/admin/generate-schedule` | Round-robin schedule |
| POST | `/api/admin/add-bot-team` | Create one bot team + auto-draft |
| POST | `/api/admin/delete-team` | Delete a team |
| POST | `/api/admin/delete-season` | Delete season + all data |
| POST | `/api/admin/end-season` | Mark season completed |
| POST | `/api/admin/open-lineups/{id}` | Open lineup window + fill bots |
| POST | `/api/admin/auto-lineups` | Fill bot lineups for all open matches |
| POST | `/api/admin/simulate/{id}` | Simulate one match |
| POST | `/api/admin/simulate-all` | Simulate all lineup_open matches |
| POST | `/api/admin/run-season` | Open all scheduled + fill bots + simulate all |
| POST | `/api/admin/reset-stamina` | Reset all stamina to 100, confidence to 1.0 |
| POST | `/api/admin/start-playoffs` | Start playoffs (2+ teams supported) |
| POST | `/api/admin/schedule-q2` | Create Qualifier 2 (IPL format only) |
| POST | `/api/admin/schedule-final` | Create Final |
| POST | `/api/admin/setup-test-season` | Dev: create 6 preset bot teams + draft |
| GET | `/api/admin/lineup-counts?match_ids=…` | Service-role lineup submission count |

### Player routes

| Method | Route | What it does |
|--------|-------|-------------|
| POST | `/api/teams/create` | Create a real team |
| POST | `/api/match/{id}/complete` | Finalize a live match manually |

---

## 7. Key Business Rules

### Teams

- Any number of teams per season (no hardcoded limit)
- Bot teams: `is_bot = true`, auto-drafted squad of ~20 players
- Real teams: `is_bot = false`, owner drafts manually
- Each player can appear on multiple teams (FPL-style, not exclusive draft)

### Playoffs

- **2–3 teams**: Direct Final between #1 and #2
- **4+ teams**: IPL format — Q1 (#1 vs #2), Eliminator (#3 vs #4), Q2 (Q1-loser vs E-winner), Final (Q1-winner vs Q2-winner)
- Requires teams to have played at least one match (points table entry needed)
- Admin can start playoffs from `in_progress` or `draft_locked` status

### NRR (Net Run Rate)

Proper formula using actual overs:
```
NRR = (runs_for / overs_for) − (runs_against / overs_against)
```
`bspl_points` stores cumulative `overs_for` and `overs_against` as decimal overs (e.g. 27 legal balls = 4.5). Both `simulate_one.ts` and `undo-simulate` use ball-counted decimal overs — no hardcoded match-length assumption.

### Stamina

- Range: 0–100
- Playing a match reduces stamina based on balls faced/bowled
- Sitting out a match recovers +25% (capped at 100)
- Below 40%: player marked 🏥 (low effectiveness penalty)

### Confidence

- Range: 0.70–1.30 (default 1.0)
- Increases when player outperforms expectations
- Decreases when player underperforms
- Affects both batting SR and bowling effectiveness

### Match conditions

| Condition | Effect |
|-----------|--------|
| `neutral` | No modifiers |
| `overcast` | Pacers: +wicket prob, -economy (swing/seam) |
| `dew_evening` | 2nd innings: +batting SR, -bowling economy (dew makes ball slippery) |
| `slow_sticky` | All batters: -SR; scoring is harder |
| `crumbling_spin` | Spinners dominate 2nd innings |

---

## 8. Known Limitations & TODOs

1. **Admin lineup visibility**: Browser client can't see real-player lineups due to RLS. Fixed with `/api/admin/lineup-counts` service-role endpoint. If still broken, check Supabase RLS policy on `bspl_lineups`
2. **Concurrent simulations**: Atomic `lineup_open → live` claim prevents double-simulation. Don't forcibly clear `live` status while a simulation is running.
3. **Run Full Season**: Only works for `in_progress` status, not `playoffs`
4. **Exclusive auction**: Players auctioned in `bspl_auction` are exclusive (one team per season). Bot rosters remain FPL-style (shared from master player pool).
5. **Real-time updates**: No WebSocket/Supabase realtime — uses polling (MatchStatusPoller every 5s, admin page every 20s)
6. **No no-ball simulation**: No-balls are tracked in bowler stats but never generated by the engine (intentional simplification)
7. **Super over ball log**: Super over balls are not saved to `bspl_ball_log` — only the summary is in `result_summary`

---

## 9. Deployment (Vercel + Supabase)

### Environment variables

Set these in Vercel project settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   ← server-only, never expose to browser
```

### Supabase setup

1. Create project at supabase.com
2. Run schema migrations (create all `bspl_*` tables)
3. Enable Row Level Security on all tables
4. Configure RLS policies:
   - `bspl_lineups`: team owners read/write their own + service role reads all
   - `bspl_teams`: everyone reads, owners write
   - `bspl_matches`: everyone reads, service role writes
   - Admin routes bypass RLS via `SUPABASE_SERVICE_ROLE_KEY`
5. Seed `players` and `bspl_venues` tables via Supabase Table Editor or SQL

### Vercel deployment

1. Connect GitHub repo to Vercel
2. Framework: Next.js (auto-detected)
3. Set environment variables (above)
4. Deploy — API routes run as serverless Edge/Node functions

### Local development

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase keys
npm run dev                         # localhost:3000
```

---

## 10. Component Reference (quick lookup)

| Component | File | Purpose |
|-----------|------|---------|
| `LineupSubmitter` | `components/matches/LineupSubmitter.tsx` | XI selection, bowling order, toss; upserts to `bspl_lineups` |
| `MatchReplay` | `components/matches/MatchReplay.tsx` | Animated ball-by-ball replay from `bspl_ball_log`; shows scorecard after |
| `MatchStatusPoller` | `components/matches/MatchStatusPoller.tsx` | Polls match status every 5s; reloads page when status changes |
| `DraftBoard` | `components/draft/DraftBoard.tsx` | Player picker with role/tier filters; tracks budget |
| `TeamRoster` | `components/team/TeamRoster.tsx` | Squad cards with stamina bars, confidence arrows, season stats |
| `StatsView` | `components/stats/StatsView.tsx` | Top performers table (batting + bowling) |
| `CreateTeamForm` | `components/team/CreateTeamForm.tsx` | Team name + color picker |

---

*Last updated: 2026-02-27*
