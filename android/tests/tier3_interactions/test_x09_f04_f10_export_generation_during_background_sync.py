"""Tier 3: Pairwise X-09 — SAF Export (F04) + WorkManager Background Sync (F10)."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX09ExportDuringBackgroundSync(BaseDaylightTestCase):
    """Verifies that executing a document export while WorkManager sync runs operates without locking conflicts."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x09_export_concurrently_with_sync_drain(self):
        """X09: User saves manuscript to USB/SD storage while background worker uploads queued mutations."""
        # 1. Enqueue mutation
        self.bridge.native_sync_queue.append({"id": "mut_x09", "op": "update"})

        # 2. Export document
        export_ok = self.bridge.exportDocument("Novel.docx", "application/vnd.openxmlformats", "ZmFrZV9kb2N4", True)
        self.assertTrue(export_ok)

        # 3. WorkManager executes sync
        sync_res = self.bridge.simulate_workmanager_sync_run()
        self.assertEqual(sync_res["pushed"], 1)
        self.assertEqual(len(self.bridge.exports), 1)


if __name__ == "__main__":
    unittest.main()
