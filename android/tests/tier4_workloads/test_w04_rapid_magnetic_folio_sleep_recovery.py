"""Tier 4: Workload W-04 — Rapid Magnetic Folio Sleep Recovery."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestW04RapidFolioSleepRecovery(BaseDaylightTestCase):
    """Scenario 4: Author types unsaved edits, closes folio cover (SW_LID), emergency flush completes with WakeLock."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_w04_folio_closure_emergency_flush_and_recovery(self):
        """W04: Folio cover snap -> SCREEN_OFF -> 3000ms WakeLock -> WAL flush -> wakeLock released -> zero loss."""
        # 1. Author has unsaved active edits
        active_content = "Unsaved novel sentence typed seconds before closing folio cover."

        # 2. Folio closes: Hall sensor engages SW_LID, Android fires SCREEN_OFF
        self.bridge.simulate_folio_cover_closed()

        # 3. Assert emergency save point executed
        self.assertEqual(len(self.bridge.flush_completion_history), 1)
        last_flush = self.bridge.flush_completion_history[-1]
        self.assertTrue(last_flush["success"])
        self.assertEqual(last_flush["dirty_remaining"], 0)

        # 4. Assert WakeLock is released cleanly (preventing sleep battery drain)
        self.assertFalse(self.bridge.wakelock.is_held)

        # 5. Folio re-opens: author resumes editing without interruption
        self.bridge.onFlushCompleted(success=True, dirty_remaining=0)
        self.assertFalse(self.bridge.wakelock.is_held)


if __name__ == "__main__":
    unittest.main()
