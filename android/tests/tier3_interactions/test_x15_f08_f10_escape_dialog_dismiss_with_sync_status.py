"""Tier 3: Pairwise X-15 — Escape Key (F08) + WorkManager Sync Status Indicator (F10)."""

import unittest
from tests.conftest import BaseDaylightTestCase, KEYCODE_ESCAPE
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX15EscapeDismissWithSyncStatus(BaseDaylightTestCase):
    """Verifies that dismissing the sync configuration modal via Escape preserves background worker state."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x15_escape_dismissal_preserves_background_sync(self):
        """X15: User opens sync dialog, Escape dismisses dialog; background sync proceeds unhindered."""
        # 1. Enqueue mutation
        self.bridge.native_sync_queue.append({"id": "mut_x15", "op": "create"})

        # 2. User dismisses modal via Escape key
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        self.assertTrue(consumed)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 1)

        # 3. WorkManager sync executes in background
        res = self.bridge.simulate_workmanager_sync_run()
        self.assertEqual(res["pushed"], 1)
        self.assertEqual(len(self.bridge.native_sync_queue), 0)


if __name__ == "__main__":
    unittest.main()
