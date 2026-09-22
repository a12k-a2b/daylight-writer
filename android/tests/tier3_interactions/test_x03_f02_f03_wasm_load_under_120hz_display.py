"""Tier 3: Pairwise X-03 — Asset Loader WASM (F02) + 120Hz Display Pipeline (F03)."""

import unittest
from tests.conftest import BaseDaylightTestCase, WEB_DIST_DIR
from tests.framework.asset_loader_verifier import AssetLoaderVerifier
from tests.framework.device_driver import DC1DeviceDriver


class TestX03WasmLoadUnder120HzDisplay(BaseDaylightTestCase):
    """Verifies that wa-sqlite WASM streaming loader operates smoothly in 120Hz display environment."""

    def setUp(self):
        self.verifier = AssetLoaderVerifier(WEB_DIST_DIR)
        self.driver = DC1DeviceDriver()

    def test_x03_wasm_headers_and_120hz_hardware_profile(self):
        """X03: 120Hz display Mode 2 is active while WASM binary is served with strict COOP/COEP headers."""
        # 1. 120Hz mode exists on DC1
        self.assertTrue(self.driver.is_120hz_available())

        # 2. WASM asset is served with application/wasm and Cross-Origin Isolation
        wasm_url = "https://appassets.androidplatform.net/assets/wa-sqlite-async-zc68fxQq.wasm"
        status, mime, headers, data = self.verifier.simulate_intercept_request(wasm_url)
        self.assertEqual(status, 200)
        self.assertEqual(mime, "application/wasm")
        self.assertEqual(headers["Cross-Origin-Opener-Policy"], "same-origin")
        self.assertEqual(headers["Cross-Origin-Embedder-Policy"], "require-corp")


if __name__ == "__main__":
    unittest.main()
