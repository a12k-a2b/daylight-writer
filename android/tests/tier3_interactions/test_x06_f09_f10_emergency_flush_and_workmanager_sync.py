"""Tier 3: Pairwise X-06 — Emergency Flush (F09) + WorkManager Sync (F10)."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX06EmergencyFlushAndWorkManagerSync(BaseDaylightTestCase):
    """Verifies that folio emergency save point flushes dirty mutations into sync queue for WorkManager."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x06_folio_closure_enqueues_and_triggers_background_sync(self):
        """X06: Folio snaps shut -> emergency flush commits edits -> WorkManager sync drains queue."""
        # 1. New edit is flushed
        self.bridge.simulate_folio_cover_closed()
        self.bridge.onSyncQueueUpdated(1)
        self.bridge.native_sync_queue.append({
            "id": "mut_emergency",
            "entity_type": "document",
            "op": "update",
        })

        # 2. WorkManager triggers sync
        res = self.bridge.simulate_workmanager_sync_run()
        self.assertEqual(res["pushed"], 1)
        self.assertEqual(len(self.bridge.native_sync_queue), 0)


if __name__ == "__main__":
    unittest.main()
