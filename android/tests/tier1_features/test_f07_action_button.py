"""Tier 1: Feature F-07 — DC1 Chassis Action Button Interception."""

import unittest
from tests.conftest import (
    BaseDaylightTestCase,
    KEYPAD_EVENT_NODE,
    SCANCODE_ACTION_BUTTON,
    KEYCODE_ACTION_BUTTON,
)
from tests.framework.device_driver import DC1DeviceDriver
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestF07ActionButton(BaseDaylightTestCase):
    """Verifies DC1 chassis Top/Action button (mtk-kpd scancode 88 / KEYCODE_F12 142) interception."""

    def setUp(self):
        self.driver = DC1DeviceDriver()
        self.bridge = DaylightBridgeSimulator()

    def test_f07_1_kernel_keypad_driver_node(self):
        """F7.1: Kernel device node /dev/input/event1 exposes mtk-kpd driver."""
        info = self.driver.check_input_device(KEYPAD_EVENT_NODE)
        self.assertTrue(info["present"])
        self.assertEqual(info.get("name"), "mtk-kpd")

    def test_f07_2_action_button_scancode_and_keycode(self):
        """F7.2: Action button scancode 88 corresponds to KeyEvent.KEYCODE_F12 (142)."""
        self.assertEqual(SCANCODE_ACTION_BUTTON, 88)
        self.assertEqual(KEYCODE_ACTION_BUTTON, 142)

    def test_f07_3_dispatch_key_event_consumes_action_down(self):
        """F7.3: dispatchKeyEvent consumes KEYCODE_F12 on ACTION_DOWN and returns true."""
        consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
        self.assertTrue(consumed, "Action button key event must be consumed by MainActivity")

    def test_f07_4_action_button_triggers_focus_mode_cycle(self):
        """F7.4: Pressing Action button increments focus mode cycles in web editor."""
        initial_cycles = self.bridge.web_focus_mode_cycles
        self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
        self.assertEqual(self.bridge.web_focus_mode_cycles, initial_cycles + 1)

    def test_f07_5_action_button_alternate_split_trigger(self):
        """F7.5: Configured action button dispatches split_at_cursor when set."""
        self.bridge.simulate_action_button_press("split_at_cursor")
        self.assertEqual(self.bridge.web_split_at_cursor_calls, 1)


if __name__ == "__main__":
    unittest.main()
