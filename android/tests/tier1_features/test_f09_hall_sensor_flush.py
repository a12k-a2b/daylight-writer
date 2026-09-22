"""Tier 1: Feature F-09 — Folio Hall Sensor & Emergency Save Point Flush."""

import unittest
from tests.conftest import (
    BaseDaylightTestCase,
    HALL_SENSOR_EVENT_NODE,
    HALL_SWITCH_CODE,
    ACTION_SCREEN_OFF,
    WAKELOCK_TIMEOUT_MS,
)
from tests.framework.device_driver import DC1DeviceDriver
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestF09HallSensorFlush(BaseDaylightTestCase):
    """Verifies DC1 magnetic folio cover Hall sensor (SW_LID) emergency SQLite WAL flush."""

    def setUp(self):
        self.driver = DC1DeviceDriver()
        self.bridge = DaylightBridgeSimulator()

    def test_f09_1_hall_sensor_input_device_present(self):
        """F9.1: /dev/input/event3 exposes hall_sensor with SW_LID (0x00) switch."""
        info = self.driver.check_input_device(HALL_SENSOR_EVENT_NODE)
        self.assertTrue(info["present"])
        self.assertEqual(info.get("name"), "hall_sensor")
        self.assertEqual(HALL_SWITCH_CODE, 0x00)

    def test_f09_2_screen_off_action_defined(self):
        """F9.2: ACTION_SCREEN_OFF broadcast string matches Android system intent."""
        self.assertEqual(ACTION_SCREEN_OFF, "android.intent.action.SCREEN_OFF")

    def test_f09_3_wakelock_timeout_is_3000ms(self):
        """F9.3: Partial WakeLock acquires with a strict 3000ms safety timeout ceiling."""
        self.assertEqual(WAKELOCK_TIMEOUT_MS, 3000)
        self.assertEqual(self.bridge.wakelock.timeout_ms, 3000)

    def test_f09_4_folio_closure_executes_emergency_flush(self):
        """F9.4: Closing folio cover triggers flush and records onFlushCompleted."""
        initial_flushes = len(self.bridge.flush_completion_history)
        self.bridge.simulate_folio_cover_closed()
        self.assertEqual(len(self.bridge.flush_completion_history), initial_flushes + 1)
        last_flush = self.bridge.flush_completion_history[-1]
        self.assertTrue(last_flush["success"])
        self.assertEqual(last_flush["dirty_remaining"], 0)

    def test_f09_5_wakelock_released_after_flush_completed(self):
        """F9.5: WakeLock is cleanly released when onFlushCompleted is invoked."""
        self.bridge.wakelock.is_held = True
        self.bridge.onFlushCompleted(success=True, dirty_remaining=0)
        self.assertFalse(self.bridge.wakelock.is_held, "WakeLock must be released after flush completes")


if __name__ == "__main__":
    unittest.main()
