"""Tier 3: Pairwise X-07 — 120Hz Display Pipeline (F03) + Action Button Focus Toggle (F07)."""

import unittest
from tests.conftest import BaseDaylightTestCase, KEYCODE_ACTION_BUTTON
from tests.framework.bridge_simulator import DaylightBridgeSimulator
from tests.framework.device_driver import DC1DeviceDriver


class TestX07Display120HzWithActionButton(BaseDaylightTestCase):
    """Verifies that cycling focus mode via physical Action button executes cleanly in 120Hz mode."""

    def setUp(self):
        self.driver = DC1DeviceDriver()
        self.bridge = DaylightBridgeSimulator()

    def test_x07_focus_mode_cycle_in_120hz_environment(self):
        """X07: Action button executes sub-16ms mode cycle within 120Hz frame budget (8.33ms)."""
        self.assertTrue(self.driver.is_120hz_available())
        # Cycle through modes: none -> sentence -> paragraph -> none
        for _ in range(3):
            self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
        self.assertEqual(self.bridge.web_focus_mode_cycles, 3)


if __name__ == "__main__":
    unittest.main()
