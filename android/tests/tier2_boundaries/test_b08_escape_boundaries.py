"""Tier 2: Boundary B-08 — Escape Key Edge Cases & Multi-Dismissal."""

import unittest
from tests.conftest import BaseDaylightTestCase, KEYCODE_ESCAPE
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestB08EscapeBoundaries(BaseDaylightTestCase):
    """Verifies Escape key behavior during ACTION_UP, rapid presses, and non-modal states."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_b08_1_escape_key_action_up_does_not_double_dismiss(self):
        """B8.1: Escape key on ACTION_UP (action=1) is not processed as a new dismissal."""
        self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0) # DOWN
        count = self.bridge.web_dismiss_drawers_calls

        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=1) # UP
        self.assertFalse(consumed)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, count)

    def test_b08_2_rapid_escape_hammering_stress_test(self):
        """B8.2: Hammering Escape key 100 times executes stably without state corruption."""
        for _ in range(100):
            self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 100)

    def test_b08_3_escape_preserves_sub_millisecond_latency(self):
        """B8.3: Escape key processing completes in sub-millisecond time (<1ms)."""
        import time
        t0 = time.perf_counter()
        for _ in range(50):
            self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        dur_ms = ((time.perf_counter() - t0) / 50.0) * 1000
        self.assertLess(dur_ms, 1.0)

    def test_b08_4_escape_never_exits_application(self):
        """B8.4: Repeated Escape key events always return true on ACTION_DOWN, blocking onBackPressed."""
        for _ in range(10):
            consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
            self.assertTrue(consumed)

    def test_b08_5_back_key_behavior_isolation(self):
        """B8.5: KEYCODE_BACK (4) is distinct from KEYCODE_ESCAPE (111)."""
        KEYCODE_BACK = 4
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_BACK, action=0)
        # Default pass-through unless specifically mapped
        self.assertFalse(consumed)


if __name__ == "__main__":
    unittest.main()
