"""Tier 2: Boundary B-07 — Chassis Action Button Timing & Modifier Boundaries."""

import unittest
from tests.conftest import BaseDaylightTestCase, KEYCODE_ACTION_BUTTON
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestB07ActionButtonBoundaries(BaseDaylightTestCase):
    """Verifies Action button rapid triggering, ACTION_UP filtering, and scancode isolation."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_b07_1_rapid_multi_press_stress_test(self):
        """B7.1: Rapidly pressing Action button 20 times increments focus cycles 20 times."""
        for _ in range(20):
            self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0) # ACTION_DOWN
        self.assertEqual(self.bridge.web_focus_mode_cycles, 20)

    def test_b07_2_action_up_does_not_trigger_duplicate_event(self):
        """B7.2: Action button on ACTION_UP (action=1) does not trigger another action."""
        # ACTION_DOWN triggers
        self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
        cycles_after_down = self.bridge.web_focus_mode_cycles

        # ACTION_UP must not increment
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=1)
        self.assertFalse(consumed)
        self.assertEqual(self.bridge.web_focus_mode_cycles, cycles_after_down)

    def test_b07_3_walkie_talkie_scancode_87_isolated(self):
        """B7.3: Scancode 87 (KEY_F11 / walkie-talkie) is not intercepted as Action button."""
        KEYCODE_F11 = 141
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_F11, action=0)
        self.assertFalse(consumed, "F11 must not trigger Action button handler")

    def test_b07_4_volume_buttons_isolated(self):
        """B7.4: Volume buttons on mtk-kpd (scancode 114 / 115) pass through untouched."""
        KEYCODE_VOLUME_DOWN = 25
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_VOLUME_DOWN, action=0)
        self.assertFalse(consumed)

    def test_b07_5_action_button_preserves_sub_16ms_latency_path(self):
        """B7.5: Action button dispatch path avoids heavy async loops and executes synchronously."""
        import time
        start = time.perf_counter()
        for _ in range(100):
            self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
        elapsed_per_call_ms = ((time.perf_counter() - start) / 100.0) * 1000
        # Must execute in under 1ms in memory (well below 16ms threshold)
        self.assertLess(elapsed_per_call_ms, 1.0)


if __name__ == "__main__":
    unittest.main()
