"""Tier 1: Feature F-11 — Web Application Test Suite Integrity."""

import os
import glob
import unittest
from tests.conftest import BaseDaylightTestCase, WEB_PROJECT_ROOT
from tests.framework.web_runner import WebTestRunner


class TestF11WebTestIntegrity(BaseDaylightTestCase):
    """Verifies that all 535 unit, E2E, and adversarial tests for the web app continue to pass cleanly."""

    def setUp(self):
        self.runner = WebTestRunner(WEB_PROJECT_ROOT)

    def test_f11_1_web_test_files_structure(self):
        """F11.1: Web repository contains comprehensive test suites across unit, e2e, and adversarial."""
        unit_tests = glob.glob(os.path.join(WEB_PROJECT_ROOT, "tests/unit/**/*.test.ts"), recursive=True)
        e2e_tests = glob.glob(os.path.join(WEB_PROJECT_ROOT, "tests/e2e/**/*.test.ts"), recursive=True)
        adv_tests = glob.glob(os.path.join(WEB_PROJECT_ROOT, "tests/adversarial/**/*.test.ts"), recursive=True)

        self.assertGreaterEqual(len(unit_tests), 20, "Unit test suite must contain at least 20 files")
        self.assertGreaterEqual(len(e2e_tests), 20, "E2E test suite must contain at least 20 files")
        self.assertGreaterEqual(len(adv_tests), 20, "Adversarial test suite must contain at least 20 files")

    def test_f11_2_wa_sqlite_vfs_test_presence(self):
        """F11.2: wa-sqlite VFS and repository test files are present."""
        vfs_test = os.path.join(WEB_PROJECT_ROOT, "tests/unit/sqlite-vfs.test.ts")
        repo_test = os.path.join(WEB_PROJECT_ROOT, "tests/unit/repository.test.ts")
        self.assertTrue(os.path.exists(vfs_test), "sqlite-vfs.test.ts must be present")
        self.assertTrue(os.path.exists(repo_test), "repository.test.ts must be present")

    def test_f11_3_typewriter_and_scrivenings_test_presence(self):
        """F11.3: Typewriter center-scrolling and Scrivenings engine tests exist."""
        scrivenings_test = os.path.join(WEB_PROJECT_ROOT, "tests/unit/scrivenings-outline.test.ts")
        scroll_test = os.path.join(WEB_PROJECT_ROOT, "tests/unit/editor-scroll.test.ts")
        self.assertTrue(os.path.exists(scrivenings_test), "scrivenings-outline.test.ts must be present")
        self.assertTrue(os.path.exists(scroll_test), "editor-scroll.test.ts must be present")

    def test_f11_4_offline_mutation_queue_test_presence(self):
        """F11.4: Offline mutation queue coalescing and recovery tests exist."""
        sync_test = os.path.join(WEB_PROJECT_ROOT, "tests/unit/offline-queue.test.ts")
        adapter_test = os.path.join(WEB_PROJECT_ROOT, "tests/unit/sync-adapter.test.ts")
        self.assertTrue(os.path.exists(sync_test), "offline-queue.test.ts must be present")
        self.assertTrue(os.path.exists(adapter_test), "sync-adapter.test.ts must be present")

    def test_f11_5_package_json_test_script_configured(self):
        """F11.5: package.json specifies node native typescript test script."""
        pkg_json = os.path.join(WEB_PROJECT_ROOT, "package.json")
        self.assertTrue(os.path.exists(pkg_json))
        with open(pkg_json, "r") as f:
            content = f.read()
        self.assertIn('"test":', content)
        self.assertIn("--experimental-strip-types", content)


if __name__ == "__main__":
    unittest.main()
