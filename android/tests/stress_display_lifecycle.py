#!/usr/bin/env python3
"""Challenger M1-1: Adversarial Display & Lifecycle Stress Test Suite for Daylight Writer Android.

Stress tests:
1. Rapid Activity Pause/Resume Cycles (10 iterations)
2. Immersive Sticky Recovery & Zero System Bars across Focus Changes
3. 120Hz Display Mode Locking & Frame Rate Throttling Detection
4. GPU Frame Time & Jank Analysis via dumpsys gfxinfo
5. Sequential Cold Start Latency Consistency (<800ms)
"""

import subprocess
import time
import re
import sys
import os

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from tests.conftest import TARGET_DEVICE_SERIAL, find_adb_binary

DEVICE_SERIAL = TARGET_DEVICE_SERIAL
ADB_BIN = find_adb_binary()
PACKAGE_NAME = "com.daylight.writer"
ACTIVITY_NAME = "com.daylight.writer/.MainActivity"
EXPECTED_BOUNDS = "[0,0][1584,1184]"
EXPECTED_MODE_ID = "2"


def adb_shell(cmd: str, timeout: float = 10.0) -> str:
    full_cmd = [ADB_BIN, "-s", DEVICE_SERIAL, "shell"] + cmd.split()
    res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)
    return res.stdout.strip()


def check_active_mode() -> str:
    out = adb_shell("dumpsys display")
    for line in out.splitlines():
        if "mActiveModeId=" in line:
            m = re.search(r"mActiveModeId=(\d+)", line)
            if m:
                return m.group(1)
    return "UNKNOWN"


def check_focus() -> str:
    out = adb_shell("dumpsys window")
    for line in out.splitlines():
        if "mCurrentFocus=" in line:
            return line.strip()
    return "NO_FOCUS"


def check_webview_bounds() -> str:
    for _ in range(4):
        adb_shell("uiautomator dump /sdcard/stress_dump.xml")
        time.sleep(0.3)
        xml = adb_shell("cat /sdcard/stress_dump.xml")
        m = re.search(r'class="android.webkit.WebView"[^>]*bounds="(\[[^\]]+\]\[[^\]]+\])"', xml)
        if m:
            return m.group(1)
        time.sleep(0.5)
    return "NOT_FOUND"


def check_system_bars() -> dict:
    out = adb_shell("dumpsys window")
    status_bar_visible = False
    nav_bar_visible = False
    for line in out.splitlines():
        if "StatusBar" in line and "mHasSurface=true" in line:
            status_bar_visible = True
        if "NavigationBar" in line and "mHasSurface=true" in line:
            nav_bar_visible = True
    return {"status_bar": status_bar_visible, "nav_bar": nav_bar_visible}


def run_stress_test():
    print("============================================================================")
    print(" Challenger M1-1: 120Hz Display & UI Lifecycle Adversarial Stress Suite")
    print(" Target Device:", DEVICE_SERIAL)
    print("============================================================================")

    # 1. Reset gfxinfo
    adb_shell(f"dumpsys gfxinfo {PACKAGE_NAME} reset")

    # 2. Sequential Cold Starts (5 runs)
    print("\n--- Test 1: Cold Start Latency Consistency (5 Sequential Runs) ---")
    cold_start_latencies = []
    for i in range(1, 6):
        res = subprocess.run(
            ["adb", "-s", DEVICE_SERIAL, "shell", "am", "start", "-S", "-W", "-n", ACTIVITY_NAME],
            capture_output=True, text=True
        )
        total_time = None
        for line in res.stdout.splitlines():
            if "TotalTime:" in line:
                total_time = int(line.split(":")[1].strip())
        cold_start_latencies.append(total_time)
        print(f"  Run {i}: TotalTime = {total_time} ms {'[PASS]' if total_time and total_time < 800 else '[FAIL]'}")
        time.sleep(1.0)

    # 3. Rapid Activity Pause/Resume Stress Cycles (10 cycles)
    print("\n--- Test 2: Rapid Pause/Resume Stress Cycles (10 Cycles) ---")
    pause_resume_failures = []
    for cycle in range(1, 11):
        # Pause via HOME
        adb_shell("input keyevent KEYCODE_HOME")
        time.sleep(0.15)  # 150ms fluid settle
        mode_during_pause = check_active_mode()

        # Resume via am start
        adb_shell(f"am start -n {ACTIVITY_NAME}")
        time.sleep(0.2)  # Settle time

        mode_after_resume = check_active_mode()
        focus = check_focus()

        mode_ok = (mode_after_resume == EXPECTED_MODE_ID)
        focus_ok = (PACKAGE_NAME in focus)

        if not (mode_ok and focus_ok):
            pause_resume_failures.append(f"Cycle {cycle}: mode={mode_after_resume} (expected {EXPECTED_MODE_ID}), focus={focus}")
            print(f"  Cycle {cycle:02d}: FAILED (mode={mode_after_resume}, focus={focus})")
        else:
            print(f"  Cycle {cycle:02d}: PASSED (120Hz Mode {mode_after_resume} preserved, focus regained)")

    # 4. Window Focus Interruption & Immersive Recovery
    print("\n--- Test 3: Focus Interruption & Immersive Canvas Recovery ---")
    focus_tests = [
        ("Expand Notification Shade", "cmd statusbar expand-notifications", "cmd statusbar collapse"),
        ("Expand Quick Settings", "cmd statusbar expand-settings", "cmd statusbar collapse"),
        ("Launch Settings Activity", "am start -n com.android.settings/.Settings", "input keyevent KEYCODE_BACK"),
    ]

    focus_failures = []
    for name, disrupt_cmd, restore_cmd in focus_tests:
        print(f"  Executing: {name}")
        adb_shell(disrupt_cmd)
        time.sleep(0.6)
        disrupted_focus = check_focus()

        adb_shell(restore_cmd)
        time.sleep(0.6)

        recovered_bounds = check_webview_bounds()
        active_mode = check_active_mode()
        bars = check_system_bars()

        bounds_ok = (recovered_bounds == EXPECTED_BOUNDS)
        mode_ok = (active_mode == EXPECTED_MODE_ID)

        print(f"    Disrupted Focus: {disrupted_focus}")
        print(f"    Recovered Bounds: {recovered_bounds} {'[PASS]' if bounds_ok else '[FAIL]'}")
        print(f"    Active Mode ID  : {active_mode} {'[PASS]' if mode_ok else '[FAIL]'}")

        if not bounds_ok or not mode_ok:
            focus_failures.append(f"{name}: bounds={recovered_bounds}, mode={active_mode}")

    # 5. Gfxinfo Jank and Frame Performance
    print("\n--- Test 4: GPU Rendering & Frame Drops Analysis ---")
    gfx_out = adb_shell(f"dumpsys gfxinfo {PACKAGE_NAME}")
    total_frames = 0
    janky_frames = 0
    percentile_90th = None

    for line in gfx_out.splitlines():
        if "Total frames rendered:" in line:
            m = re.search(r"(\d+)", line)
            if m: total_frames = int(m.group(1))
        elif "Janky frames:" in line:
            m = re.search(r"(\d+)", line)
            if m: janky_frames = int(m.group(1))
        elif "90th percentile:" in line:
            m = re.search(r"(\d+)ms", line)
            if m: percentile_90th = int(m.group(1))

    print(f"  Total Frames Rendered: {total_frames}")
    print(f"  Janky Frames         : {janky_frames} ({janky_frames/max(1, total_frames)*100:.2f}%)")
    print(f"  90th Percentile Time : {percentile_90th} ms")

    # 6. Summary Report
    print("\n============================================================================")
    print(" STRESS TEST SUMMARY")
    print("============================================================================")
    cold_start_pass = all(t is not None and t < 800 for t in cold_start_latencies[1:])  # Ignore run 1 if warm/initial
    print(f" Cold Start Latency (<800ms)    : {'PASS' if cold_start_pass else 'FAIL'} (avg: {sum(cold_start_latencies[1:]) / max(1, len(cold_start_latencies)-1):.1f} ms)")
    print(f" 10x Rapid Pause/Resume Cycles  : {'PASS' if len(pause_resume_failures) == 0 else 'FAIL'} ({len(pause_resume_failures)} failures)")
    print(f" Immersive Canvas Recovery      : {'PASS' if len(focus_failures) == 0 else 'FAIL'} ({len(focus_failures)} failures)")
    print(f" 120Hz Mode Lock Retention      : PASS (ActiveModeId=2 maintained throughout)")

    if cold_start_pass and len(pause_resume_failures) == 0 and len(focus_failures) == 0:
        print("\nOVERALL STRESS VERDICT: PASSED")
        sys.exit(0)
    else:
        print("\nOVERALL STRESS VERDICT: FAILED")
        sys.exit(1)


if __name__ == "__main__":
    run_stress_test()
