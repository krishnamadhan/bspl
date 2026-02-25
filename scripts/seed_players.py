"""
BSPL Player Data Pipeline
=========================
Processes cricsheet.org IPL ball-by-ball JSON data to compute
per-player stats, then seeds the Supabase `players` table.

Setup:
    pip install supabase python-dotenv

Usage:
    1. Download IPL data from https://cricsheet.org/downloads/ipl_json.zip
    2. Unzip to a folder, e.g. C:/Users/krish/ipl_data/
    3. Run: python scripts/seed_players.py --data C:/Users/krish/ipl_data/

Environment:
    Create a .env file in project root (or use .env.local):
        NEXT_PUBLIC_SUPABASE_URL=...
        SUPABASE_SERVICE_ROLE_KEY=...   <-- use service role for seeding, NOT anon key
"""

import os
import json
import glob
import argparse
from pathlib import Path
from collections import defaultdict
from typing import Optional
from dotenv import load_dotenv

load_dotenv(".env.local")
load_dotenv(".env")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")  # service role for seeding

# ─── Seasons to include (weighted — more recent = higher weight) ──────────────
SEASON_WEIGHTS = {
    "2025": 1.5,
    "2024": 1.3,
    "2023": 1.1,
    "2022": 1.0,
    "2021": 0.9,
    "2020": 0.8,
}
MIN_INNINGS_TO_QUALIFY = 10   # player must have faced 10+ innings to get batting stats
MIN_ACTIVE_SEASON = "2021"    # player must have appeared in at least one match from this year onward

# ─── Price tier thresholds (composite rating 0–100) ──────────────────────────
# Prices are FLAT per tier — no within-tier variation.
# Budget math: Rs100 Cr / ~20 players → avg Rs5 Cr/player
#   A balanced squad: 2×elite(10) + 4×premium(7) + 7×good(5) + 4×value(3) + 3×budget(1.5) = ~99.5 Cr
PRICE_TIERS = [
    (80, "elite",   10.0),
    (65, "premium",  7.0),
    (50, "good",     5.0),
    (35, "value",    3.0),
    (0,  "budget",   1.5),
]

# ─── Phase split (overs in a full T20) ────────────────────────────────────────
# Mapped to BSPL 5-over game phases: pp=1-2, middle=3-4, death=5
PHASE_OVERS = {
    "pp":     range(1, 7),     # overs 1-6 in T20 = powerplay
    "middle": range(7, 16),    # overs 7-15
    "death":  range(16, 21),   # overs 16-20
}

# ─── IPL team name normalisation ──────────────────────────────────────────────
TEAM_ALIASES = {
    "Royal Challengers Bangalore": "RCB",
    "Royal Challengers Bengaluru": "RCB",
    "Mumbai Indians": "MI",
    "Chennai Super Kings": "CSK",
    "Kolkata Knight Riders": "KKR",
    "Delhi Capitals": "DC",
    "Delhi Daredevils": "DC",
    "Punjab Kings": "PBKS",
    "Kings XI Punjab": "PBKS",
    "Rajasthan Royals": "RR",
    "Sunrisers Hyderabad": "SRH",
    "Gujarat Titans": "GT",
    "Lucknow Super Giants": "LSG",
}

# ─── Known left-handed batsmen (last-name lookup — matches cricsheet abbreviation format) ──
LEFT_HANDER_SURNAMES = {
    "Dhawan", "Warner", "Gayle", "Raina", "Sarkar", "Jaiswal",
    "Livingstone", "Miller", "Marsh",
}
# Exact matches needed where surname alone is ambiguous (e.g. "Patel", "Singh")
LEFT_HANDERS_EXACT = {
    "Axar Patel", "Shahbaz Ahmed", "Rinku Singh", "Faf du Plessis",
    "Quinton de Kock", "Tilak Varma", "Abdul Samad", "Moeen Ali",
    "Mitchell Starc", "Jason Roy", "Alex Hales", "Krunal Pandya",
    # Also add abbreviated forms that cricsheet might use
    "F du Plessis", "Q de Kock", "MR Marsh", "JJ Roy", "A Hales",
    "AT Rayudu",  # not left-handed but keep if needed
}

# ─── Known wicket-keepers ──────────────────────────────────────────────────────
# Use unique surnames — cricsheet uses abbreviated format like "H Klaasen", "PD Salt"
WK_SURNAMES = {
    "Dhoni", "Pant", "Samson", "Karthik", "Kishan", "Saha",
    "Buttler", "Salt", "Inglis", "Pooran", "Klaasen",
    "Jurel", "Rickelton", "Rawat", "Wade", "Billings",
}
# Exact matches for ambiguous surnames
WK_EXACT = {
    "KL Rahul",           # surname "Rahul" is uncommon but be safe
    "Jitesh Sharma",      # surname "Sharma" is very common
    "Prabhsimran Singh",  # surname "Singh" is very common
    "Ishan Kishan",       # backup
}

# ─── Known bowler types ────────────────────────────────────────────────────────
SPINNER_KEYWORDS = {
    "Chahal", "Ashwin", "Jadeja", "Kuldeep", "Narine", "Sunil",
    "Tahir", "Zampa", "Chakaravarthy", "Siraj Naik", "Washington",
    "Krunal", "Axar", "Shahbaz", "Shreyas Gopal", "Imran Tahir",
}
PACE_KEYWORDS = {
    "Bumrah", "Shami", "Arshdeep", "Hazlewood", "Starc", "Cummins",
    "Bhuvneshwar", "Siraj", "Umesh", "Boult", "Steyn", "Ngidi",
    "Jamieson", "Holder", "Rabada", "Nortje", "Lockie", "Harshal",
    "Deepak", "Avesh", "Natarajan", "Prasidh", "Arjun",
}


def is_left_handed(name: str) -> bool:
    surname = name.split()[-1]
    return name in LEFT_HANDERS_EXACT or surname in LEFT_HANDER_SURNAMES


def is_wicket_keeper(name: str) -> bool:
    surname = name.split()[-1]
    return name in WK_EXACT or surname in WK_SURNAMES


class PlayerStats:
    def __init__(self, name: str):
        self.name = name
        self.ipl_team = "Unknown"
        self.last_season = "0000"      # track most recent season seen
        self.is_left_handed = is_left_handed(name)
        # Weighted accumulators
        self.bat_runs = 0.0
        self.bat_balls = 0.0
        self.bat_innings = 0
        self.bat_4s = 0.0
        self.bat_6s = 0.0
        self.bat_outs = 0.0
        # Phase batting
        self.bat_runs_pp = 0.0; self.bat_balls_pp = 0.0
        self.bat_runs_mid = 0.0; self.bat_balls_mid = 0.0
        self.bat_runs_death = 0.0; self.bat_balls_death = 0.0
        # Bowling
        self.bowl_runs = 0.0
        self.bowl_balls = 0.0
        self.bowl_wickets = 0.0
        self.bowl_dots = 0.0
        self.bowl_innings = 0
        # Phase bowling
        self.bowl_runs_pp = 0.0; self.bowl_balls_pp = 0.0; self.bowl_wkts_pp = 0.0
        self.bowl_runs_mid = 0.0; self.bowl_balls_mid = 0.0; self.bowl_wkts_mid = 0.0
        self.bowl_runs_death = 0.0; self.bowl_balls_death = 0.0; self.bowl_wkts_death = 0.0


def get_phase(over: int) -> str:
    if over in PHASE_OVERS["pp"]:     return "pp"
    if over in PHASE_OVERS["middle"]: return "middle"
    return "death"


def get_season_weight(season: str) -> float:
    """Weight by season year — more recent seasons weighted higher."""
    season_str = str(season).strip()
    # Handle ranges like "2020/21" → use first year
    year = season_str[:4]
    return SEASON_WEIGHTS.get(year, 0.7)


def classify_bowler_type(name: str) -> Optional[str]:
    for kw in SPINNER_KEYWORDS:
        if kw.lower() in name.lower():
            return "spin"
    for kw in PACE_KEYWORDS:
        if kw.lower() in name.lower():
            return "pace"
    return "medium"  # default


def classify_role(stats: PlayerStats) -> str:
    if is_wicket_keeper(stats.name):
        return "wicket-keeper"

    bat_avg = (stats.bat_runs / stats.bat_outs) if stats.bat_outs > 0 else (stats.bat_runs / max(stats.bat_innings, 1))
    bowl_econ = (stats.bowl_runs / stats.bowl_balls * 6) if stats.bowl_balls > 0 else 15.0

    # Require substantial weighted ball counts — prevents fringe players inflating roles
    # Weighted balls: each ball weighted by season recency (0.7–1.5), so:
    #   200 weighted ≈ 150 actual balls ≈ 75+ innings faced (meaningful batter sample)
    #   300 weighted ≈ 200+ actual balls ≈ 33+ overs bowled (meaningful bowler sample)
    is_real_batter = stats.bat_balls >= 200 and stats.bat_innings >= 12 and bat_avg >= 12
    is_real_bowler = stats.bowl_balls >= 300 and stats.bowl_innings >= 12 and bowl_econ <= 12.0

    if is_real_batter and is_real_bowler:
        return "all-rounder"
    if is_real_bowler:
        return "bowler"
    return "batsman"


def compute_phase_rating(base_sr: float, phase_sr: float) -> float:
    """Batting phase rating — higher SR in phase = higher multiplier."""
    if base_sr == 0:
        return 1.0
    rating = phase_sr / base_sr
    return round(max(0.7, min(1.35, rating)), 3)


def compute_bowl_phase_rating(base_econ: float, phase_econ: float) -> float:
    """Bowling phase rating — LOWER economy in phase = HIGHER multiplier (inverted)."""
    if phase_econ == 0:
        return 1.0
    rating = base_econ / phase_econ  # inverted: conceding less = better
    return round(max(0.7, min(1.35, rating)), 3)


def compute_price(composite_rating: float) -> tuple[str, float]:
    """Return flat tier + price — no within-tier variation."""
    for threshold, tier, price in PRICE_TIERS:
        if composite_rating >= threshold:
            return tier, price
    return "budget", 1.5


def process_match(filepath: str, players: dict):
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    info = data.get("info", {})
    teams = info.get("teams", [])

    # Season is stored in info.season (e.g. "2025" or "2020/21")
    season_raw = str(info.get("season", "0000"))
    season_year = season_raw[:4]   # "2020/21" → "2020"
    weight = get_season_weight(season_year)

    # Latest team assignments
    team_map = {}
    for team_name in teams:
        short = TEAM_ALIASES.get(team_name, team_name[:3].upper())
        # Map player names to team
        players_in_team = info.get("players", {}).get(team_name, [])
        for p in players_in_team:
            team_map[p] = short

    innings_list = data.get("innings", [])
    for innings in innings_list:
        overs = innings.get("overs", [])
        dismissed_this_innings = set()

        for over_data in overs:
            over_num = over_data.get("over", 0) + 1  # cricsheet is 0-indexed
            phase = get_phase(over_num)

            for delivery in over_data.get("deliveries", []):
                batter = delivery.get("batter", "")
                bowler = delivery.get("bowler", "")
                runs = delivery.get("runs", {})
                batter_runs = runs.get("batter", 0)
                total_runs = runs.get("total", 0)
                extras = delivery.get("extras", {})
                is_wide = "wides" in extras
                is_noball = "noballs" in extras
                wickets = delivery.get("wickets", [])

                # Update team and last active season
                if batter in team_map:
                    if batter not in players:
                        players[batter] = PlayerStats(batter)
                    players[batter].ipl_team = team_map[batter]
                    players[batter].last_season = max(players[batter].last_season, season_year)

                if bowler in team_map:
                    if bowler not in players:
                        players[bowler] = PlayerStats(bowler)
                    players[bowler].ipl_team = team_map[bowler]
                    players[bowler].last_season = max(players[bowler].last_season, season_year)

                # ── Batting stats ──
                if batter and not is_wide:
                    if batter not in players:
                        players[batter] = PlayerStats(batter)
                    s = players[batter]
                    s.bat_runs  += batter_runs * weight
                    s.bat_balls += weight
                    if batter_runs == 4: s.bat_4s += weight
                    if batter_runs == 6: s.bat_6s += weight

                    if phase == "pp":
                        s.bat_runs_pp  += batter_runs * weight
                        s.bat_balls_pp += weight
                    elif phase == "middle":
                        s.bat_runs_mid  += batter_runs * weight
                        s.bat_balls_mid += weight
                    else:
                        s.bat_runs_death  += batter_runs * weight
                        s.bat_balls_death += weight

                # ── Bowling stats ──
                if bowler:
                    if bowler not in players:
                        players[bowler] = PlayerStats(bowler)
                    s = players[bowler]
                    if not is_wide and not is_noball:
                        s.bowl_balls += weight
                        s.bowl_runs  += total_runs * weight
                        if total_runs == 0:
                            s.bowl_dots += weight
                    else:
                        s.bowl_runs += total_runs * weight  # extras count against bowler

                    for w in wickets:
                        kind = w.get("kind", "")
                        if kind not in ("run out", "obstructing the field", "retired hurt"):
                            s.bowl_wickets += weight

                    if phase == "pp":
                        s.bowl_balls_pp += weight if not is_wide else 0
                        s.bowl_runs_pp  += total_runs * weight
                        s.bowl_wkts_pp  += sum(1 for w in wickets if w.get("kind") not in ("run out",)) * weight
                    elif phase == "middle":
                        s.bowl_balls_mid += weight if not is_wide else 0
                        s.bowl_runs_mid  += total_runs * weight
                        s.bowl_wkts_mid  += sum(1 for w in wickets if w.get("kind") not in ("run out",)) * weight
                    else:
                        s.bowl_balls_death += weight if not is_wide else 0
                        s.bowl_runs_death  += total_runs * weight
                        s.bowl_wkts_death  += sum(1 for w in wickets if w.get("kind") not in ("run out",)) * weight

                # Track outs for batting avg (weighted same as runs so avg = weighted_runs/weighted_outs)
                for w in wickets:
                    dismissed = w.get("player_out", "")
                    if dismissed and dismissed not in dismissed_this_innings:
                        dismissed_this_innings.add(dismissed)
                        if dismissed in players:
                            players[dismissed].bat_outs += weight

        # Count innings
        for batter in set(d.get("batter") for ov in overs for d in ov.get("deliveries", [])):
            if batter and batter in players:
                players[batter].bat_innings += 1

        for bowler in set(d.get("bowler") for ov in overs for d in ov.get("deliveries", [])):
            if bowler and bowler in players:
                players[bowler].bowl_innings += 1


def build_player_record(name: str, s: PlayerStats) -> dict:
    # ── Batting ──
    bat_avg = (s.bat_runs / s.bat_outs) if s.bat_outs > 0 else s.bat_runs / max(s.bat_innings, 1)
    bat_sr  = (s.bat_runs / s.bat_balls * 100) if s.bat_balls > 0 else 0
    boundary_pct = (s.bat_4s + s.bat_6s) / s.bat_balls if s.bat_balls > 0 else 0
    dot_pct_bat  = 0  # approximation — cricsheet needs more processing for this

    sr_pp    = (s.bat_runs_pp    / s.bat_balls_pp    * 100) if s.bat_balls_pp    > 0 else bat_sr
    sr_death = (s.bat_runs_death / s.bat_balls_death * 100) if s.bat_balls_death > 0 else bat_sr
    sr_mid   = (s.bat_runs_mid   / s.bat_balls_mid   * 100) if s.bat_balls_mid   > 0 else bat_sr

    # ── Bowling ──
    bowl_econ = (s.bowl_runs / s.bowl_balls * 6) if s.bowl_balls > 0 else None
    bowl_sr   = (s.bowl_balls / s.bowl_wickets)   if s.bowl_wickets > 0 else None
    wicket_prob = (s.bowl_wickets / s.bowl_balls)  if s.bowl_balls > 0 else None
    dot_pct_bowl = (s.bowl_dots / s.bowl_balls)   if s.bowl_balls > 0 else None

    econ_pp    = (s.bowl_runs_pp    / s.bowl_balls_pp    * 6) if s.bowl_balls_pp    > 0 else bowl_econ
    econ_death = (s.bowl_runs_death / s.bowl_balls_death * 6) if s.bowl_balls_death > 0 else bowl_econ
    wktp_pp    = (s.bowl_wkts_pp    / s.bowl_balls_pp)        if s.bowl_balls_pp    > 0 else wicket_prob
    wktp_death = (s.bowl_wkts_death / s.bowl_balls_death)      if s.bowl_balls_death > 0 else wicket_prob

    # ── Phase ratings ──
    phase_pp_rat    = compute_phase_rating(bat_sr, sr_pp)
    phase_mid_rat   = compute_phase_rating(bat_sr, sr_mid)
    phase_death_rat = compute_phase_rating(bat_sr, sr_death)

    # Bowling phase: lower economy in a phase = better = higher multiplier (inverted ratio)
    bowl_pp_rat    = compute_bowl_phase_rating(bowl_econ or 9, econ_pp or bowl_econ or 9)
    bowl_mid_rat   = 1.0
    bowl_death_rat = compute_bowl_phase_rating(bowl_econ or 9, econ_death or bowl_econ or 9)

    # ── Composite rating (0–100) ──
    # Batting component: needs substantial innings (150+ weighted balls, 10+ innings).
    # Formula: equal weight on SR and avg so consistent run-scorers (Kohli) AND
    # big-hitters (Head, Stubbs) both land in elite.
    # Calibration: Kohli (avg 41, SR 134) → 53.6+32.8 = 86.4 → elite ✓
    #              Average IPL bat (avg 25, SR 125) → 50+20 = 70 → premium ✓
    #              Fringe (avg 15, SR 110) → 44+12 = 56 → good ✓
    bat_component = 0
    if s.bat_innings >= 10 and s.bat_balls >= 150:
        bat_component = min(100, bat_sr * 0.4 + bat_avg * 0.8)

    # Bowling component: needs large sample (300+ weighted balls, 12+ innings, 20+ wickets).
    # Denominator 5.5 and base 0.040 are calibrated so Bumrah (econ ~7.3, wktp ~0.057)
    # scores ~84 → elite, while an average IPL bowler (econ ~9, wktp ~0.048) scores ~58 → good.
    # Economy score: 6.0 econ → 71 pts, 7.3 (Bumrah) → 55 pts, 9.0 (avg) → 35 pts
    # Wicket score:  0.040 base → avg wktp 0.048 gives 24 pts, Bumrah 0.057 gives 28.5 pts (capped 40)
    bowl_component = 0
    if s.bowl_innings >= 12 and s.bowl_balls >= 300 and s.bowl_wickets >= 20:
        econ_score = max(0.0, (12.0 - (bowl_econ or 12.0)) / 5.5 * 65.0)
        wkts_score = min(40.0, (wicket_prob or 0.0) / 0.040 * 20.0)
        bowl_component = econ_score + wkts_score

    role = classify_role(s)
    if role in ("batsman", "wicket-keeper"):
        # WKs don't bowl → use batting composite only (same as batsmen)
        composite = bat_component
    elif role == "bowler":
        composite = bowl_component
    else:  # all-rounder
        composite = (bat_component * 0.5 + bowl_component * 0.5)

    tier, price = compute_price(composite)

    return {
        "name":              name,
        "ipl_team":          s.ipl_team,
        "role":              role,
        "bowler_type":       classify_bowler_type(name) if role in ("bowler", "all-rounder") else None,
        "is_left_handed":    s.is_left_handed,
        "batting_avg":       round(bat_avg, 2),
        "batting_sr":        round(bat_sr, 2),
        "boundary_pct":      round(float(boundary_pct), 3),
        "dot_pct_batting":   round(float(dot_pct_bat), 3),
        "batting_sr_pp":     round(float(sr_pp), 2),
        "batting_sr_death":  round(float(sr_death), 2),
        "bowling_economy":   round(float(bowl_econ), 2) if bowl_econ else None,
        "bowling_sr":        round(float(bowl_sr), 2) if bowl_sr else None,
        "wicket_prob":       round(float(wicket_prob), 4) if wicket_prob else None,
        "dot_pct_bowling":   round(float(dot_pct_bowl), 3) if dot_pct_bowl else None,
        "economy_pp":        round(float(econ_pp), 2) if econ_pp else None,
        "economy_death":     round(float(econ_death), 2) if econ_death else None,
        "wicket_prob_pp":    round(float(wktp_pp), 4) if wktp_pp else None,
        "wicket_prob_death": round(float(wktp_death), 4) if wktp_death else None,
        "phase_pp":          phase_pp_rat,
        "phase_middle":      phase_mid_rat,
        "phase_death":       phase_death_rat,
        "bowl_phase_pp":     round(float(bowl_pp_rat), 3) if s.bowl_innings >= 5 else None,
        "bowl_phase_middle": round(float(bowl_mid_rat), 3) if s.bowl_innings >= 5 else None,
        "bowl_phase_death":  round(float(bowl_death_rat), 3) if s.bowl_innings >= 5 else None,
        "price_cr":          price,
        "price_tier":        tier,
        "fielding_rating":   7,  # default — can be manually tuned
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="Path to folder with cricsheet IPL JSON files")
    parser.add_argument("--output", default="players_seed.json", help="Output JSON file path")
    parser.add_argument("--upload", action="store_true", help="Upload directly to Supabase")
    parser.add_argument("--min-matches", type=int, default=10, help="Minimum matches to include player")
    parser.add_argument("--top", type=int, default=0, help="Print top N players by price (for inspection)")
    args = parser.parse_args()

    files = glob.glob(os.path.join(args.data, "*.json"))
    print(f"Found {len(files)} match files")

    players: dict[str, PlayerStats] = {}

    for filepath in files:
        try:
            process_match(filepath, players)
        except Exception as e:
            print(f"  ⚠ Skipped {Path(filepath).name}: {e}")

    print(f"Processed {len(players)} unique players")

    # Filter and build records
    records = []
    skipped_retired = 0
    for name, s in players.items():
        total_matches = max(s.bat_innings, s.bowl_innings)
        if total_matches < args.min_matches:
            continue
        # Skip players who haven't featured since MIN_ACTIVE_SEASON
        if s.last_season < MIN_ACTIVE_SEASON:
            skipped_retired += 1
            continue
        records.append(build_player_record(name, s))
    if skipped_retired:
        print(f"Skipped {skipped_retired} retired/inactive players (last seen before {MIN_ACTIVE_SEASON})")

    # Sort by price descending
    records.sort(key=lambda r: r["price_cr"], reverse=True)
    print(f"Qualified players: {len(records)}")

    # Role breakdown
    from collections import Counter
    role_counts = Counter(r["role"] for r in records)
    print(f"Roles: {dict(role_counts)}")

    # Inspect top N
    if args.top > 0:
        print(f"\n{'Rank':<5} {'Name':<25} {'Team':<6} {'Role':<14} {'Price':>6}  {'SR':>6} {'Avg':>5} {'Econ':>5} {'WkProb':>7}")
        print("-" * 85)
        for i, r in enumerate(records[:args.top], 1):
            print(f"{i:<5} {r['name']:<25} {r['ipl_team']:<6} {r['role']:<14} "
                  f"Rs{r['price_cr']:>5.1f}  "
                  f"{r['batting_sr'] or 0:>6.1f} {r['batting_avg'] or 0:>5.1f} "
                  f"{r['bowling_economy'] or 0:>5.1f} {r['wicket_prob'] or 0:>7.4f}")

    # Save JSON
    with open(args.output, "w") as f:
        json.dump(records, f, indent=2)
    print(f"Saved to {args.output}")

    # Upload to Supabase
    if args.upload:
        if not SUPABASE_URL or not SUPABASE_KEY:
            print("ERROR: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")
            return

        from supabase import create_client
        client = create_client(SUPABASE_URL, SUPABASE_KEY)

        # Batch upsert in chunks of 100
        chunk_size = 100
        for i in range(0, len(records), chunk_size):
            chunk = records[i:i + chunk_size]
            result = client.table("players").upsert(chunk, on_conflict="name").execute()
            print(f"  Uploaded players {i+1}–{min(i+chunk_size, len(records))}")

        print("Upload complete!")


if __name__ == "__main__":
    main()
