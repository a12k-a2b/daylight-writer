"""Tier 1: Feature F-02 — WebViewAssetLoader & WASM MIME Type Configuration."""

import os
import unittest
from tests.conftest import BaseDaylightTestCase, WEB_DIST_DIR
from tests.framework.asset_loader_verifier import AssetLoaderVerifier


class TestF02AssetLoader(BaseDaylightTestCase):
    """Verifies local HTTPS asset serving via AndroidX WebViewAssetLoader."""

    def setUp(self):
        self.verifier = AssetLoaderVerifier(WEB_DIST_DIR)

    def test_f02_1_production_bundle_presence(self):
        """F2.1: Production web bundle dist/index.html and dist/assets/ are fully populated."""
        self.assertTrue(
            self.verifier.check_production_bundle_exists(),
            "Production distribution must contain index.html and assets directory"
        )

    def test_f02_2_wasm_binary_asset_present(self):
        """F2.2: wa-sqlite-async WASM binary exists in assets bundle."""
        wasm_path = self.verifier.find_wasm_asset()
        self.assertIsNotNone(wasm_path, "wa-sqlite-async-*.wasm must exist in assets")
        self.assertGreater(os.path.getsize(wasm_path), 1_000_000, "WASM binary must be non-empty (>1MB)")

    def test_f02_3_wasm_mime_type_resolution(self):
        """F2.3: .wasm extension strictly resolves to application/wasm (never application/octet-stream)."""
        wasm_mime = self.verifier.resolve_mime_type("wa-sqlite-async.wasm")
        self.assertEqual(
            wasm_mime,
            "application/wasm",
            "WASM files must have Content-Type application/wasm for WebAssembly.instantiateStreaming"
        )

    def test_f02_4_cross_origin_isolation_headers_injected(self):
        """F2.4: Responses include COOP, COEP, and CORS headers required for OPFS and Web Workers."""
        test_url = "https://appassets.androidplatform.net/assets/index.html"
        status, mime, headers, data = self.verifier.simulate_intercept_request(test_url)
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cross-Origin-Opener-Policy"), "same-origin")
        self.assertEqual(headers.get("Cross-Origin-Embedder-Policy"), "require-corp")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")

    def test_f02_5_secure_context_https_origin(self):
        """F2.5: Origin https://appassets.androidplatform.net satisfies secure context requirements."""
        self.assertEqual(self.verifier.EXPECTED_SCHEME, "https")
        self.assertEqual(self.verifier.EXPECTED_DOMAIN, "appassets.androidplatform.net")


if __name__ == "__main__":
    unittest.main()
