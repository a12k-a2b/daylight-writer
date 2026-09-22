"""Tier 2: Boundary B-09 — Folio Hall Sensor & WakeLock Safety Ceilings."""

import time
import unittest
from tests.conftest import BaseDaylightTestCase, WAKELOCK_TIMEOUT_MS
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestB09HallSensorBoundaries(BaseDaylightTestCase):
    """Verifies Hall sensor edge cases including rapid flap closure, WakeLock timeouts, and dirty flush retries."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_b09_1_rapid_folio_closure_cycles(self):
        """B9.1: Rapidly snapping folio closed 5 times records 5 emergency flush events."""
        for _ in range(5):
            self.bridge.simulate_folio_cover_closed()
        self.assertEqual(len(self.bridge.flush_completion_history), 5)
        self.assertFalse(self.bridge.wakelock.is_held)

    def test_b09_2_wakelock_timeout_safety_limit(self):
        """B9.2: WakeLock timeout ceiling is strictly 3000ms."""
        self.assertEqual(self.bridge.wakelock.timeout_ms, WAKELOCK_TIMEOUT_MS)
        self.assertEqual(WAKELOCK_TIMEOUT_MS, 3000)

    def test_b09_3_flush_failure_report_tracks_dirty_remaining(self):
        """B9.3: If SQLite WAL flush fails, dirty remaining count is captured."""
        self.bridge.onFlushCompleted(success=False, dirty_remaining=4)
        last = self.bridge.flush_completion_history[-1]
        self.assertFalse(last["success"])
        self.assertEqual(last["dirty_remaining"], 4)

    def test_b09_4_wakelock_released_even_on_flush_failure(self):
        """B9.4: WakeLock is released even when flush reports failure (preventing battery drain)."""
        self.bridge.wakelock.is_held = True
        self.bridge.onFlushCompleted(success=False, dirty_remaining=2)
        self.assertFalse(self.bridge.wakelock.is_held)

    def test_b09_5_zero_lag_flush_execution_time(self):
        """B9.5: Emergency save point initiates within 5ms of SCREEN_OFF broadcast."""
        t0 = time.perf_counter()
        self.bridge.simulate_folio_cover_closed()
        dur_ms = (time.perf_counter() - t0) * 1000
        self.assertLess(dur_ms, 5.0)


if __name__ == "__main__":
    unittest.main()
