"""Tier 4: Workload W-02 — Multi-Document Scrivenings Compilation."""

import base64
import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestW02MultiDocumentScriveningsCompilation(BaseDaylightTestCase):
    """Scenario 2: Multi-document binder organization, split-at-cursor, and unified DOCX/PDF export."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_w02_scrivenings_compilation_and_binary_export(self):
        """W02: Author splits scene, compiles 3 binder chunks into single manuscript, exports to DOCX & PDF."""
        # 1. Author triggers split at cursor
        self.bridge.simulate_action_button_press("split_at_cursor")
        self.assertEqual(self.bridge.web_split_at_cursor_calls, 1)

        # 2. Author compiles chapters into a unified Word (.docx) manuscript
        docx_blob = b"PK\x03\x04_UNIFIED_SCRIVENINGS_DOCX_STREAM_CHAPTERS_1_TO_3"
        b64_docx = base64.b64encode(docx_blob).decode("ascii")
        mime_docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        export_docx = self.bridge.exportDocument("Compiled_Novel.docx", mime_docx, b64_docx, True)
        self.assertTrue(export_docx)
        self.assertEqual(self.bridge.exports[-1].raw_data, docx_blob)

        # 3. Author compiles chapters into a unified PDF
        pdf_blob = b"%PDF-1.4\n1 0 obj << /Title (Compiled Novel) >> endobj\n%%EOF"
        b64_pdf = base64.b64encode(pdf_blob).decode("ascii")

        export_pdf = self.bridge.exportDocument("Compiled_Novel.pdf", "application/pdf", b64_pdf, True)
        self.assertTrue(export_pdf)
        self.assertEqual(self.bridge.exports[-1].raw_data, pdf_blob)


if __name__ == "__main__":
    unittest.main()
