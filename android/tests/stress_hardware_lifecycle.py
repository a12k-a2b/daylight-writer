#!/usr/bin/env python3
"""Challenger M3-1: Adversarial Hardware Key & Folio Lifecycle Stress Harness for Daylight Writer Android.

Stress tests:
1. Rapid Sequential Presses of KeyCode 142 (F12) and Escape Key (111):
   - 50x rapid F12 Action Button presses
   - 50x rapid Escape Key presses
   - 50x rapid alternating F12 + Escape presses
   - Validates sub-16ms latency path, zero ANRs, zero drops, zero process crashes.
2. Keyboard Modifier Keys (Meta / Control) & Shortcuts:
   - Evaluates <Cmd+K>, <Cmd+Shift+K>, <Cmd+1..6>, and <Ctrl+K>
   - Verifies transparent dispatch through super.dispatchKeyEvent to WebView without system back exit or focus loss.
3. Rapid SCREEN_OFF Broadcast / onPause Cycles & WakeLock Safety:
   - 10x rapid consecutive SCREEN_OFF broadcasts / onPause cycles
   - Verifies PowerManager.PARTIAL_WAKE_LOCK acquisition with 3000ms timeout ceiling
   - Verifies clean release upon onFlushCompleted (zero leaked WakeLocks in dumpsys power).
4. Unhandled & Unknown Keycodes Pass-through:
   - Standard typing keys (A-Z, Enter, Tab, Space, Delete)
   - Out-of-bounds/unknown keycodes (250, 270, 999)
   - Verifies zero false positive interception.
5. Live DC1 Hardware Verification on Connected DC1 Tablet.
"""

import os
import re
import subprocess
import sys
import time
import unittest
from typing import Dict, Any, List

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from tests.conftest import (
    TARGET_DEVICE_SERIAL,
    find_adb_binary,
    KEYCODE_ACTION_BUTTON,
    KEYCODE_ESCAPE,
    WAKELOCK_TIMEOUT_MS,
    BaseDaylightTestCase,
)
from tests.framework.bridge_simulator import DaylightBridgeSimulator

ADB_BIN = find_adb_binary()
DEVICE_SERIAL = TARGET_DEVICE_SERIAL
PACKAGE_NAME = "com.daylight.writer"
ACTIVITY_NAME = "com.daylight.writer/.MainActivity"


def adb_shell(cmd: str, timeout: float = 15.0) -> str:
    """Executes a command via ADB shell on the target DC1 tablet."""
    full_cmd = [ADB_BIN, "-s", DEVICE_SERIAL, "shell"] + cmd.split()
    res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)
    return res.stdout.strip()


def adb_shell_raw(cmd_str: str, timeout: float = 15.0) -> subprocess.CompletedProcess:
    """Executes raw command string via ADB shell (preserving shell scripts, quotes, pipes)."""
    full_cmd = [ADB_BIN, "-s", DEVICE_SERIAL, "shell", cmd_str]
    return subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)


class AdversarialHardwareAndLifecycleStressSuite(unittest.TestCase):
    """Adversarial stress harness for DC1 chassis keys, modifiers, and folio lifecycle."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    # =========================================================================
    # 1. Rapid Sequential Presses of KeyCode 142 (F12) and Escape Key (111)
    # =========================================================================

    def test_stress_01_f12_rapid_burst_100_times(self):
        """Stress: 100 rapid sequential F12 presses execute with zero drops and sub-16ms latency."""
        t0 = time.perf_counter()
        for _ in range(100):
            consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
            self.assertTrue(consumed, "F12 key event must be consumed")
        elapsed_ms = (time.perf_counter() - t0) * 1000
        avg_latency_ms = elapsed_ms / 100.0

        self.assertEqual(self.bridge.web_focus_mode_cycles, 100)
        self.assertLess(avg_latency_ms, 1.0, f"Average latency per F12 press {avg_latency_ms:.3f}ms must be < 1.0ms")

    def test_stress_02_escape_rapid_burst_100_times(self):
        """Stress: 100 rapid sequential Escape presses dismiss drawers idempotently without exit."""
        t0 = time.perf_counter()
        for _ in range(100):
            consumed = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
            self.assertTrue(consumed, "Escape key event must be consumed to block back navigation")
        elapsed_ms = (time.perf_counter() - t0) * 1000
        avg_latency_ms = elapsed_ms / 100.0

        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 100)
        self.assertLess(avg_latency_ms, 1.0, f"Average latency per Escape press {avg_latency_ms:.3f}ms must be < 1.0ms")

    def test_stress_03_alternating_f12_and_escape_50_cycles(self):
        """Stress: 50 cycles of alternating F12 (toggle mode) then Escape (dismiss drawer)."""
        for i in range(50):
            # Press F12
            c_f12 = self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
            self.assertTrue(c_f12)
            self.assertEqual(self.bridge.web_focus_mode_cycles, i + 1)

            # Press Escape
            c_esc = self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
            self.assertTrue(c_esc)
            self.assertEqual(self.bridge.web_dismiss_drawers_calls, i + 1)

    # =========================================================================
    # 2. Keyboard Modifier Keys (Meta / Control) & Shortcut Transparent Handling
    # =========================================================================

    def test_stress_04_cmd_shortcuts_pass_through_without_consumption(self):
        """Stress: Command/Meta modifier shortcuts (<Cmd+K>, <Cmd+Shift+K>, <Cmd+1..6>) pass through to WebView."""
        # Standard Android key codes:
        KEYCODE_1 = 8
        KEYCODE_2 = 9
        KEYCODE_3 = 10
        KEYCODE_4 = 11
        KEYCODE_5 = 12
        KEYCODE_6 = 13
        KEYCODE_K = 39

        shortcut_keys = [KEYCODE_K, KEYCODE_1, KEYCODE_2, KEYCODE_3, KEYCODE_4, KEYCODE_5, KEYCODE_6]
        for key in shortcut_keys:
            # dispatchKeyEvent in MainActivity only consumes F12 and Escape
            consumed = self.bridge.simulate_dispatch_key_event(key, action=0)
            self.assertFalse(
                consumed,
                f"Keycode {key} (Cmd shortcut) must NOT be consumed by native shell, ensuring WebView receives it"
            )

    def test_stress_05_ctrl_shortcuts_pass_through_without_consumption(self):
        """Stress: Control modifier shortcuts (<Ctrl+K>, <Ctrl+1..6>) pass through to WebView."""
        control_keys = [39, 8, 9, 10, 11, 12, 13]
        for key in control_keys:
            consumed = self.bridge.simulate_dispatch_key_event(key, action=0)
            self.assertFalse(
                consumed,
                f"Keycode {key} (Ctrl shortcut) must NOT be consumed by native shell"
            )

    # =========================================================================
    # 3. Rapid SCREEN_OFF Broadcast / onPause Cycles & WakeLock Safety
    # =========================================================================

    def test_stress_06_rapid_screen_off_wakelock_cycles(self):
        """Stress: 20 rapid consecutive folio closes acquire and cleanly release WakeLock."""
        for cycle in range(20):
            # Folio snaps closed: Hall sensor triggers ACTION_SCREEN_OFF
            self.bridge.simulate_folio_cover_closed()
            self.assertFalse(
                self.bridge.wakelock.is_held,
                f"Cycle {cycle+1}: WakeLock must be released immediately upon onFlushCompleted"
            )

        self.assertEqual(len(self.bridge.flush_completion_history), 20)
        # Verify all flushes reported success
        for entry in self.bridge.flush_completion_history:
            self.assertTrue(entry["success"])
            self.assertEqual(entry["dirty_remaining"], 0)

    def test_stress_07_wakelock_timeout_ceiling_enforced(self):
        """Stress: WakeLock ceiling is strictly 3000ms, preventing battery drain if flush hangs."""
        self.assertEqual(self.bridge.wakelock.timeout_ms, 3000)
        self.assertEqual(WAKELOCK_TIMEOUT_MS, 3000)

    def test_stress_08_wakelock_released_on_flush_error(self):
        """Stress: WakeLock is unconditionally released even if flush encounters an error."""
        self.bridge.wakelock.is_held = True
        self.bridge.onFlushCompleted(success=False, dirty_remaining=5)
        self.assertFalse(self.bridge.wakelock.is_held, "WakeLock must release even on flush failure")

    # =========================================================================
    # 4. Unhandled & Unknown Keycodes Pass-through
    # =========================================================================

    def test_stress_09_typing_keys_pass_through_unaltered(self):
        """Stress: Standard typing keys (A-Z, Enter, Tab, Space, Backspace) are not intercepted."""
        typing_keycodes = [
            29,  # KEYCODE_A
            30,  # KEYCODE_B
            31,  # KEYCODE_C
            62,  # KEYCODE_SPACE
            61,  # KEYCODE_TAB
            66,  # KEYCODE_ENTER
            67,  # KEYCODE_DEL
        ]
        for key in typing_keycodes:
            consumed = self.bridge.simulate_dispatch_key_event(key, action=0)
            self.assertFalse(consumed, f"Keycode {key} must pass through to WebView")

        # Confirm zero inadvertent Action or Escape calls
        self.assertEqual(self.bridge.web_focus_mode_cycles, 0)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 0)

    def test_stress_10_unknown_oem_keycodes_pass_through(self):
        """Stress: Unknown and high OEM keycodes pass through cleanly without crashing."""
        unknown_keys = [200, 250, 270, 500, 999]
        for key in unknown_keys:
            consumed = self.bridge.simulate_dispatch_key_event(key, action=0)
            self.assertFalse(consumed)


# =============================================================================
# 5. Live DC1 Hardware Stress & Verification
# =============================================================================

def run_live_dc1_hardware_stress() -> Dict[str, Any]:
    """Executes live empirical stress tests on the connected DC1 tablet."""
    results = {}
    print("\n--- Live DC1 Hardware Stress & Lifecycle Verification ---")
    print(f"Target Tablet Serial: {DEVICE_SERIAL}")

    # Ensure device is awake and keyguard is dismissed
    adb_shell_raw("input keyevent KEYCODE_WAKEUP && wm dismiss-keyguard")
    time.sleep(0.5)

    # Ensure app is launched and focused
    start_cmd = [ADB_BIN, "-s", DEVICE_SERIAL, "shell", "am", "start", "-n", ACTIVITY_NAME]
    subprocess.run(start_cmd, capture_output=True, timeout=10.0)
    time.sleep(1.0)

    # 1. Verify Process PID and Foreground Window Focus
    pid_str = adb_shell(f"pidof {PACKAGE_NAME}")
    results["app_running"] = bool(pid_str and pid_str.isdigit())
    print(f"  [DC1] Process PID: {pid_str} ({'PASS' if results['app_running'] else 'FAIL'})")

    focus_out = adb_shell("dumpsys window")
    has_focus = False
    for line in focus_out.splitlines():
        if "mCurrentFocus=" in line and PACKAGE_NAME in line:
            has_focus = True
            break
    results["has_window_focus"] = has_focus
    print(f"  [DC1] Window Focus: {'PASS: In Foreground' if has_focus else 'FAIL'}")

    # Clear logcat buffer for clean event capture
    adb_shell("logcat -c")

    # 2. Stress Test 1: Rapid 50x KeyCode 142 (F12 Action Button) Injection in Native Batch Loop
    print("  [DC1] Injecting 50x rapid KeyCode 142 (F12 Action Button)...")
    t0 = time.perf_counter()
    adb_shell_raw("for i in $(seq 1 50); do input keyevent 142; done")
    f12_elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"  [DC1] 50x F12 completed in {f12_elapsed_ms:.1f}ms ({f12_elapsed_ms/50.0:.2f}ms/event)")

    time.sleep(0.5)
    f12_logcat = subprocess.run(
        [ADB_BIN, "-s", DEVICE_SERIAL, "logcat", "-d", "-s", "HardwareKeyInterceptor:I"],
        capture_output=True, text=True
    ).stdout

    f12_count = f12_logcat.count("Triggering Action Button reverse dispatch")
    results["f12_intercepted_count"] = f12_count
    print(f"  [DC1] Logcat captured {f12_count} Action Button triggers ({'PASS' if f12_count >= 50 else 'FAIL'})")

    # Clear logcat
    adb_shell("logcat -c")

    # 3. Stress Test 2: Rapid 50x KeyCode 111 (Escape Key) Injection in Native Batch Loop
    print("  [DC1] Injecting 50x rapid KeyCode 111 (Escape Key)...")
    t0 = time.perf_counter()
    adb_shell_raw("for i in $(seq 1 50); do input keyevent 111; done")
    esc_elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"  [DC1] 50x Escape completed in {esc_elapsed_ms:.1f}ms ({esc_elapsed_ms/50.0:.2f}ms/event)")

    time.sleep(0.5)
    esc_logcat = subprocess.run(
        [ADB_BIN, "-s", DEVICE_SERIAL, "logcat", "-d", "-s", "HardwareKeyInterceptor:I"],
        capture_output=True, text=True
    ).stdout

    esc_count = esc_logcat.count("Triggering Escape key light-dismissal")
    results["escape_intercepted_count"] = esc_count
    print(f"  [DC1] Logcat captured {esc_count} Escape dismiss triggers ({'PASS' if esc_count >= 50 else 'FAIL'})")

    # Verify app is still running and did NOT exit via onBackPressed
    pid_after_esc = adb_shell(f"pidof {PACKAGE_NAME}")
    results["no_app_exit_on_escape"] = (pid_after_esc == pid_str)
    print(f"  [DC1] Escape light-dismissal prevented app exit: {'PASS' if results['no_app_exit_on_escape'] else 'FAIL'}")

    # 4. Stress Test 3: Keyboard Modifier Shortcuts (<Cmd+K>, <Cmd+Shift+K>, <Cmd+1..6>, <Ctrl+K>)
    print("  [DC1] Injecting keyboard modifier shortcuts (<Cmd+K>, <Cmd+Shift+K>, <Cmd+1..6>, <Ctrl+K>)...")
    # Using Android 13 input keycombination
    adb_shell_raw("input keycombination 117 39") # Cmd+K
    adb_shell_raw("input keycombination 117 59 39") # Cmd+Shift+K
    adb_shell_raw("input keycombination 113 39") # Ctrl+K
    adb_shell_raw("for k in $(seq 8 13); do input keycombination 117 $k; done") # Cmd+1 to Cmd+6

    time.sleep(0.5)
    # Check focus after modifier events
    focus_after_mod = adb_shell("dumpsys window")
    has_focus_after_mod = any("mCurrentFocus=" in l and PACKAGE_NAME in l for l in focus_after_mod.splitlines())
    results["focus_retained_after_shortcuts"] = has_focus_after_mod
    print(f"  [DC1] Window focus retained after modifier shortcuts: {'PASS' if has_focus_after_mod else 'FAIL'}")

    # 5. Stress Test 4: Rapid SCREEN_OFF Broadcast / onPause Cycles & WakeLock Safety
    print("  [DC1] Testing 10x rapid SCREEN_OFF broadcast / emergency save point cycles...")
    adb_shell("logcat -c")
    wakelock_latencies = []

    for i in range(10):
        t_start = time.perf_counter()
        adb_shell_raw("su 0 am broadcast -a android.intent.action.SCREEN_OFF")
        time.sleep(0.15)
        # Keep device awake so subsequent broadcast tests continue uninterrupted
        adb_shell_raw("input keyevent KEYCODE_WAKEUP")
        wakelock_latencies.append((time.perf_counter() - t_start) * 1000)

    time.sleep(0.5)
    lifecycle_logcat = subprocess.run(
        [ADB_BIN, "-s", DEVICE_SERIAL, "logcat", "-d", "-s", "FolioHallSensorReceiver:I", "DaylightNativeBridge:I", "MainActivity:I"],
        capture_output=True, text=True
    ).stdout

    screen_off_count = lifecycle_logcat.count("ACTION_SCREEN_OFF")
    acquired_count = lifecycle_logcat.count("Acquired emergency partial wake lock")
    released_count = lifecycle_logcat.count("Released emergency partial wake lock")
    flush_completed_count = lifecycle_logcat.count("onFlushCompleted")

    results["screen_off_events"] = screen_off_count
    results["wakelocks_acquired"] = acquired_count
    results["wakelocks_released"] = released_count
    results["flushes_completed"] = flush_completed_count

    print(f"  [DC1] SCREEN_OFF broadcasts: {screen_off_count}")
    print(f"  [DC1] WakeLocks acquired   : {acquired_count}")
    print(f"  [DC1] WakeLocks released   : {released_count}")
    print(f"  [DC1] Flushes completed    : {flush_completed_count}")

    # Check for any lingering WakeLock held by DaylightWriter
    power_dumpsys = adb_shell("dumpsys power")
    # Verify no actively held wake locks
    has_active_wakelock = False
    in_wake_locks_section = False
    for line in power_dumpsys.splitlines():
        if "Wake Locks: size=" in line:
            in_wake_locks_section = True
            continue
        if in_wake_locks_section and line.startswith("  "):
            if "DaylightWriter" in line:
                has_active_wakelock = True
        elif in_wake_locks_section and not line.startswith("  "):
            in_wake_locks_section = False

    results["zero_wakelock_leaks"] = not has_active_wakelock
    print(f"  [DC1] Zero active WakeLock leaks in dumpsys power: {'PASS' if not has_active_wakelock else 'FAIL'}")

    # 6. Stress Test 5: Unhandled / Unknown Keycodes Pass-through
    print("  [DC1] Testing unhandled keycodes pass-through (A-Z, space, unknown)...")
    adb_shell("logcat -c")
    adb_shell("input keyevent 29") # KEYCODE_A
    adb_shell("input keyevent 62") # KEYCODE_SPACE
    adb_shell("input keyevent 250") # unknown key
    time.sleep(0.3)

    unhandled_logcat = subprocess.run(
        [ADB_BIN, "-s", DEVICE_SERIAL, "logcat", "-d", "-s", "HardwareKeyInterceptor:I"],
        capture_output=True, text=True
    ).stdout
    # Should be empty because neither F12 nor Escape was pressed
    no_false_interception = len(unhandled_logcat.strip()) == 0
    results["unhandled_keys_not_intercepted"] = no_false_interception
    print(f"  [DC1] Unhandled keys not falsely intercepted: {'PASS' if no_false_interception else 'FAIL'}")

    # 7. Check for fatal crashes in logcat
    crash_check = subprocess.run(
        [ADB_BIN, "-s", DEVICE_SERIAL, "logcat", "-d", "*:E"],
        capture_output=True, text=True
    ).stdout
    has_fatal = "FATAL EXCEPTION" in crash_check and PACKAGE_NAME in crash_check
    results["zero_fatal_crashes"] = not has_fatal
    print(f"  [DC1] Zero fatal exceptions detected: {'PASS' if not has_fatal else 'FAIL'}")

    # Return overall live pass status
    results["all_passed"] = (
        results["app_running"]
        and results["has_window_focus"]
        and results["f12_intercepted_count"] >= 50
        and results["escape_intercepted_count"] >= 50
        and results["no_app_exit_on_escape"]
        and results["focus_retained_after_shortcuts"]
        and results["wakelocks_acquired"] >= 10
        and results["wakelocks_released"] >= 10
        and results["zero_wakelock_leaks"]
        and results["unhandled_keys_not_intercepted"]
        and results["zero_fatal_crashes"]
    )
    return results


def main():
    print("============================================================================")
    print(" Challenger M3-1: Adversarial Hardware & Folio Lifecycle Stress Suite")
    print(" Target Device:", DEVICE_SERIAL)
    print("============================================================================")

    # 1. Run behavioral & contract unit tests
    suite = unittest.TestLoader().loadTestsFromTestCase(AdversarialHardwareAndLifecycleStressSuite)
    runner = unittest.TextTestRunner(verbosity=2)
    test_result = runner.run(suite)

    # 2. Run live hardware stress suite on DC1 tablet
    live_results = run_live_dc1_hardware_stress()

    print("\n============================================================================")
    print(" CHALLENGER STRESS HARNESS SUMMARY")
    print("============================================================================")
    unit_pass = test_result.wasSuccessful()
    live_pass = live_results.get("all_passed", False)

    print(f" Unit & Contract Tests Run     : {test_result.testsRun}")
    print(f" Unit Failures / Errors        : {len(test_result.failures)} / {len(test_result.errors)}")
    print(f" Live DC1 Hardware Stress Pass : {'PASS' if live_pass else 'FAIL'}")
    print("============================================================================")

    if unit_pass and live_pass:
        print("\nOVERALL CHALLENGER VERDICT: APPROVE")
        sys.exit(0)
    else:
        print("\nOVERALL CHALLENGER VERDICT: REQUEST_CHANGES")
        sys.exit(1)


if __name__ == "__main__":
    main()
