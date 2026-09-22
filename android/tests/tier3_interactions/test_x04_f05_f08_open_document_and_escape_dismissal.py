"""Tier 3: Pairwise X-04 — SAF File Open (F05) + Keyboard Escape Key (F08)."""

import unittest
from tests.conftest import BaseDaylightTestCase, KEYCODE_ESCAPE
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX04OpenDocumentAndEscapeDismissal(BaseDaylightTestCase):
    """Verifies that after importing an external document, pressing Escape dismisses library drawer."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x04_open_document_then_light_dismiss(self):
        """X04: Ingest document via SAF open, then hit Escape to return to full distraction-free canvas."""
        doc_id = self.bridge.simulate_external_file_opened("Essay.md", "# New Essay", "text/markdown")
        self.assertIsNotNone(doc_id)

        # User presses Escape to close open left drawer
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        self.assertTrue(consumed)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 1)


if __name__ == "__main__":
    unittest.main()
