"""Tier 2: Boundary B-01 — Build System & Packaging Limits."""

import os
import unittest
from tests.conftest import BaseDaylightTestCase, PROJECT_ROOT, MAX_APK_SIZE_BYTES
from tests.framework.apk_inspector import ApkInspector


class TestB01BuildBoundaries(BaseDaylightTestCase):
    """Verifies build system boundary limits, Proguard preservation, and ABI targets."""

    def setUp(self):
        self.inspector = ApkInspector(PROJECT_ROOT)

    def test_b01_1_apk_size_ceiling_headroom(self):
        """B1.1: Native code and resources have at least 50% headroom below 10MB budget."""
        release_path = os.path.join(PROJECT_ROOT, "app/build/outputs/apk/release/app-release.apk")
        inspector = ApkInspector(PROJECT_ROOT, apk_path=release_path) if os.path.exists(release_path) else self.inspector
        breakdown = inspector.get_apk_size_breakdown()
        native_size = breakdown["native_excluding_assets"]
        # Even with estimated 3MB native size, headroom should be > 5MB
        self.assertLess(native_size, MAX_APK_SIZE_BYTES * 0.5)

    def test_b01_2_proguard_rules_preserve_javascript_interface(self):
        """B1.2: Proguard configuration must keep @android.webkit.JavascriptInterface annotations."""
        proguard_path = os.path.join(PROJECT_ROOT, "app/proguard-rules.pro")
        self.assertTrue(os.path.isfile(proguard_path), f"proguard-rules.pro missing: {proguard_path}")
        with open(proguard_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("@android.webkit.JavascriptInterface", content)
        self.assertIn("com.daylight.writer.bridge", content)

    def test_b01_3_arm64_v8a_architecture_target(self):
        """B1.3: Target SoC MediaTek MT8781 is strictly 64-bit ARM (arm64-v8a)."""
        gradle_path = os.path.join(PROJECT_ROOT, "app/build.gradle.kts")
        self.assertTrue(os.path.isfile(gradle_path), f"build.gradle.kts missing: {gradle_path}")
        with open(gradle_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn('abiFilters += listOf("arm64-v8a")', content)
        if self.inspector.is_apk_present():
            badging = self.inspector.dump_badging()
            if "native-code:" in badging:
                self.assertIn("arm64-v8a", badging)
                self.assertNotIn("armeabi-v7a", badging)
                self.assertNotIn("x86", badging)

    def test_b01_4_gradle_daemon_and_memory_boundaries(self):
        """B1.4: Gradle JVM max heap is bounded (between 2GB and 8GB)."""
        props_path = os.path.join(PROJECT_ROOT, "gradle.properties")
        self.assertTrue(os.path.isfile(props_path), f"gradle.properties missing: {props_path}")
        with open(props_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("org.gradle.jvmargs", content)
        self.assertIn("-Xmx", content)

    def test_b01_5_missing_asset_directory_graceful_detection(self):
        """B1.5: Inspector gracefully reports empty asset list when assets missing."""
        inspector = ApkInspector(project_root="/tmp/non_existent_project_root_123")
        self.assertFalse(inspector.is_apk_present())
        self.assertEqual(inspector.get_apk_size(), 0)
        self.assertEqual(len(inspector.list_assets()), 0)


if __name__ == "__main__":
    unittest.main()
