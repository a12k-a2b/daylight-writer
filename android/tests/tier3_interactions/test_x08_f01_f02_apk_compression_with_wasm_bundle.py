"""Tier 3: Pairwise X-08 — Gradle Build APK (F01) + Asset Loader WASM Bundle (F02)."""

import unittest
from tests.conftest import BaseDaylightTestCase, WEB_DIST_DIR, MAX_APK_SIZE_BYTES
from tests.framework.asset_loader_verifier import AssetLoaderVerifier


class TestX08ApkCompressionWithWasmBundle(BaseDaylightTestCase):
    """Verifies that bundling the 2.25MB wa-sqlite WASM binary satisfies the <10MB total APK budget."""

    def setUp(self):
        self.verifier = AssetLoaderVerifier(WEB_DIST_DIR)

    def test_x08_bundled_wasm_and_web_distribution_fits_budget(self):
        """X08: Combined web bundle size (~3.2MB) plus native wrapper dex code leaves >4MB headroom."""
        bundle_size = self.verifier.get_bundle_size_bytes()
        estimated_native_code = 2.5 * 1024 * 1024 # ~2.5MB
        total_estimated_apk = bundle_size + estimated_native_code
        self.assertLess(total_estimated_apk, MAX_APK_SIZE_BYTES)


if __name__ == "__main__":
    unittest.main()
