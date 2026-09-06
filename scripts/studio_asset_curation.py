#!/usr/bin/env python3
"""Evidence-bound asset release gate. Python 3.11+, standard library only.

This validates recorded reviews, not artistic quality by itself. Downloaded packs,
file counts, variants and PBR component maps never become approved assets here.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from typing import Any

SCHEMA = "toonspectrum.asset-curation.v1"
TARGETS = {
    "scene-template": 120, "panel-layout": 80, "bubble": 80, "sfx": 100,
    "brush": 80, "effect": 120, "pattern": 100, "background-2d": 140,
    "prop-3d": 120, "environment-3d": 100, "pose": 80, "cover-template": 80,
}
WEIGHTS = {"craft": 25, "editability": 20, "consistency": 15,
           "storyUsefulness": 20, "technical": 10, "discoverability": 10}
PAYLOAD_EXTENSIONS = {
    **{k: {".json"} for k in ("scene-template", "panel-layout", "bubble", "sfx", "brush", "pose", "cover-template")},
    **{k: {".png", ".jpg", ".jpeg", ".webp", ".svg"} for k in ("effect", "pattern", "background-2d")},
    "prop-3d": {".glb"}, "environment-3d": {".glb"},
}
COMMON_CHECKS = {"import", "insert", "transform", "saveReload", "undoRedo", "export", "previewMatches"}
KIND_CHECKS = {
    "scene-template": {"nativeElements", "textEditable", "readingOrder", "bounds"},
    "panel-layout": {"nativeElements", "guttersEditable", "bounds"},
    "bubble": {"textEditable", "tailEditable", "koreanWrap", "bounds"},
    "sfx": {"textEditable", "koreanGlyphs", "outlineExport"},
    "brush": {"pressure", "continuousStroke", "edgeArtifacts", "latencyBudget"},
    "effect": {"transparentEdges", "lightDarkComposite", "intendedSize"},
    "pattern": {"tileSeams", "moireAtOutputScale", "intendedSize"},
    "background-2d": {"intendedSize", "perspective", "lineColorConsistency"},
    "prop-3d": {"units", "pivot", "materials", "texturesEmbedded", "triangleBudget", "silhouette"},
    "environment-3d": {"units", "materials", "texturesEmbedded", "triangleBudget", "cameraCoverage"},
    "pose": {"rigCompatibility", "jointLimits", "retarget", "noInterpenetration"},
    "cover-template": {"nativeElements", "textEditable", "koreanWrap", "safeArea"},
}
LICENSES = {"CC0-1.0", "CC-BY-4.0", "LicenseRef-ToonSpectrum-Commissioned"}
SHA = re.compile(r"^[a-f0-9]{64}$")
FONT_EXTENSIONS = {".ttf", ".otf", ".woff", ".woff2", ".ttc", ".eot"}
MAX_FILE_BYTES = 128 * 1024 * 1024


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_file(root: Path, relative: Any) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("invalid-relative-path")
    p = Path(relative)
    if p.is_absolute() or any(part in {"..", "."} for part in relative.split("/")):
        raise ValueError("path-outside-root")
    root = root.resolve(strict=True)
    candidate = root / p
    for parent in [candidate, *candidate.parents]:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError("symlink-not-allowed")
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("file-outside-root")
    if resolved.suffix.lower() in FONT_EXTENSIONS:
        raise ValueError("font-file-not-allowed")
    if resolved.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("file-too-large")
    return resolved


def evidence(root: Path, ref: Any) -> Path:
    if not isinstance(ref, dict) or not isinstance(ref.get("sha256"), str) or not SHA.fullmatch(ref["sha256"]):
        raise ValueError("missing-evidence-hash")
    p = safe_file(root, ref.get("path"))
    if sha256_file(p) != ref["sha256"]:
        raise ValueError("evidence-hash-mismatch")
    return p


def https_url(value: Any) -> bool:
    from urllib.parse import urlsplit
    if not isinstance(value, str):
        return False
    try:
        p = urlsplit(value)
        return p.scheme == "https" and bool(p.hostname) and not p.username and not p.password
    except ValueError:
        return False


def nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def inspect_asset(item: Any, root: Path) -> dict[str, Any]: # NOSONAR python:S3776
    if not isinstance(item, dict):
        return {"id": None, "eligible": False, "score": None, "issues": ["asset-must-be-object"]}
    issues: list[str] = []
    def require(condition: bool, message: str) -> None:
        if not condition:
            issues.append(message)
    require(nonempty(item.get("id")), "missing-id")
    category = item.get("category")
    require(isinstance(category, str) and category in TARGETS, "unknown-category")
    for key in ("nameKo", "styleFamily", "originalId", "provider"):
        require(nonempty(item.get(key)), "missing-" + key)
    scenes = item.get("scenes")
    require(isinstance(scenes, list) and bool(scenes) and all(nonempty(x) for x in scenes), "missing-scenes")
    keywords = item.get("keywordsKo")
    require(isinstance(keywords, list) and len(keywords) >= 2 and all(nonempty(x) for x in keywords), "missing-korean-search")
    require(item.get("phase") == "reviewed", "not-reviewed")
    payload_hash = None
    for key in ("payload", "preview", "rightsEvidence"):
        try:
            p = evidence(root, item.get(key))
            if key == "payload":
                payload_hash = sha256_file(p)
                allowed = PAYLOAD_EXTENSIONS.get(category if isinstance(category, str) else "", set())
                require(p.suffix.lower() in allowed, "payload-format-not-supported-for-category")
                require(p.stat().st_size > 0, "empty-payload")
            if key == "preview":
                require(p.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg"}, "preview-format-not-supported")
        except (ValueError, OSError) as e:
            issues.append(f"{key}:{e}")
    source = item.get("source")
    if not isinstance(source, dict):
        source = {}
    license_id = source.get("license")
    require(isinstance(license_id, str) and license_id in LICENSES, "license-needs-separate-review")
    require(source.get("redistribution") is True, "redistribution-not-confirmed")
    require(https_url(source.get("url")) and https_url(source.get("licenseUrl")), "missing-source-url")
    require(nonempty(source.get("rightsReviewer")), "missing-rights-reviewer")
    try:
        checked = date.fromisoformat(source.get("checkedAt", ""))
        require(checked <= date.today(), "future-rights-review")
    except (TypeError, ValueError):
        issues.append("missing-rights-review-date")
    if license_id == "CC-BY-4.0":
        require(nonempty(source.get("attribution")), "missing-attribution")
    if license_id == "LicenseRef-ToonSpectrum-Commissioned":
        require(source.get("serviceEmbedding") is True, "commission-missing-embedding-rights")
    try:
        rights_path = evidence(root, item.get("rightsEvidence"))
        if rights_path.stat().st_size > 1024 * 1024:
            raise ValueError("rights-report-too-large")
        rights = json.loads(rights_path.read_text(encoding="utf-8"))
        if not isinstance(rights, dict):
            raise ValueError("rights-report-must-be-object")
        require(payload_hash is not None and rights.get("payloadSha256") == payload_hash, "stale-rights-report")
        require(rights.get("provider") == item.get("provider") and rights.get("sourceUrl") == source.get("url")
                and rights.get("license") == license_id and rights.get("redistribution") is True
                and rights.get("reviewer") == source.get("rightsReviewer"), "rights-report-does-not-match-source")
    except (ValueError, OSError) as e:
        issues.append(f"rights-report:{e}")
    reviews = item.get("reviews")
    reviews = reviews if isinstance(reviews, list) else []
    reviewers: set[str] = set()
    scores: list[float] = []
    for review in reviews:
        if not isinstance(review, dict):
            issues.append("invalid-review")
            continue
        reviewer = review.get("reviewer")
        require(nonempty(reviewer), "missing-reviewer")
        if nonempty(reviewer):
            reviewers.add(reviewer.strip().casefold())
        require(payload_hash is not None and review.get("payloadSha256") == payload_hash, "stale-visual-review")
        require(review.get("decision") == "approve", "visual-review-not-approved")
        try:
            evidence(root, review.get("evidence"))
        except (ValueError, OSError) as e:
            issues.append(f"visual-evidence:{e}")
        values = review.get("scores", {})
        valid = isinstance(values, dict) and all(
            type(values.get(k)) in (int, float) and math.isfinite(values[k]) and 1 <= values[k] <= 5
            for k in WEIGHTS
        )
        require(valid, "invalid-quality-scores")
        if valid:
            score = sum(values[k] * weight / 5 for k, weight in WEIGHTS.items())
            scores.append(score)
            require(score >= 85 and all(values[k] >= 4 for k in WEIGHTS), "quality-below-threshold")
    require(len(reviewers) >= 2, "two-independent-reviewers-required")
    try:
        report_path = evidence(root, item.get("runtimeEvidence"))
        if report_path.stat().st_size > 1024 * 1024:
            raise ValueError("runtime-report-too-large")
        runtime = json.loads(report_path.read_text(encoding="utf-8"))
        if not isinstance(runtime, dict):
            raise ValueError("runtime-report-must-be-object")
        require(payload_hash is not None and runtime.get("payloadSha256") == payload_hash, "stale-runtime-report")
        require(nonempty(runtime.get("engineVersion")), "missing-engine-version")
        checks = runtime.get("checks", {})
        required = COMMON_CHECKS | KIND_CHECKS.get(category if isinstance(category, str) else "", set())
        require(isinstance(checks, dict) and all(checks.get(k) is True for k in required), "runtime-checks-incomplete")
    except (ValueError, OSError) as e:
        issues.append(f"runtime-evidence:{e}")
    return {"id": item.get("id"), "eligible": not issues,
            "score": min(scores) if scores else None, "issues": sorted(set(issues))}


def audit(manifest: Any, root: Path, release: bool = False) -> dict[str, Any]: # NOSONAR python:S3776
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        raise ValueError("unsupported-manifest-schema")
    assets = manifest.get("assets")
    if not isinstance(assets, list) or len(assets) > 50_000:
        raise ValueError("invalid-assets-array")
    results = [inspect_asset(x, root) for x in assets]
    # Repeated IDs fail closed, including the first occurrence.
    counts = Counter(x.get("id") for x in assets if isinstance(x, dict) and isinstance(x.get("id"), str))
    for result in results:
        if isinstance(result["id"], str) and counts[result["id"]] > 1:
            result["eligible"] = False
            result["issues"].append("duplicate-id")
    indices = [i for i, r in enumerate(results) if r["eligible"]]
    # Union-find handles A~B by origin and B~C by bytes transitively; no filename guessing.
    parent = {i: i for i in indices}
    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    seen: dict[tuple[str, str], int] = {}
    for i in indices:
        for key in (("origin", assets[i]["originalId"]), ("bytes", assets[i]["payload"]["sha256"])):
            if key in seen:
                parent[find(i)] = find(seen[key])
            else:
                seen[key] = i
    groups: dict[int, list[int]] = {}
    for i in indices:
        groups.setdefault(find(i), []).append(i)
    chosen = [min(g, key=lambda i: (-results[i]["score"], assets[i]["id"])) for g in groups.values()]
    representatives = sorted([assets[i] for i in chosen], key=lambda x: x["id"])
    by_category = Counter(x["category"] for x in representatives)
    by_provider = Counter(x["provider"] for x in representatives)
    by_style = Counter(x["styleFamily"] for x in representatives)
    by_scene = Counter(scene for x in representatives for scene in set(x["scenes"]))
    portfolio_issues: list[str] = []
    n = len(representatives)
    if release:
        if n < 1000:
            portfolio_issues.append("fewer-than-1000-approved-originals")
        for category, target in TARGETS.items():
            # Category floors approximate the 1,000 minimum; 1,200 is only the planning target.
            if by_category[category] < math.floor(target * 5 / 6):
                portfolio_issues.append("category-gap:" + category)
        if len(by_style) < 4:
            portfolio_issues.append("fewer-than-four-style-families")
        if len(by_scene) < 12:
            portfolio_issues.append("fewer-than-twelve-scenes")
        if n and any(v / n > .35 for v in by_provider.values()):
            portfolio_issues.append("provider-concentration-over-35-percent")
        if n and any(v / n > .40 for v in by_style.values()):
            portfolio_issues.append("style-concentration-over-40-percent")
        if n and sum(x.get("localization") == "ko-KR" for x in representatives) / n < .25:
            portfolio_issues.append("korean-context-below-25-percent")
    return {"schema": SCHEMA, "submittedRecords": len(assets), "eligibleRecords": len(indices),
            "approvedOriginals": n, "variantOrDuplicateRecords": len(indices) - n,
            "rejectedRecords": len(assets) - len(indices), "targets": TARGETS,
            "byCategory": dict(by_category), "byProvider": dict(by_provider),
            "byStyle": dict(by_style), "byScene": dict(by_scene),
            "portfolioIssues": portfolio_issues, "results": results,
            "representativeIds": [x["id"] for x in representatives],
            "releaseReady": release and not portfolio_issues and all(r["eligible"] for r in results)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--release", action="store_true", help="enforce final portfolio coverage")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.manifest.stat().st_size > 16 * 1024 * 1024:
            raise ValueError("manifest-too-large")
        report = audit(json.loads(args.manifest.read_text(encoding="utf-8")), args.root, args.release)
        text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(text, encoding="utf-8")
        print(text)
        return 1 if report["rejectedRecords"] or (args.release and not report["releaseReady"]) else 0
    except (OSError, ValueError) as e:
        print(f"curation: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
