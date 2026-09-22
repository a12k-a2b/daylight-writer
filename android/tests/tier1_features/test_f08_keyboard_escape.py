"""Tier 1: Feature F-08 — Physical Keyboard & Escape Key Interception."""

import unittest
from tests.conftest import BaseDaylightTestCase, KEYCODE_ESCAPE
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestF08KeyboardEscape(BaseDaylightTestCase):
    """Verifies physical keyboard shortcuts and Escape key light-dismissal (preventing back exit)."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_f08_1_escape_key_constant_code(self):
        """F8.1: KEYCODE_ESCAPE corresponds to Android KeyEvent.KEYCODE_ESCAPE (111)."""
        self.assertEqual(KEYCODE_ESCAPE, 111)

    def test_f08_2_escape_key_intercept_returns_true(self):
        """F8.2: Intercepting KEYCODE_ESCAPE returns true to suppress Android default onBackPressed."""
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        self.assertTrue(consumed, "Escape key must be consumed to prevent system exit")

    def test_f08_3_escape_dispatches_dismiss_drawers(self):
        """F8.3: Escape key invokes dismiss_drawers reverse dispatch."""
        self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        self.assertIn("dismiss_drawers", self.bridge.web_keyboard_actions)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 1)

    def test_f08_4_multiple_escape_presses_handled_idempotently(self):
        """F8.4: Repeated Escape key presses continue to dismiss cleanly without crashing."""
        for _ in range(5):
            consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
            self.assertTrue(consumed)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 5)

    def test_f08_5_unhandled_keys_pass_through(self):
        """F8.5: Keys other than Action (142) and Escape (111) return false for normal processing."""
        KEYCODE_A = 29
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_A, action=0)
        self.assertFalse(consumed, "Standard typing keys must pass through to WebView")


if __name__ == "__main__":
    unittest.main()
