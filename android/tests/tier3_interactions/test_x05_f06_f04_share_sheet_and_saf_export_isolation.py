"""Tier 3: Pairwise X-05 — Share Sheet (F06) + SAF File Export (F04)."""

import base64
import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX05ShareSheetAndSafExportIsolation(BaseDaylightTestCase):
    """Verifies that temporary FileProvider sharing does not collide with user-selected SAF export targets."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x05_share_and_export_maintain_independent_uris(self):
        """X05: Exporting to SAF and sharing via FileProvider produce isolated destination URIs."""
        pdf_bytes = b"%PDF-1.4 sample content"
        b64 = base64.b64encode(pdf_bytes).decode("ascii")

        # SAF Export
        self.bridge.exportDocument("Book.pdf", "application/pdf", b64, True)
        export_uri = self.bridge.exports[-1].destination_uri

        # Share Sheet
        self.bridge.shareDocument("Book.pdf", "application/pdf", b64, True)
        share_uri = self.bridge.shares[-1].content_uri

        self.assertIn("externalstorage.documents", export_uri)
        self.assertIn("daylight.writer.fileprovider", share_uri)
        self.assertNotEqual(export_uri, share_uri)


if __name__ == "__main__":
    unittest.main()
