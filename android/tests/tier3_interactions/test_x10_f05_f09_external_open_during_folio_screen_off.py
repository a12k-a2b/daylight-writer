"""Tier 3: Pairwise X-10 — SAF Open / ACTION_VIEW (F05) + Folio Hall Sensor (F09)."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX10ExternalOpenDuringFolioScreenOff(BaseDaylightTestCase):
    """Verifies that an external file open intent received right before folio sleep flushes safely."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x10_import_external_file_then_folio_sleep(self):
        """X10: Document imported from file manager; user immediately snaps folio shut; doc persists."""
        doc_id = self.bridge.simulate_external_file_opened("Incoming.md", "# Incoming Draft", "text/markdown")
        self.assertIsNotNone(doc_id)

        # Folio closes
        self.bridge.simulate_folio_cover_closed()
        self.assertEqual(len(self.bridge.flush_completion_history), 1)
        self.assertTrue(self.bridge.flush_completion_history[-1]["success"])
        self.assertEqual(self.bridge.web_imported_documents[-1]["id"], doc_id)


if __name__ == "__main__":
    unittest.main()
