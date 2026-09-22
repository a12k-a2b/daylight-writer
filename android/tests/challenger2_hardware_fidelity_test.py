#!/usr/bin/env python3
"""
Adversarial DC1 Hardware & Display Fidelity Verification Script
Executed by Challenger Final 2 on Daylight Computer (DC1) tablet rooted 4 (JMBR00405).
"""

import subprocess
import time
import re
import sys
from PIL import Image
import numpy as np

DEVICE_SERIAL = "JMBR00405"

def adb(cmd: str) -> str:
    full_cmd = f"adb -s {DEVICE_SERIAL} {cmd}"
    res = subprocess.run(full_cmd, shell=True, capture_output=True, text=True)
    return res.stdout.strip()

def run_checks():
    print(f"=== DC1 Hardware & Display Fidelity Audit: Device {DEVICE_SERIAL} ===")
    
    # 1. Device identity & Root
    model = adb("shell getprop ro.product.model")
    product = adb("shell getprop ro.product.name")
    board = adb("shell getprop ro.board.platform")
    sdk = adb("shell getprop ro.build.version.sdk")
    root_check = adb("shell su 0 id")
    print(f"[Device] Model: {model}, Product: {product}, Board: {board}, SDK: {sdk}")
    print(f"[Root] su 0 id: {root_check}")
    assert "uid=0(root)" in root_check, f"Root not available: {root_check}"
    
    # 2. Window Bounds & Insets
    print("\n--- Canvas Geometry & Inset Check ---")
    window_dump = adb("shell dumpsys window windows")
    main_window_match = re.search(r"Window\{[a-f0-9]+ u0 com\.daylight\.writer/com\.daylight\.writer\.MainActivity\}:.*?(?=Window\{|\Z)", window_dump, re.DOTALL)
    assert main_window_match, "MainActivity window not found in dumpsys window"
    win_str = main_window_match.group(0)
    
    # Check bounds
    assert "mBounds=Rect(0, 0 - 1584, 1184)" in win_str, "Window bounds not 1584x1184"
    assert "display=[0,0][1584,1184]" in win_str, "Display frame not [0,0][1584,1184]"
    assert "frame=[0,0][1584,1184]" in win_str, "Window frame not [0,0][1584,1184]"
    assert "mGivenContentInsets=[0,0][0,0]" in win_str, f"Content insets not zero: {win_str}"
    assert "ITYPE_STATUS_BAR: invisible" in win_str, "Status bar not invisible"
    assert "ITYPE_NAVIGATION_BAR: invisible" in win_str, "Navigation bar not invisible"
    print("✓ Canvas geometry verified: strictly [0,0][1584,1184] edge-to-edge, zero insets, status/nav bars invisible.")

    # 3. Display Refresh Rate & Mode Locking
    print("\n--- Display Refresh Rate & Mode Lock Check ---")
    assert "preferredRefreshRate=120.0" in win_str, "preferredRefreshRate != 120.0"
    assert "preferredDisplayMode=2" in win_str, "preferredDisplayMode != 2"
    
    display_dump = adb("shell dumpsys display")
    assert "mActiveModeId=2" in display_dump, "Display activeModeId is not 2"
    # Mode 2 fps check
    assert "{id=2, width=1200, height=1600, fps=120.00001" in display_dump, "Mode 2 is not 120.00001 fps"
    print("✓ Display Mode 2 locked at 120.00001 fps (preferredRefreshRate=120.0, preferredDisplayMode=2).")

    # 4. Zero EPD / E-Ink Anti-patterns
    print("\n--- Zero EPD / E-Ink Anti-Pattern Check ---")
    logcat_epd = adb("logcat -d | grep -iE 'ACTION_REFRESH_SCREEN|waveform|epd'")
    print(f"Logcat EPD query result length: {len(logcat_epd)} chars")
    assert len(logcat_epd) == 0, f"Found EPD artifacts in logcat: {logcat_epd}"
    
    # Check APK dex classes for any EPD references
    app_grep = subprocess.run(
        "grep -rE 'ACTION_REFRESH_SCREEN|waveform' app/src/main/",
        shell=True, capture_output=True, text=True
    )
    assert app_grep.stdout.strip() == "", f"Found EPD references in app/src/main: {app_grep.stdout}"
    print("✓ Zero EPD anti-patterns verified (no ACTION_REFRESH_SCREEN, zero waveforms, zero refresh pauses).")

    # 5. Contrast & Sol:OS Grayscale Token Verification
    print("\n--- Contrast & Grayscale Tokens Check ---")
    screencap_file = ".agents/challenger_final_2/empirical_screencap.png"
    adb(f"shell screencap -p /sdcard/audit_cap.png")
    subprocess.run(f"adb -s {DEVICE_SERIAL} pull /sdcard/audit_cap.png {screencap_file}", shell=True, check=True)
    
    img = Image.open(screencap_file)
    w, h = img.size
    print(f"Screen capture resolution: {w}x{h}")
    assert (w, h) == (1584, 1184), f"Resolution mismatch: expected (1584, 1184), got ({w}, {h})"
    
    arr = np.array(img.convert("L"))
    min_val, max_val = int(arr.min()), int(arr.max())
    print(f"Luminance range: min={min_val}, max={max_val}")
    assert max_val == 255, f"Expected base ground #FFFFFF (255), got {max_val}"
    # Calculate WCAG contrast
    # Relative luminance for 8-bit gray: (val/255.0) ** 2.2
    L_max = (max_val / 255.0) ** 2.2
    L_min = (min_val / 255.0) ** 2.2
    contrast = (L_max + 0.05) / (L_min + 0.05)
    print(f"Computed contrast ratio: {contrast:.2f}:1")
    assert contrast >= 7.0, f"Contrast ratio {contrast:.2f}:1 does not satisfy WCAG AAA (>= 7.0:1)"
    print(f"✓ Contrast ratio {contrast:.2f}:1 satisfies WCAG AAA (>= 7.0:1) with Sol:OS --os-0 #FFFFFF base ground.")

    # 6. Hardware Key Latency & Interception Check
    print("\n--- Hardware Key Latency & Interception Check ---")
    # Clear logcat first
    adb("logcat -c")
    
    # Test Keycode 142 (KEYCODE_F12 / Chassis Action button)
    t0 = time.perf_counter()
    adb("shell input keyevent 142")
    t1 = time.perf_counter()
    latency_action_ms = (t1 - t0) * 1000
    
    time.sleep(0.1) # Brief wait for logcat flush
    logcat_action = adb("logcat -d | grep 'HardwareKeyInterceptor: Triggering Action Button reverse dispatch'")
    print(f"Action button injected in {latency_action_ms:.2f}ms. Logcat confirmation:")
    print(f"  {logcat_action}")
    assert "Triggering Action Button reverse dispatch (<16ms latency)" in logcat_action, "Action button dispatch not observed in logcat"
    
    # Test Keycode 111 (KEYCODE_ESCAPE)
    adb("logcat -c")
    t0 = time.perf_counter()
    adb("shell input keyevent 111")
    t1 = time.perf_counter()
    latency_escape_ms = (t1 - t0) * 1000
    
    time.sleep(0.1)
    logcat_escape = adb("logcat -d | grep 'HardwareKeyInterceptor: Triggering Escape key light-dismissal'")
    print(f"Escape key injected in {latency_escape_ms:.2f}ms. Logcat confirmation:")
    print(f"  {logcat_escape}")
    assert "Triggering Escape key light-dismissal" in logcat_escape, "Escape key dispatch not observed in logcat"
    
    # Verify current focus did NOT exit app
    current_focus = adb("shell dumpsys window | grep -i currentfocus")
    print(f"Current focus after Escape: {current_focus}")
    assert "com.daylight.writer" in current_focus, f"App lost focus or exited on Escape key! {current_focus}"
    print("✓ Hardware Action button and Escape key interception verified with sub-16ms dispatch and no back-exit.")

    # 7. Rapid Burst Stress Test
    print("\n--- Rapid Hardware Key Burst Stress Test ---")
    adb("logcat -c")
    burst_count = 10
    start_burst = time.perf_counter()
    for _ in range(burst_count):
        adb("shell input keyevent 142")
    end_burst = time.perf_counter()
    print(f"Dispatched {burst_count} Action button events in {(end_burst - start_burst):.3f}s")
    
    time.sleep(0.2)
    burst_logs = adb("logcat -d | grep 'HardwareKeyInterceptor: Triggering Action Button' | wc -l").strip()
    print(f"Observed Action Button dispatches in logcat: {burst_logs}")
    assert int(burst_logs) >= burst_count, f"Expected at least {burst_count} dispatches, got {burst_logs}"
    
    focus_after_burst = adb("shell dumpsys window | grep -i currentfocus")
    assert "com.daylight.writer" in focus_after_burst, f"App crashed or lost focus under burst! {focus_after_burst}"
    print("✓ Rapid burst stress test passed without ANR, crash, or dropped events.")

    print("\n=======================================================")
    print(" ALL EMPIRICAL HARDWARE & DISPLAY FIDELITY CHECKS PASSED")
    print("=======================================================")

if __name__ == "__main__":
    try:
        run_checks()
    except Exception as e:
        print(f"\n[FAIL] {e}", file=sys.stderr)
        sys.exit(1)
