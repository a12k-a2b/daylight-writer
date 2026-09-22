#!/usr/bin/env python3
"""
Empirical Challenger Verification Script:
Verify singleTask launchMode on DC1 tablet rooted 4 (JMBR00405).
Fires multiple sequential ACTION_VIEW intents (WITHOUT single-top flag) and verifies
that Activity and WebView count remains strictly 1 and memory remains flat.
"""

import os
import re
import subprocess
import time
import sys

DEVICE_SERIAL = os.environ.get("DAYLIGHT_DEVICE_SERIAL", "JMBR00405")
PACKAGE_NAME = "com.daylight.writer"
MAIN_ACTIVITY = f"{PACKAGE_NAME}/.MainActivity"


def adb_cmd(cmd_list):
    full_cmd = ["adb", "-s", DEVICE_SERIAL] + cmd_list
    res = subprocess.run(full_cmd, capture_output=True, text=True)
    return res.stdout.strip()


def get_meminfo():
    raw = adb_cmd(["shell", "dumpsys", "meminfo", PACKAGE_NAME])
    info = {
        "pss_total_kb": 0,
        "dalvik_heap_kb": 0,
        "native_heap_kb": 0,
        "activities": 0,
        "webviews": 0,
        "raw_counts": "",
    }
    pss_match = re.search(r"TOTAL PSS:\s+(\d+)", raw)
    if pss_match:
        info["pss_total_kb"] = int(pss_match.group(1))

    dalvik_match = re.search(r"Dalvik Heap\s+\d+\s+(\d+)", raw)
    if dalvik_match:
        info["dalvik_heap_kb"] = int(dalvik_match.group(1))

    native_match = re.search(r"Native Heap\s+\d+\s+(\d+)", raw)
    if native_match:
        info["native_heap_kb"] = int(native_match.group(1))

    act_match = re.search(r"Activities:\s+(\d+)", raw)
    if act_match:
        info["activities"] = int(act_match.group(1))

    wv_match = re.search(r"WebViews:\s+(\d+)", raw)
    if wv_match:
        info["webviews"] = int(wv_match.group(1))

    counts_lines = [line.strip() for line in raw.split("\n") if "Activities:" in line or "WebViews:" in line]
    info["raw_counts"] = " | ".join(counts_lines)

    return info


def main():
    print(f"=== Starting Empirical singleTask Stress Test on DC1 ({DEVICE_SERIAL}) ===")
    # 1. Force stop and clean state
    adb_cmd(["shell", "am", "force-stop", PACKAGE_NAME])
    time.sleep(1.0)

    # 2. Cold start
    print("Launching MainActivity...")
    adb_cmd(["shell", "am", "start", "-n", MAIN_ACTIVITY])
    time.sleep(2.5)

    base_mem = get_meminfo()
    print(f"[Baseline] PSS: {base_mem['pss_total_kb']:,} KB | Activities: {base_mem['activities']} | WebViews: {base_mem['webviews']}")
    assert base_mem["activities"] == 1, f"Expected 1 activity on start, got {base_mem['activities']}"
    assert base_mem["webviews"] == 1, f"Expected 1 webview on start, got {base_mem['webviews']}"

    # 3. Sequential ACTION_VIEW intents WITHOUT --activity-single-top
    iterations = 25
    print(f"Firing {iterations} sequential standard ACTION_VIEW intents without --activity-single-top...")

    measurements = []
    for i in range(1, iterations + 1):
        remote_path = f"/sdcard/challenger_doc_{i}.md"
        content = f"# Empirical Stress Document {i}\nTesting singleTask launchMode strictly preserving 1 Activity and 1 WebView under standard external intent dispatch."
        adb_cmd(["shell", "sh", "-c", f"echo '{content}' > {remote_path}"])

        # Note: am start WITHOUT --activity-single-top
        start_out = adb_cmd([
            "shell", "am", "start",
            "-a", "android.intent.action.VIEW",
            "-d", f"file://{remote_path}",
            "-t", "text/markdown",
            MAIN_ACTIVITY
        ])

        time.sleep(0.15)
        mem = get_meminfo()
        measurements.append(mem)

        # Immediate assertion
        if mem["activities"] != 1 or mem["webviews"] != 1:
            print(f"FAILED AT ITERATION {i}: Activities={mem['activities']}, WebViews={mem['webviews']}")
            sys.exit(1)

        if i % 5 == 0:
            print(f"  [Iter {i:02d}/{iterations}] PSS: {mem['pss_total_kb']:,} KB | Activities: {mem['activities']} | WebViews: {mem['webviews']}")

        adb_cmd(["shell", "rm", "-f", remote_path])

    # 4. Final verification after settling
    time.sleep(1.0)
    final_mem = get_meminfo()
    pss_delta_kb = final_mem["pss_total_kb"] - base_mem["pss_total_kb"]
    pss_delta_mb = pss_delta_kb / 1024.0

    print("============================================================================")
    print(" EMPIRICAL SINGLETASK & MEMORY AUDIT RESULTS:")
    print("============================================================================")
    print(f" Target Device:           DC1 rooted 4 ({DEVICE_SERIAL})")
    print(f" Intent Count:            {iterations} standard ACTION_VIEW intents")
    print(f" Initial Activities:      {base_mem['activities']}")
    print(f" Final Activities:        {final_mem['activities']}")
    print(f" Initial WebViews:        {base_mem['webviews']}")
    print(f" Final WebViews:          {final_mem['webviews']}")
    print(f" Initial PSS:             {base_mem['pss_total_kb']:,} KB ({base_mem['pss_total_kb']/1024:.2f} MB)")
    print(f" Final PSS:               {final_mem['pss_total_kb']:,} KB ({final_mem['pss_total_kb']/1024:.2f} MB)")
    print(f" Total PSS Growth:        {pss_delta_kb:+,} KB ({pss_delta_mb:+.2f} MB)")
    print(f" Grep raw line:           {final_mem['raw_counts']}")
    print("============================================================================")

    # Verification checks
    assert final_mem["activities"] == 1, f"Expected final Activities == 1, got {final_mem['activities']}"
    assert final_mem["webviews"] == 1, f"Expected final WebViews == 1, got {final_mem['webviews']}"
    # PSS growth over 25 document loads must be flat (under 25MB)
    assert pss_delta_mb < 25.0, f"PSS growth too high: {pss_delta_mb:.2f} MB"

    print("VERDICT: PASS (singleTask strictly verified on DC1 tablet rooted 4)")


if __name__ == "__main__":
    main()
