#!/usr/bin/env python3
"""Download explicitly selected CC0 pilot packs into quarantine, never into apps/web/public/.

No crawling, payment, account credentials, font files, executable assets, automatic
quality approval or production upload. Python 3.11+, standard library only.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ALLOWED_HOSTS = {"kenney.nl", "ambientcg.com", "acg-download.struffelproductions.com"}
ALLOWED_EXTENSIONS = {".glb", ".gltf", ".bin", ".obj", ".mtl", ".fbx", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md"}
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_BATCH_BYTES = 192 * 1024 * 1024
MAX_EXPANDED_BYTES = 384 * 1024 * 1024
MAX_FILES = 10_000


def checked_url(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    if p.scheme != "https" or p.hostname not in ALLOWED_HOSTS or p.username or p.password or p.port not in (None, 443):
        raise ValueError("URL is not an approved HTTPS asset source")
    return url


class SourceRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        checked_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str, destination: Path, budget: dict[str, int]) -> dict: # NOSONAR python:S3776
    checked_url(url)
    opener = urllib.request.build_opener(SourceRedirects())
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "ToonSpectrum-curation-pilot/1.0", "Accept-Encoding": "identity"})
            h = hashlib.sha256()
            size = 0
            with opener.open(request, timeout=30) as response, destination.open("wb") as out:
                checked_url(response.url)
                declared = response.headers.get("Content-Length")
                if declared is not None and int(declared) > MAX_ARCHIVE_BYTES:
                    raise ValueError("archive exceeds download budget")
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    budget["downloaded"] += len(chunk)
                    if size > MAX_ARCHIVE_BYTES or budget["downloaded"] > MAX_BATCH_BYTES:
                        raise ValueError("download budget exceeded")
                    h.update(chunk)
                    out.write(chunk)
                return {"url": url, "resolvedUrl": response.url, "bytes": size, "sha256": h.hexdigest()}
        except urllib.error.HTTPError as e:
            if attempt == 2 or e.code not in {429, 500, 502, 503, 504}:
                raise
            retry = e.headers.get("Retry-After", "")
            time.sleep(min(30, int(retry)) if retry.isdigit() else 2 ** attempt)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("download exhausted")


def safe_member(name: str) -> PurePosixPath:
    p = PurePosixPath(name)
    if not name or "\\" in name or ":" in name or "\x00" in name or p.is_absolute() or ".." in p.parts:
        raise ValueError("unsafe ZIP path")
    return p


def extract_assets(archive: Path, destination: Path, budget: dict[str, int]) -> list[dict]: # NOSONAR python:S3776
    records = []
    seen_paths: set[str] = set()
    with zipfile.ZipFile(archive) as z:
        if len(z.infolist()) > MAX_FILES:
            raise ValueError("ZIP entry limit exceeded")
        for info in z.infolist():
            p = safe_member(info.filename)
            if stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError("ZIP symlink not allowed")
            if info.flag_bits & 1:
                raise ValueError("encrypted ZIP not allowed")
            if info.is_dir() or any(part.startswith(".") or part == "__MACOSX" for part in p.parts):
                continue
            # Fonts and nested archives are deliberately never retained or published.
            if p.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue
            folded = str(p).casefold()
            if folded in seen_paths:
                raise ValueError("ZIP path collision")
            seen_paths.add(folded)
            if info.file_size > MAX_ARCHIVE_BYTES or budget["expanded"] + info.file_size > MAX_EXPANDED_BYTES:
                raise ValueError("ZIP expansion budget exceeded")
            if info.file_size > 1024 * 1024 and info.file_size / max(1, info.compress_size) > 500:
                raise ValueError("suspicious ZIP compression ratio")
            target = destination.joinpath(*p.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            h = hashlib.sha256()
            size = 0
            with z.open(info) as src, target.open("xb") as out:
                while chunk := src.read(1024 * 1024):
                    size += len(chunk)
                    budget["expanded"] += len(chunk)
                    if size > MAX_ARCHIVE_BYTES or budget["expanded"] > MAX_EXPANDED_BYTES:
                        raise ValueError("ZIP expansion budget exceeded")
                    h.update(chunk)
                    out.write(chunk)
            records.append({"path": str(p), "bytes": size, "sha256": h.hexdigest(), "phase": "quarantined"})
    if not records:
        raise ValueError("archive contains no supported asset files")
    return records


def acquire(plan: dict, output: Path) -> dict:
    if plan.get("schema") != "toonspectrum.asset-acquisition-plan.v1":
        raise ValueError("unsupported plan")
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError("output must be a new or empty directory")
    output.mkdir(parents=True, exist_ok=True)
    budget = {"downloaded": 0, "expanded": 0}
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "packs": [], "errors": [],
              "rawFiles": 0, "approvedOriginals": 0, "productionPublished": 0,
              "notice": "Downloaded files are quarantine candidates. No visual or Studio runtime review has passed."}
    ids: set[str] = set()
    packs = plan.get("pilot", [])
    if not isinstance(packs, list) or not 1 <= len(packs) <= 8:
        raise ValueError("pilot must contain 1..8 explicit packs")
    for source in packs:
        identifier = source.get("id", "")
        if not isinstance(identifier, str) or not identifier or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in identifier) or identifier in ids:
            raise ValueError("invalid or duplicate pack id")
        ids.add(identifier)
        if source.get("license") != "CC0-1.0" or source.get("method") != "explicit-free-download":
            raise ValueError("pilot only accepts explicitly reviewed CC0 free downloads")
        try:
            with tempfile.TemporaryDirectory(prefix="toon-curation-") as tmp:
                work = Path(tmp)
                archive = work / "download.zip"
                received = download(source["downloadUrl"], archive, budget)
                unpacked = work / "files"
                unpacked.mkdir()
                records = extract_assets(archive, unpacked, budget)
                shutil.move(str(unpacked), str(output / identifier))
            report["packs"].append({"source": source, "download": received, "files": records})
            report["rawFiles"] += len(records)
            print(f"QUARANTINE {identifier}: {len(records)} raw files; 0 approved assets", flush=True)
        except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, urllib.error.URLError) as e:
            report["errors"].append({"id": identifier, "error": str(e)})
            print(f"FAILED {identifier}: {e}", flush=True)
        time.sleep(1)
    report["downloadedBytesIncludingRetries"] = budget["downloaded"]
    report["expandedBytesIncludingFailedAttempts"] = budget["expanded"]
    report["completedAt"] = datetime.now(timezone.utc).isoformat()
    (output / "quarantine-index.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output / "curation-manifest.json").write_text(json.dumps({"schema": "toonspectrum.asset-curation.v1", "assets": []}, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = acquire(json.loads(args.plan.read_text(encoding="utf-8")), args.output)
        return 1 if report["errors"] else 0
    except (OSError, ValueError) as e:
        print(f"acquisition: {e}", file=__import__("sys").stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
