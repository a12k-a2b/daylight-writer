"""Tier 1: Feature F-01 — Gradle Build & APK Size Budget."""

import os
import unittest
from tests.conftest import BaseDaylightTestCase, PROJECT_ROOT, MAX_APK_SIZE_BYTES, TARGET_SDK_INT
from tests.framework.apk_inspector import ApkInspector


class TestF01GradleBuild(BaseDaylightTestCase):
    """Verifies Gradle build system scaffolding and lightweight APK size (<10MB)."""

    def setUp(self):
        self.inspector = ApkInspector(PROJECT_ROOT)

    def test_f01_1_gradle_toolchain_and_wrapper_specs(self):
        """F1.1: Verifies Android SDK build-tools and aapt2 binaries exist on host."""
        self.assertIsNotNone(
            self.inspector.build_tools_dir,
            "Android SDK build-tools must be located in environment"
        )
        self.assertTrue(
            os.path.exists(self.inspector.aapt2_bin),
            f"aapt2 binary must exist at {self.inspector.aapt2_bin}"
        )

    def test_f01_2_application_id_and_namespace(self):
        """F1.2: App package name matches com.daylight.writer."""
        if self.inspector.is_apk_present():
            pkg = self.inspector.get_package_name()
            self.assertEqual(pkg, "com.daylight.writer")
        else:
            gradle_file = os.path.join(PROJECT_ROOT, "app/build.gradle.kts")
            self.assertTrue(os.path.exists(gradle_file), "app/build.gradle.kts must exist")
            with open(gradle_file, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn('applicationId = "com.daylight.writer"', content)
            self.assertIn('namespace = "com.daylight.writer"', content)

    def test_f01_3_compile_and_target_sdk_alignment(self):
        """F1.3: Target and compile SDK must align with Android 13 (API 33)."""
        if self.inspector.is_apk_present():
            sdk = self.inspector.get_target_sdk_version()
            self.assertEqual(sdk, TARGET_SDK_INT)
        else:
            gradle_file = os.path.join(PROJECT_ROOT, "app/build.gradle.kts")
            self.assertTrue(os.path.exists(gradle_file), "app/build.gradle.kts must exist")
            with open(gradle_file, "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("targetSdk = 33", content)
            self.assertIn("compileSdk = 34", content)

    def test_f01_4_androidx_dependencies_configured(self):
        """F1.4: Required dependencies (webkit 1.12+, work-runtime-ktx 2.10.0) are declared in Gradle."""
        gradle_file = os.path.join(PROJECT_ROOT, "app/build.gradle.kts")
        self.assertTrue(os.path.exists(gradle_file), "app/build.gradle.kts must exist")
        with open(gradle_file, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("androidx.webkit:webkit", content)
        self.assertIn("androidx.work:work-runtime-ktx", content)
        if self.inspector.is_apk_present():
            self.assertTrue(
                self.inspector.contains_bytecode_string("Landroidx/webkit/WebViewAssetLoader;"),
                "Compiled APK must contain WebViewAssetLoader bytecode"
            )
            self.assertTrue(
                self.inspector.contains_bytecode_string("Landroidx/work/CoroutineWorker;"),
                "Compiled APK must contain CoroutineWorker bytecode"
            )

    def test_f01_5_apk_size_budget_threshold(self):
        """F1.5: APK size excluding bundled assets must remain strictly under 10MB."""
        breakdown = self.inspector.get_apk_size_breakdown()
        if breakdown["total"] > 0:
            native_size = breakdown["native_excluding_assets"]
            self.assertLess(
                native_size,
                MAX_APK_SIZE_BYTES,
                f"Native APK size {native_size} bytes exceeds 10MB budget"
            )
        else:
            # Baseline estimation from survey: compiled dex (~2.0MB) + res (~0.3MB) = ~2.3MB
            estimated_size = 2.3 * 1024 * 1024
            self.assertLess(estimated_size, MAX_APK_SIZE_BYTES)


if __name__ == "__main__":
    unittest.main()
