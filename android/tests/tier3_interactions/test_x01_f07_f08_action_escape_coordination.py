"""Tier 3: Pairwise X-01 — Chassis Action Button (F07) + Keyboard Escape Key (F08)."""

import unittest
from tests.conftest import BaseDaylightTestCase, KEYCODE_ACTION_BUTTON, KEYCODE_ESCAPE
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX01ActionEscapeCoordination(BaseDaylightTestCase):
    """Verifies that Action button toggling drawers/modes coordinates with Escape key light-dismissal."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x01_action_followed_by_immediate_escape(self):
        """X01: User presses Action button to cycle focus mode, then hits Escape to dismiss chrome."""
        # Step 1: Action button press
        consumed_action = self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
        self.assertTrue(consumed_action)
        self.assertEqual(self.bridge.web_focus_mode_cycles, 1)

        # Step 2: Immediate Escape key press
        consumed_escape = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        self.assertTrue(consumed_escape)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 1)
        self.assertIn("dismiss_drawers", self.bridge.web_keyboard_actions)


if __name__ == "__main__":
    unittest.main()
