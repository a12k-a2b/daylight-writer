"""Tier 3: Pairwise X-02 — SAF File Export (F04) + Hall Sensor Emergency Flush (F09)."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX02SafExportDuringHallFlush(BaseDaylightTestCase):
    """Verifies that closing folio cover during an in-flight export executes flush without corrupting output."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x02_export_stream_with_subsequent_emergency_save_point(self):
        """X02: User exports document, folio closes, triggering SQLite save point while export finishes."""
        # 1. Trigger export
        export_success = self.bridge.exportDocument(
            "Draft.md",
            "text/markdown",
            "# Final Draft Content",
            False
        )
        self.assertTrue(export_success)

        # 2. Folio closes
        self.bridge.simulate_folio_cover_closed()
        self.assertEqual(len(self.bridge.flush_completion_history), 1)
        self.assertTrue(self.bridge.flush_completion_history[-1]["success"])

        # 3. Verify export record remains uncorrupted
        self.assertEqual(self.bridge.exports[-1].filename, "Draft.md")
        self.assertEqual(self.bridge.exports[-1].bytes_written, len("# Final Draft Content"))


if __name__ == "__main__":
    unittest.main()
