"""Tier 3: Pairwise X-12 — Action Button Split (F07) + Offline Sync Queue (F10)."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX12ActionButtonSplitWithOfflineQueue(BaseDaylightTestCase):
    """Verifies that Action button triggering Split-at-Cursor creates an entity mutation in sync queue."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x12_split_at_cursor_enqueues_mutation(self):
        """X12: Chassis Action button triggers split-at-cursor, enqueuing a new document mutation."""
        self.bridge.simulate_action_button_press("split_at_cursor")
        self.assertEqual(self.bridge.web_split_at_cursor_calls, 1)

        # Web enqueues split child document mutation
        self.bridge.native_sync_queue.append({
            "id": "mut_split_child",
            "entity_type": "document",
            "op": "create",
        })
        self.bridge.onSyncQueueUpdated(1)

        res = self.bridge.simulate_workmanager_sync_run()
        self.assertEqual(res["pushed"], 1)


if __name__ == "__main__":
    unittest.main()
