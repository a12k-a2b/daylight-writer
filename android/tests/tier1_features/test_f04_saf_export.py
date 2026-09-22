"""Tier 1: Feature F-04 — Storage Access Framework (SAF) File Export."""

import base64
import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestF04SafExport(BaseDaylightTestCase):
    """Verifies native file export bridge connecting web editor to Android SAF."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_f04_1_export_markdown_document(self):
        """F4.1: Exporting Markdown (.md) document streams UTF-8 text to SAF URI."""
        md_text = "# Chapter One\n\nThe desert was cold at dawn."
        success = self.bridge.exportDocument(
            filename="Chapter_1.md",
            mime_type="text/markdown",
            base64_data=md_text,
            is_binary=False
        )
        self.assertTrue(success)
        self.assertEqual(len(self.bridge.exports), 1)
        export = self.bridge.exports[0]
        self.assertEqual(export.filename, "Chapter_1.md")
        self.assertEqual(export.mime_type, "text/markdown")
        self.assertEqual(export.raw_data.decode("utf-8"), md_text)

    def test_f04_2_export_plain_text_document(self):
        """F4.2: Exporting Plain Text (.txt) document streams UTF-8 text."""
        txt_text = "Simple plain text manuscript draft without styling."
        success = self.bridge.exportDocument(
            filename="Draft.txt",
            mime_type="text/plain",
            base64_data=txt_text,
            is_binary=False
        )
        self.assertTrue(success)
        export = self.bridge.exports[-1]
        self.assertEqual(export.filename, "Draft.txt")
        self.assertEqual(export.raw_data.decode("utf-8"), txt_text)

    def test_f04_3_export_docx_binary_document(self):
        """F4.3: Exporting Word (.docx) document decodes Base64 payload cleanly."""
        fake_docx_bytes = b"PK\x03\x04\x14\x00\x06\x00fake_word_document_ooxml_zip"
        b64_payload = base64.b64encode(fake_docx_bytes).decode("ascii")
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        success = self.bridge.exportDocument(
            filename="Manuscript.docx",
            mime_type=mime,
            base64_data=b64_payload,
            is_binary=True
        )
        self.assertTrue(success)
        export = self.bridge.exports[-1]
        self.assertEqual(export.filename, "Manuscript.docx")
        self.assertEqual(export.raw_data, fake_docx_bytes)
        self.assertTrue(export.is_binary)

    def test_f04_4_export_pdf_binary_document(self):
        """F4.4: Exporting Vector PDF (.pdf) document decodes Base64 into binary stream."""
        fake_pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"
        b64_payload = base64.b64encode(fake_pdf_bytes).decode("ascii")

        success = self.bridge.exportDocument(
            filename="Anthology.pdf",
            mime_type="application/pdf",
            base64_data=b64_payload,
            is_binary=True
        )
        self.assertTrue(success)
        export = self.bridge.exports[-1]
        self.assertEqual(export.filename, "Anthology.pdf")
        self.assertEqual(export.raw_data, fake_pdf_bytes)

    def test_f04_5_empty_filename_rejected(self):
        """F4.5: Export request with empty filename or MIME type is rejected gracefully."""
        res1 = self.bridge.exportDocument("", "text/plain", "data", False)
        res2 = self.bridge.exportDocument("file.txt", "", "data", False)
        self.assertFalse(res1)
        self.assertFalse(res2)


if __name__ == "__main__":
    unittest.main()
