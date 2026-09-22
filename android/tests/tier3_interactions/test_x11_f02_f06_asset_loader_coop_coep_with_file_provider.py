"""Tier 3: Pairwise X-11 — Asset Loader COOP/COEP (F02) + FileProvider Share Sheet (F06)."""

import unittest
from tests.conftest import BaseDaylightTestCase, WEB_DIST_DIR
from tests.framework.asset_loader_verifier import AssetLoaderVerifier
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX11AssetLoaderWithFileProvider(BaseDaylightTestCase):
    """Verifies that WebView Cross-Origin Isolation headers do not interfere with FileProvider sharing."""

    def setUp(self):
        self.verifier = AssetLoaderVerifier(WEB_DIST_DIR)
        self.bridge = DaylightBridgeSimulator()

    def test_x11_coop_coep_headers_alongside_file_provider_uris(self):
        """X11: Browser page runs in cross-origin isolated environment while native shares via FileProvider."""
        # Check asset loader headers
        status, mime, headers, _ = self.verifier.simulate_intercept_request(
            "https://appassets.androidplatform.net/assets/index.html"
        )
        self.assertEqual(headers["Cross-Origin-Opener-Policy"], "same-origin")
        self.assertEqual(headers["Cross-Origin-Embedder-Policy"], "require-corp")

        # Execute share via FileProvider
        share_ok = self.bridge.shareDocument("Story.txt", "text/plain", "Story content", False)
        self.assertTrue(share_ok)


if __name__ == "__main__":
    unittest.main()
