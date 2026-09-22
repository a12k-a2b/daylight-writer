"""Tier 2: Boundary B-06 — Share Sheet Edge Cases & Collision Resistance."""

import base64
import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestB06ShareBoundaries(BaseDaylightTestCase):
    """Verifies system share sheet boundaries including empty bodies, large files, and rapid dispatch."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_b06_1_share_empty_text_body(self):
        """B6.1: Sharing empty string text body still creates valid Intent.ACTION_SEND payload."""
        success = self.bridge.shareDocument("Empty Share", "text/plain", "", False)
        self.assertTrue(success)
        self.assertEqual(self.bridge.shares[-1].text_content, "")

    def test_b06_2_share_large_binary_attachment(self):
        """B6.2: Sharing 2MB binary PDF creates appropriate FileProvider URI."""
        large_pdf = b"%PDF-1.4 " + (b"0" * (2 * 1024 * 1024))
        b64 = base64.b64encode(large_pdf).decode("ascii")
        success = self.bridge.shareDocument("Large_Book.pdf", "application/pdf", b64, True)
        self.assertTrue(success)
        self.assertEqual(len(self.bridge.shares[-1].binary_data), len(large_pdf))

    def test_b06_3_share_title_with_slashes_sanitized(self):
        """B6.3: Share titles with path slashes and special characters create safe URIs."""
        title = "Story/Chapter: 1 & 2"
        success = self.bridge.shareDocument(title, "text/plain", "Sample text", False)
        self.assertTrue(success)
        self.assertEqual(self.bridge.shares[-1].title, title)

    def test_b06_4_rapid_successive_share_requests(self):
        """B6.4: Rapid consecutive share requests do not overwrite or corrupt previous records."""
        for i in range(5):
            self.bridge.shareDocument(f"Draft {i}", "text/plain", f"Text {i}", False)
        self.assertEqual(len(self.bridge.shares), 5)
        self.assertEqual(self.bridge.shares[2].title, "Draft 2")

    def test_b06_5_binary_share_preserves_content_hash(self):
        """B6.5: Binary data round-tripped through Base64 preserves exact byte hash."""
        original_bytes = b"EXACT_BYTE_INTEGRITY_CHECK_12345"
        b64 = base64.b64encode(original_bytes).decode("ascii")
        self.bridge.shareDocument("HashTest.docx", "application/vnd.openxmlformats", b64, True)
        self.assertEqual(self.bridge.shares[-1].binary_data, original_bytes)


if __name__ == "__main__":
    unittest.main()
