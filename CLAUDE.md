# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**BSPL — Banter Squad Premier League.** A fantasy cricket tournament platform using real IPL player stats, a stamina system, and a stat-weighted match simulation engine.

## Commands

```bash
# Must add Node to PATH first in PowerShell:
$env:PATH += ";C:\Program Files\nodejs"

npm run dev       # Dev server (localhost:3000)
npm run build     # Production build
npm run lint      # ESLint
```

No test framework configured.

## Environment

Copy `.env.local` and fill in Supabase credentials:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Architecture

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind · Supabase · Zustand

**Route groups:**
- `(auth)/` — login, register — no navbar, dark standalone layout
- `(game)/` — all game pages — share `layout.tsx` with top navbar
- `admin/` — admin-only, guarded by `profiles.is_admin`

**Auth:** `src/proxy.ts` handles session refresh and redirects (Next.js 16 proxy convention, replaces middleware).

**Supabase clients:**
- `src/lib/supabase/client.ts` — browser client (use in `'use client'` components)
- `src/lib/supabase/server.ts` — server client (use in Server Components, Route Handlers)

**Zustand stores** (`src/store/`):
- `useAuthStore` — user + profile (includes `is_admin`)
- `useTeamStore` — current user's team roster + stamina + lineup
- `useTournamentStore` — active season, points table, match schedule

## Simulation Engine

Core logic lives in `src/lib/simulation/`:
- `formulas.ts` — all multiplier calculations (stamina, confidence, phase, matchup, home ground, RRR pressure)
- `engine.ts` — `simulateMatch()` — takes two `SimTeam` objects + venue, returns full `MatchResult`
- `types.ts` — simulation-specific types

**The core formula:**
```
effective_stat = base_stat × (stamina/100) × confidence × phase_rating × matchup_mod × home_ground_mod × condition_mod × rrr_pressure_mod
```

**Stamina rules:** max loss 25%/game · 🏥 warning below 40% · +25% recovery if rested · max 100%
**Confidence:** 0.70–1.30 · performance-based post-match updates · −0.05 if benched

## Key TypeScript Types (`src/types/`)

- `Player` / `RosterPlayer` — full player model including `PhaseRating` and `PlayerBaseStats`
- `BSPLTeam` / `MatchLineup` — team and pre-match submission
- `Venue` / `MatchCondition` — pitch modifiers; `MATCH_CONDITIONS` constant has all 5 types
- `BSPLMatch` / `MatchScorecard` / `BallLog` — match data
- `BSPLSeason` / `PointsTableEntry` — tournament management

## Database Tables (Supabase, `bspl_` prefix)

```
profiles          — shared with Banter Squad (adds is_admin bool)
bspl_seasons      — tournament instance
bspl_teams        — 6 teams, one per owner
bspl_rosters      — players per team (shared players allowed)
bspl_stamina      — per-player per-team stamina (key: team_id + player_id)
bspl_matches      — scheduled fixtures
bspl_lineups      — pre-match XI + bowling order + toss choice
bspl_innings      — per-innings totals
bspl_ball_log     — ball-by-ball simulation output
bspl_points       — live points table
bspl_player_stats — cumulative season stats

players           — all IPL players (seeded from cricsheet data pipeline)
bspl_venues       — IPL grounds with pitch/dew modifiers
```

## Data Pipeline

IPL player stats sourced from cricsheet.org ball-by-ball JSON. Python script processes → `players` table. See `scripts/` directory (to be created).
