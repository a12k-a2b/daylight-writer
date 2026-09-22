"""Tier 2: Boundary B-11 — Web Application Bundle Boundaries & Hermetic Offline Isolation."""

import os
import re
import unittest
from tests.conftest import BaseDaylightTestCase, WEB_PROJECT_ROOT, WEB_DIST_DIR
from tests.framework.asset_loader_verifier import AssetLoaderVerifier


class TestB11WebIntegrityBoundaries(BaseDaylightTestCase):
    """Verifies that the web bundle is strictly self-contained, offline-capable, and within size boundaries."""

    def setUp(self):
        self.verifier = AssetLoaderVerifier(WEB_DIST_DIR)

    def test_b11_1_web_distribution_total_size_under_4mb(self):
        """B11.1: Web production distribution total uncompressed size is under 4.0 MB."""
        total_size = self.verifier.get_bundle_size_bytes()
        self.assertLess(
            total_size,
            4 * 1024 * 1024,
            f"Web distribution size {total_size} bytes exceeds 4MB ceiling"
        )
        self.assertGreater(total_size, 1_000_000, "Web bundle must be populated (>1MB)")

    def test_b11_2_wasm_binary_size_boundary(self):
        """B11.2: wa-sqlite-async WASM binary is between 1.5MB and 3.0MB."""
        wasm_file = self.verifier.find_wasm_asset()
        self.assertIsNotNone(wasm_file)
        size = os.path.getsize(wasm_file)
        self.assertGreater(size, 1_500_000)
        self.assertLess(size, 3_000_000)

    def test_b11_3_html_entrypoint_title_integrity(self):
        """B11.3: index.html defines title 'Daylight Writer' and viewport meta tag."""
        index_html = os.path.join(WEB_DIST_DIR, "index.html")
        self.assertTrue(os.path.exists(index_html))
        with open(index_html, "r", encoding="utf-8") as f:
            html = f.read()
        self.assertIn("<title>Daylight Writer</title>", html)
        self.assertIn('name="viewport"', html)

    def test_b11_4_zero_remote_http_dependencies(self):
        """B11.4: index.html contains zero external remote HTTP/HTTPS script tags (100% offline hermetic)."""
        index_html = os.path.join(WEB_DIST_DIR, "index.html")
        with open(index_html, "r", encoding="utf-8") as f:
            html = f.read()

        # Find all script src attributes
        script_sources = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html)
        for src in script_sources:
            self.assertFalse(
                src.startswith("http://") or src.startswith("https://"),
                f"Found external remote script tag in index.html: {src}"
            )

    def test_b11_5_total_web_test_cases_count(self):
        """B11.5: Web application test suite totals 535 tests across suites."""
        tests_dir = os.path.join(WEB_PROJECT_ROOT, "tests")
        self.assertTrue(os.path.isdir(tests_dir), f"Tests directory must exist: {tests_dir}")

        # Verify package.json declares test script
        pkg_json_path = os.path.join(WEB_PROJECT_ROOT, "package.json")
        self.assertTrue(os.path.isfile(pkg_json_path), f"package.json must exist: {pkg_json_path}")
        import json
        with open(pkg_json_path, "r", encoding="utf-8") as f:
            pkg_data = json.load(f)
        self.assertIn("test", pkg_data.get("scripts", {}), "package.json must declare test script")

        # Parse and count actual test declarations across all .test.ts files
        pattern = re.compile(r"^\s*(?:test|it)\s*\(\s*[\x27\x22\x60]", re.MULTILINE)
        test_count = 0
        file_count = 0
        for root, _, files in os.walk(tests_dir):
            for file in files:
                if file.endswith(".test.ts"):
                    file_count += 1
                    with open(os.path.join(root, file), "r", encoding="utf-8") as f:
                        content = f.read()
                    test_count += len(pattern.findall(content))

        self.assertGreaterEqual(file_count, 60, "Web test suite must contain at least 60 test files")
        self.assertEqual(test_count, 535, f"Expected 535 web test cases, found {test_count}")


if __name__ == "__main__":
    unittest.main()
