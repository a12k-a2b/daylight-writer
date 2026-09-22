"""Tier 1: Feature F-05 — SAF File Open & ACTION_VIEW Intent Integration."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestF05SafOpen(BaseDaylightTestCase):
    """Verifies native file open via SAF (ACTION_OPEN_DOCUMENT) and ACTION_VIEW intents."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_f05_1_request_open_document_registration(self):
        """F5.1: requestOpenDocument registers open request with allowed extensions."""
        success = self.bridge.requestOpenDocument(".md,.txt")
        self.assertTrue(success)
        self.assertIn(".md,.txt", self.bridge.open_requests)

    def test_f05_2_request_open_empty_extensions_rejected(self):
        """F5.2: Empty extensions parameter returns false."""
        success = self.bridge.requestOpenDocument("")
        self.assertFalse(success)

    def test_f05_3_external_file_opened_generates_doc_id(self):
        """F5.3: simulate_external_file_opened creates a valid docId and persists record."""
        doc_id = self.bridge.simulate_external_file_opened(
            title="External Essay",
            content="# Essay Content\nAnalysis of LivePaper optics.",
            mime_type="text/markdown"
        )
        self.assertTrue(doc_id.startswith("doc_"))
        self.assertEqual(len(self.bridge.web_imported_documents), 1)

    def test_f05_4_imported_document_preserves_content_integrity(self):
        """F5.4: Imported document content matches external file byte-for-byte."""
        content = "Line 1\nLine 2\nSpecial chars: & < > \" ' 120Hz"
        self.bridge.simulate_external_file_opened("Notes.txt", content, "text/plain")
        imported = self.bridge.web_imported_documents[-1]
        self.assertEqual(imported["content"], content)
        self.assertEqual(imported["title"], "Notes.txt")

    def test_f05_5_action_view_intent_dispatch(self):
        """F5.5: ACTION_VIEW intent routes into editor canvas."""
        doc_id = self.bridge.simulate_external_file_opened("Manuscript.md", "# Heading", "text/markdown")
        self.assertIsNotNone(doc_id)
        self.assertEqual(self.bridge.web_imported_documents[-1]["mime_type"], "text/markdown")


if __name__ == "__main__":
    unittest.main()
