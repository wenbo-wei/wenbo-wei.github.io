#!/usr/bin/env python3
"""Collect a read-only Busuanzi snapshot; publishing is handled by the workflow."""

import argparse
import base64
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

SITE = "https://wenbo-wei.github.io/"
API = "https://bsz.iirose.cn/api"
DATA_BRANCH = "site-traffic"
MAX_COUNTER = 2**53 - 1


def parse_time(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Snapshot timestamps must include a timezone")
    return parsed.astimezone(timezone.utc)


def counter(value):
    if type(value) is not int or not 0 <= value <= MAX_COUNTER:
        raise ValueError("Counter must be a non-negative safe integer")
    return value


def validate_history(history):
    if history.get("version") != 1 or history.get("site") != SITE:
        raise ValueError("Unexpected traffic history schema or site")
    if not isinstance(history.get("samples"), list):
        raise ValueError("Missing traffic samples")
    previous = None
    for sample in history["samples"]:
        at = parse_time(sample["at"])
        if previous is not None and at <= previous:
            raise ValueError("Traffic samples must be strictly chronological")
        counter(sample["views"])
        counter(sample["visitors"])
        previous = at
    return history


def fetch_totals():
    # GET is the provider's GetHandler: it reads totals without counting a visit.
    request = Request(API, headers={"X-Bsz-Referer": SITE}, method="GET")
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if payload.get("success") is not True:
        raise ValueError("The statistics service did not return a successful result")
    data = payload["data"]
    return {"views": counter(data["site_pv"]), "visitors": counter(data["site_uv"])}


def append_snapshot(history, totals, now):
    validate_history(history)
    now = parse_time(now.isoformat())
    if history["samples"] and now <= parse_time(history["samples"][-1]["at"]):
        raise ValueError("Refusing to replace newer traffic history")
    cutoff = now - timedelta(days=31)
    samples = [sample for sample in history["samples"] if parse_time(sample["at"]) >= cutoff]
    at = now.isoformat(timespec="microseconds").replace("+00:00", "Z")
    samples.append({"at": at, "views": counter(totals["views"]), "visitors": counter(totals["visitors"])})
    return {"version": 1, "site": SITE, "updated_at": at, "samples": samples}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--bootstrap", type=Path, help="Create the first history file")
    source.add_argument("--metadata", type=Path, help="GitHub contents API response for traffic.json")
    parser.add_argument("--payload", type=Path, help="Write the GitHub contents update payload")
    args = parser.parse_args()

    if args.bootstrap:
        if args.payload or args.bootstrap.exists():
            parser.error("Bootstrap needs a new output path and no update payload")
        history = {"version": 1, "site": SITE, "samples": []}
    else:
        if not args.payload:
            parser.error("An update payload path is required with --metadata")
        metadata = json.loads(args.metadata.read_text())
        if metadata.get("path") != "traffic.json" or not re.fullmatch(r"[0-9a-f]{40}", metadata.get("sha", "")):
            raise ValueError("Unexpected GitHub history file metadata")
        history = json.loads(base64.b64decode(metadata["content"]))
        validate_history(history)

    totals = fetch_totals()
    updated = append_snapshot(history, totals, datetime.now(timezone.utc))
    content = json.dumps(updated, indent=2) + "\n"
    if args.bootstrap:
        with args.bootstrap.open("x") as output:
            output.write(content)
    else:
        payload = {
            "message": "Record traffic snapshot " + updated["updated_at"],
            "branch": DATA_BRANCH,
            "sha": metadata["sha"],
            "content": base64.b64encode(content.encode()).decode(),
        }
        args.payload.write_text(json.dumps(payload))
    print(f"Recorded {totals['views']} page views and {totals['visitors']} estimated visitors")


if __name__ == "__main__":
    main()
