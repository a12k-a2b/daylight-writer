"""Tier 4: Workload W-05 — Offline Manuscript Sync via WorkManager."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestW05OfflineManuscriptSyncViaWorkManager(BaseDaylightTestCase):
    """Scenario 5: Offline edits queue into sync_queue; network restoration triggers DaylightSyncWorker."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_w05_offline_edits_and_workmanager_sync_drain(self):
        """W05: Multiple offline edits accumulate in native sync queue; background worker drains to cloud."""
        # 1. Author works offline: creates 3 chapters, edits 2 notes
        mutations = [
            {"id": "mut_w05_1", "entity": "document", "op": "create", "title": "Chapter 1"},
            {"id": "mut_w05_2", "entity": "document", "op": "create", "title": "Chapter 2"},
            {"id": "mut_w05_3", "entity": "document", "op": "create", "title": "Chapter 3"},
            {"id": "mut_w05_4", "entity": "note", "op": "create", "text": "Research reference"},
            {"id": "mut_w05_5", "entity": "note", "op": "update", "text": "Updated note"},
        ]
        self.bridge.native_sync_queue.extend(mutations)
        self.bridge.onSyncQueueUpdated(len(mutations))
        self.assertEqual(len(self.bridge.native_sync_queue), 5)

        # 2. Network restores and WorkManager periodic constraint fires
        sync_result = self.bridge.simulate_workmanager_sync_run()
        self.assertEqual(sync_result["pushed"], 5)
        self.assertEqual(len(self.bridge.native_sync_queue), 0)
        self.assertEqual(self.bridge.web_sync_triggers, 1)


if __name__ == "__main__":
    unittest.main()
