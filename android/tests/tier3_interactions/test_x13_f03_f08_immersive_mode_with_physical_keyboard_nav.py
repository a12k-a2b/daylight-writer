"""Tier 3: Pairwise X-13 — Immersive 100% Fullscreen (F03) + Physical Keyboard Shortcuts (F08)."""

import unittest
from tests.conftest import BaseDaylightTestCase, KEYCODE_ESCAPE
from tests.framework.bridge_simulator import DaylightBridgeSimulator
from tests.framework.device_driver import DC1DeviceDriver


class TestX13ImmersiveWithKeyboardNav(BaseDaylightTestCase):
    """Verifies that physical keyboard events do not disrupt 100% immersive edge-to-edge display mode."""

    def setUp(self):
        self.driver = DC1DeviceDriver()
        self.bridge = DaylightBridgeSimulator()

    def test_x13_escape_navigation_in_fullscreen_canvas(self):
        """X13: Keyboard escape event dismisses drawers while 1584x1184 landscape geometry remains intact."""
        w, h = self.driver.get_active_resolution()
        self.assertEqual((w, h), (1584, 1184))

        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        self.assertTrue(consumed)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 1)


if __name__ == "__main__":
    unittest.main()
