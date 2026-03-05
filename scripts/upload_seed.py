"""
Upload players_seed.json directly to Supabase.
Use this instead of re-running seed_players.py when you've manually
edited players_seed.json and just need to push the changes to the DB.

Usage:
    python scripts/upload_seed.py
"""

import os, json
from dotenv import load_dotenv

load_dotenv(".env.local")
load_dotenv(".env")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("ERROR: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")

from supabase import create_client

with open("players_seed.json") as f:
    players = json.load(f)

print(f"Loaded {len(players)} players from players_seed.json")

client = create_client(SUPABASE_URL, SUPABASE_KEY)

chunk_size = 100
for i in range(0, len(players), chunk_size):
    chunk = players[i:i + chunk_size]
    client.table("players").upsert(chunk, on_conflict="name").execute()
    print(f"  Uploaded {i+1}–{min(i+chunk_size, len(players))}")

print("Done!")
