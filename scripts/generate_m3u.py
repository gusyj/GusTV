#!/usr/bin/env python3
"""
generate_m3u.py

Builds index.m3u (master playlist) and per-category playlists under
playlists/categories/ from channels.json.

Usage:
    python3 scripts/generate_m3u.py

This mirrors the pattern iptv-org uses: a single source-of-truth JSON/database
that gets compiled into standard M3U files, so the playlists are always
consistent with the channel metadata (name, logo, group, EPG id).
"""
import json
import os
import re
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNELS_FILE = os.path.join(ROOT, "channels.json")
INDEX_FILE = os.path.join(ROOT, "index.m3u")
CATEGORIES_DIR = os.path.join(ROOT, "playlists", "categories")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def m3u_entry(channel: dict) -> str:
    logo = channel.get("logo", "")
    group = channel.get("group", "Uncategorized")
    epg_id = channel.get("epg_id", channel["id"])
    name = channel["name"]
    url = channel["url"]
    return (
        f'#EXTINF:-1 tvg-id="{epg_id}" tvg-logo="{logo}" group-title="{group}",{name}\n'
        f"{url}\n"
    )


def main():
    with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
        channels = json.load(f)

    # Master playlist
    lines = ["#EXTM3U\n"]
    for ch in channels:
        lines.append(m3u_entry(ch))
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"Wrote {INDEX_FILE} ({len(channels)} channels)")

    # Per-category playlists
    os.makedirs(CATEGORIES_DIR, exist_ok=True)
    by_group = defaultdict(list)
    for ch in channels:
        by_group[ch.get("group", "Uncategorized")].append(ch)

    for group, group_channels in by_group.items():
        path = os.path.join(CATEGORIES_DIR, f"{slugify(group)}.m3u")
        with open(path, "w", encoding="utf-8") as f:
            f.write("#EXTM3U\n")
            for ch in group_channels:
                f.write(m3u_entry(ch))
        print(f"Wrote {path} ({len(group_channels)} channels)")


if __name__ == "__main__":
    main()
