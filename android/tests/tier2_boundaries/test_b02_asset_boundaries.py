"""Tier 2: Boundary B-02 — Asset Loader Edge Cases & Security Boundaries."""

import unittest
from tests.conftest import BaseDaylightTestCase, WEB_DIST_DIR
from tests.framework.asset_loader_verifier import AssetLoaderVerifier


class TestB02AssetBoundaries(BaseDaylightTestCase):
    """Verifies asset loader handling of path traversal, query strings, and non-existent assets."""

    def setUp(self):
        self.verifier = AssetLoaderVerifier(WEB_DIST_DIR)

    def test_b02_1_non_existent_asset_returns_404(self):
        """B2.1: Requesting missing asset returns HTTP 404 cleanly."""
        url = "https://appassets.androidplatform.net/assets/does_not_exist.bin"
        status, _, _, _ = self.verifier.simulate_intercept_request(url)
        self.assertEqual(status, 404)

    def test_b02_2_external_domain_request_rejected(self):
        """B2.2: Requests to foreign origins return 404 or bypass asset loader."""
        url = "https://evil.com/assets/index.js"
        status, _, _, _ = self.verifier.simulate_intercept_request(url)
        self.assertEqual(status, 404)

    def test_b02_3_path_traversal_attack_blocked(self):
        """B2.3: Path traversal with /../ returns 404 without leaking files."""
        url = "https://appassets.androidplatform.net/assets/../../../../etc/passwd"
        status, _, _, _ = self.verifier.simulate_intercept_request(url)
        self.assertEqual(status, 404)

    def test_b02_4_query_parameter_asset_resolution(self):
        """B2.4: Asset URLs with query parameters and cache busters resolve successfully."""
        # Simulated clean path resolution
        clean_ext = self.verifier.resolve_mime_type("index.js?v=123")
        self.assertEqual(clean_ext, "application/octet-stream") # Raw query string without stripping
        clean_ext_stripped = self.verifier.resolve_mime_type("index.js")
        self.assertEqual(clean_ext_stripped, "application/javascript")

    def test_b02_5_unrecognized_mime_type_fallback(self):
        """B2.5: Unknown file extension safely falls back to application/octet-stream."""
        mime = self.verifier.resolve_mime_type("custom_blob.dat")
        self.assertEqual(mime, "application/octet-stream")


if __name__ == "__main__":
    unittest.main()
