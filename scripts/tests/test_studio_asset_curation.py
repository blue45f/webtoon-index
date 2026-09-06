"""Offline synthetic fixtures only. Passing tests are NOT reviewed production assets."""
import copy
import hashlib
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import studio_asset_curation as c

CC0_LICENSE = 'CC0-1.0'
import acquire_studio_asset_pilot as a


class CurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.item = self.fixture("one")

    def ref(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")
        return {"path": name, "sha256": c.sha256_file(path)}

    def fixture(self, name):
        payload = self.ref(name + ".json", {"synthetic": name})
        preview = self.ref(name + ".png", {"syntheticPreview": True})
        rights = self.ref(name + "-rights.json", {
            "payloadSha256": payload["sha256"], "provider": "fixture",
            "sourceUrl": "https://example.org/source", "license": CC0_LICENSE,
            "redistribution": True, "reviewer": "rights-fixture-reviewer",
        })
        runtime = self.ref(name + "-runtime.json", {"payloadSha256": payload["sha256"],
            "engineVersion": "synthetic-test-engine", "checks": {k: True for k in c.COMMON_CHECKS | c.KIND_CHECKS["scene-template"]}})
        return {"id": name, "nameKo": "가상 시험 템플릿", "provider": "fixture", "originalId": "fixture:" + name,
                "category": "scene-template", "styleFamily": "ink", "scenes": ["school"],
                "keywordsKo": ["학교", "교실"], "phase": "reviewed", "payload": payload,
                "preview": preview, "rightsEvidence": rights, "runtimeEvidence": runtime,
                "source": {"url": "https://example.org/source", "licenseUrl": "https://example.org/license",
                    "license": CC0_LICENSE, "redistribution": True, "rightsReviewer": "rights-fixture-reviewer",
                    "checkedAt": "2025-01-01"},
                "reviews": [{"reviewer": who, "decision": "approve", "payloadSha256": payload["sha256"],
                    "evidence": self.ref(name + "-" + who + ".json", {"syntheticReview": True}),
                    "scores": {k: 5 for k in c.WEIGHTS}} for who in ["visual-a", "visual-b"]]}

    def report(self, assets=None, release=False):
        return c.audit({"schema": c.SCHEMA, "assets": assets if assets is not None else [self.item]}, self.root, release)

    def assertBlocked(self, needle):
        r = self.report()
        self.assertEqual(r["approvedOriginals"], 0)
        self.assertTrue(any(needle in e for e in r["results"][0]["issues"]), r)

    def test_evidence_bound_fixture_eligible(self):
        self.assertEqual(self.report()["approvedOriginals"], 1)
        self.assertFalse(self.report()["releaseReady"])

    def test_empty_final_release_is_not_ready(self):
        r = self.report([], True)
        self.assertFalse(r["releaseReady"])
        self.assertIn("fewer-than-1000-approved-originals", r["portfolioIssues"])

    def test_download_is_not_quality_approval(self):
        self.item["phase"] = "quarantined"
        self.assertBlocked("not-reviewed")

    def test_altered_bytes_invalidate_all_old_evidence(self):
        (self.root / "one.json").write_text("changed")
        self.assertBlocked("payload:evidence-hash-mismatch")

    def test_stale_visual_review(self):
        self.item["reviews"][0]["payloadSha256"] = "0" * 64
        self.assertBlocked("stale-visual-review")

    def test_same_reviewer_alias_does_not_count_twice(self):
        self.item["reviews"][1]["reviewer"] = " VISUAL-A "
        self.assertBlocked("two-independent")

    def test_missing_human_evidence(self):
        self.item["reviews"][0]["evidence"] = {}
        self.assertBlocked("visual-evidence")

    def test_aggregate_quality_and_each_dimension_both_enforced(self):
        self.item["reviews"][0]["scores"]["craft"] = 3
        self.assertBlocked("quality-below")

    def test_all_four_scores_do_not_meet_85(self):
        self.item["reviews"][0]["scores"] = {k: 4 for k in c.WEIGHTS}
        self.assertBlocked("quality-below")

    def test_nan_infinity_bool_scores_fail(self):
        for bad in [float("nan"), float("inf"), True, "5", None]:
            with self.subTest(bad=bad):
                self.item["reviews"][0]["scores"]["craft"] = bad
                self.assertBlocked("invalid-quality-scores")

    def test_redistribution_not_implied_by_commercial_use(self):
        self.item["source"]["redistribution"] = False
        self.assertBlocked("redistribution-not-confirmed")

    def test_ccby_requires_attribution(self):
        self.item["source"]["license"] = "CC-BY-4.0"
        self.assertBlocked("missing-attribution")

    def test_noncommercial_and_unknown_licenses_fail(self):
        for license_id in ["CC-BY-NC-4.0", "royalty-free", "CC-BY-SA-4.0", None, [CC0_LICENSE]]:
            with self.subTest(license_id=license_id):
                self.item["source"]["license"] = license_id
                self.assertBlocked("license-needs-separate-review")

    def test_commission_requires_service_embedding_rights(self):
        self.item["source"]["license"] = "LicenseRef-ToonSpectrum-Commissioned"
        self.assertBlocked("commission-missing")

    def test_rights_report_bound_to_source(self):
        self.item["source"]["url"] = "https://example.org/different"
        self.assertBlocked("rights-report-does-not-match")

    def test_future_rights_review_fails(self):
        self.item["source"]["checkedAt"] = "2999-01-01"
        self.assertBlocked("future-rights-review")

    def test_missing_preview_fails(self):
        del self.item["preview"]
        self.assertBlocked("preview:")

    def test_native_template_cannot_be_flattened_svg(self):
        self.item["payload"] = self.ref("flat.svg", {"synthetic": True})
        self.assertBlocked("payload-format-not-supported")

    def test_missing_runtime_check_fails(self):
        checks = {k: True for k in c.COMMON_CHECKS | c.KIND_CHECKS["scene-template"]}
        checks["saveReload"] = False
        self.item["runtimeEvidence"] = self.ref("bad-runtime.json", {
            "payloadSha256": self.item["payload"]["sha256"], "engineVersion": "fixture", "checks": checks})
        self.assertBlocked("runtime-checks-incomplete")

    def test_runtime_stale_payload_fails(self):
        self.item["runtimeEvidence"] = self.ref("stale-runtime.json", {
            "payloadSha256": "0" * 64, "engineVersion": "fixture", "checks": {}})
        self.assertBlocked("stale-runtime")

    def test_file_path_traversal_fails(self):
        for bad in ["../outside.json", "/etc/passwd", "folder/../one.json", "folder\\one.json"]:
            with self.subTest(bad=bad):
                self.item["payload"]["path"] = bad
                self.assertBlocked("payload:")

    def test_symlink_fails_even_inside_root(self):
        (self.root / "link.json").symlink_to(self.root / "one.json")
        self.item["payload"]["path"] = "link.json"
        self.assertBlocked("symlink-not-allowed")

    def test_fonts_never_released(self):
        self.item["payload"] = self.ref("font.woff2", {"fake": True})
        self.assertBlocked("font-file-not-allowed")

    def test_duplicate_ids_fail_both(self):
        r = self.report([self.item, copy.deepcopy(self.item)])
        self.assertEqual(r["approvedOriginals"], 0)
        self.assertEqual(r["rejectedRecords"], 2)

    def test_same_original_variants_count_once(self):
        other = self.fixture("two")
        other["originalId"] = self.item["originalId"]
        r = self.report([self.item, other])
        self.assertEqual(r["approvedOriginals"], 1)
        self.assertEqual(r["variantOrDuplicateRecords"], 1)

    def test_duplicate_bytes_across_providers_count_once(self):
        other = copy.deepcopy(self.item)
        other.update(id="two", originalId="different")
        self.assertEqual(self.report([self.item, other])["approvedOriginals"], 1)

    def test_transitive_duplicates_do_not_inflate_count(self):
        two = self.fixture("two")
        two["originalId"] = self.item["originalId"]
        three = copy.deepcopy(two)
        three.update(id="three", originalId="third")
        r = self.report([self.item, two, three])
        self.assertEqual(r["approvedOriginals"], 1)

    def test_malformed_records_fail_closed(self):
        for value in [None, [], "bad", 1, {"id": [], "category": []}]:
            with self.subTest(value=value):
                self.assertEqual(self.report([value])["approvedOriginals"], 0)

    def test_release_diversity_policy_with_mocked_eligibility(self):
        # Policy-only test; no real asset acquisition or visual review is claimed.
        items = []
        for category, n in c.TARGETS.items():
            for _ in range(n):
                i = len(items)
                items.append({"id": str(i), "originalId": str(i), "category": category,
                    "provider": f"provider-{i%4}", "styleFamily": f"style-{i%4}",
                    "scenes": [f"scene-{i%20}"], "localization": "ko-KR" if i%3==0 else "global",
                    "payload": {"sha256": hashlib.sha256(str(i).encode()).hexdigest()}})
        with patch.object(c, "inspect_asset", side_effect=lambda item, root: {"id": item["id"], "eligible": True, "score": 90, "issues": []}):
            self.assertTrue(self.report(items, True)["releaseReady"])
            for item in items:
                item["provider"] = "one-provider"
            self.assertIn("provider-concentration-over-35-percent", self.report(items, True)["portfolioIssues"])

    def test_targets_total_1200(self):
        self.assertEqual(sum(c.TARGETS.values()), 1200)


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "fixture.zip"
        self.budget = {"expanded": 0, "downloaded": 0}

    def zip(self, entries):
        with zipfile.ZipFile(self.archive, "w") as z:
            for name, data in entries:
                z.writestr(name, data)

    def test_explicit_allowed_urls_only(self):
        self.assertEqual(a.checked_url("https://kenney.nl/file.zip"), "https://kenney.nl/file.zip")
        for url in ["http://kenney.nl/a", "https://kenney.nl.evil.test/a", "https://user@kenney.nl/a", "https://127.0.0.1/a", "file:///etc/passwd", "https://kenney.nl:8443/a"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                a.checked_url(url)

    def test_fonts_archives_scripts_are_not_retained(self):
        self.zip([("asset.png", b"synthetic"), ("font.TTF", b"font"), ("font.woff2", b"font"), ("nested.zip", b"zip"), ("run.py", b"code")])
        records = a.extract_assets(self.archive, self.root / "out", self.budget)
        self.assertEqual([r["path"] for r in records], ["asset.png"])
        self.assertEqual(records[0]["phase"], "quarantined")

    def test_archive_traversal_rejected(self):
        for name in ["../oops.png", "/oops.png", "C:/oops.png", "..\\oops.png"]:
            with self.subTest(name=name):
                self.zip([(name, b"bad")])
                with self.assertRaises(ValueError):
                    a.extract_assets(self.archive, self.root / "out", self.budget)

    def test_archive_symlink_rejected(self):
        info = zipfile.ZipInfo("link.png")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.zip([(info, b"/etc/passwd")])
        with self.assertRaises(ValueError):
            a.extract_assets(self.archive, self.root / "out", self.budget)

    def test_case_collision_rejected_for_macos(self):
        self.zip([("a.png", b"a"), ("A.png", b"b")])
        with self.assertRaises(ValueError):
            a.extract_assets(self.archive, self.root / "out", self.budget)

    def test_expansion_budget_enforced(self):
        self.zip([("a.png", b"12345")])
        with patch.object(a, "MAX_EXPANDED_BYTES", 4), self.assertRaises(ValueError):
            a.extract_assets(self.archive, self.root / "out", self.budget)

    def test_raw_empty_zip_not_success(self):
        self.zip([("font.ttf", b"font")])
        with self.assertRaises(ValueError):
            a.extract_assets(self.archive, self.root / "out", self.budget)

    def test_existing_output_never_overwritten(self):
        (self.root / "existing.txt").write_text("keep")
        with self.assertRaises(ValueError):
            a.acquire({"schema": "toonspectrum.asset-acquisition-plan.v1", "pilot": []}, self.root)
        self.assertEqual((self.root / "existing.txt").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
