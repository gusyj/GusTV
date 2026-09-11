#!/usr/bin/env python3
"""
check_streams.py

Sanity-checks every stream URL in channels.json by making a lightweight
HTTP request and reporting which ones fail. This is the same idea as
iptv-org's automated stream-health checks, kept simple:

- 2xx/3xx response -> OK
- timeout / connection error / 4xx / 5xx -> flagged

Run locally with: python3 scripts/check_streams.py
Also wired up in .github/workflows/validate.yml to run on a schedule.

Note: this only checks that the URL responds — it does not verify the
stream is licensed for redistribution. That's a judgment call you make
before adding a channel to channels.json.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANNELS_FILE = os.path.join(ROOT, "channels.json")
TIMEOUT_SECONDS = 10


def check(url: str) -> tuple[bool, str]:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "GusTV-checker/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            return resp.status < 400, f"HTTP {resp.status}"
    except Exception as e:
        # Some stream servers reject HEAD; fall back to a ranged GET.
        try:
            req2 = urllib.request.Request(url, headers={"User-Agent": "GusTV-checker/1.0", "Range": "bytes=0-1024"})
            with urllib.request.urlopen(req2, timeout=TIMEOUT_SECONDS) as resp:
                return resp.status < 400, f"HTTP {resp.status} (GET fallback)"
        except Exception as e2:
            return False, str(e2)


def main():
    with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
        channels = json.load(f)

    failures = []
    for ch in channels:
        ok, detail = check(ch["url"])
        status = "OK  " if ok else "FAIL"
        print(f"[{status}] {ch['name']:<40} {detail}")
        if not ok:
            failures.append(ch["name"])

    if failures:
        print(f"\n{len(failures)} channel(s) failed: {', '.join(failures)}")
        sys.exit(1)
    print(f"\nAll {len(channels)} channel(s) OK.")


if __name__ == "__main__":
    main()
