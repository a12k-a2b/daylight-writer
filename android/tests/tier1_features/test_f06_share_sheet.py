"""Tier 1: Feature F-06 — Native System Share Sheet."""

import base64
import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestF06ShareSheet(BaseDaylightTestCase):
    """Verifies native Android share sheet integration (Intent.ACTION_SEND & FileProvider)."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_f06_1_share_text_draft(self):
        """F6.1: Sharing text draft dispatches Intent.ACTION_SEND with text/plain."""
        success = self.bridge.shareDocument(
            title="Short Story",
            mime_type="text/plain",
            content_or_base64="Story excerpt for social review.",
            is_binary=False
        )
        self.assertTrue(success)
        self.assertEqual(len(self.bridge.shares), 1)
        share = self.bridge.shares[0]
        self.assertEqual(share.title, "Short Story")
        self.assertEqual(share.mime_type, "text/plain")
        self.assertEqual(share.text_content, "Story excerpt for social review.")
        self.assertFalse(share.is_binary)

    def test_f06_2_share_binary_pdf_with_file_provider(self):
        """F6.2: Sharing binary PDF uses FileProvider content URI."""
        pdf_bytes = b"%PDF-1.4 sample stream"
        b64 = base64.b64encode(pdf_bytes).decode("ascii")

        success = self.bridge.shareDocument(
            title="Chapter1.pdf",
            mime_type="application/pdf",
            content_or_base64=b64,
            is_binary=True
        )
        self.assertTrue(success)
        share = self.bridge.shares[-1]
        self.assertTrue(share.is_binary)
        self.assertIn("content://com.daylight.writer.fileprovider/", share.content_uri)

    def test_f06_3_share_binary_includes_read_permission_flag(self):
        """F6.3: FileProvider share attaches FLAG_GRANT_READ_URI_PERMISSION (0x00000001)."""
        pdf_bytes = b"%PDF-1.4 test"
        b64 = base64.b64encode(pdf_bytes).decode("ascii")
        self.bridge.shareDocument("Book.pdf", "application/pdf", b64, True)
        share = self.bridge.shares[-1]
        self.assertEqual(share.flags, 0x00000001)

    def test_f06_4_malformed_base64_in_binary_share_rejected(self):
        """F6.4: Corrupt Base64 string in binary share returns false."""
        success = self.bridge.shareDocument("Doc.pdf", "application/pdf", "%%%not_base64%%%", True)
        self.assertFalse(success)

    def test_f06_5_missing_mime_type_rejected(self):
        """F6.5: Empty MIME type returns false."""
        success = self.bridge.shareDocument("Title", "", "content", False)
        self.assertFalse(success)


if __name__ == "__main__":
    unittest.main()
