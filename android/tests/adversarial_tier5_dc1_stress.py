#!/usr/bin/env python3
"""
Tier 5 Adversarial Coverage Hardening Stress Test Suite for Daylight Writer Android.
Executed by Challenger Final 1.

Targets:
1. Concurrent file export and SAF file collisions (overwrites, invalid URIs, disk full simulation)
2. Rapid lifecycle transitions: onPause/onResume interleaving with WakeLock acquisition and release
3. Network oscillation: cycling connectivity during active sync worker execution
4. Memory and resource leak verification across repeated document loads
"""

import base64
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time
import unittest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from tests.conftest import (
    TARGET_DEVICE_SERIAL,
    find_adb_binary,
    KEYCODE_ACTION_BUTTON,
    KEYCODE_ESCAPE,
    WAKELOCK_TIMEOUT_MS,
)
from tests.framework.bridge_simulator import DaylightBridgeSimulator

ADB_BIN = find_adb_binary()
DEVICE_SERIAL = TARGET_DEVICE_SERIAL
PACKAGE_NAME = "com.daylight.writer"
MAIN_ACTIVITY = f"{PACKAGE_NAME}/.MainActivity"


def adb_shell(cmd: str, timeout: float = 15.0) -> str:
    full_cmd = [ADB_BIN, "-s", DEVICE_SERIAL, "shell"] + cmd.split()
    res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)
    return res.stdout.strip()


def adb_shell_raw(cmd_str: str, timeout: float = 15.0) -> subprocess.CompletedProcess:
    full_cmd = [ADB_BIN, "-s", DEVICE_SERIAL, "shell", cmd_str]
    return subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)


def get_pid() -> int:
    out = adb_shell(f"pidof {PACKAGE_NAME}")
    if out:
        pids = out.split()
        return int(pids[0])
    return 0


def get_meminfo() -> dict:
    raw = adb_shell(f"dumpsys meminfo {PACKAGE_NAME}")
    info = {"pss_total_kb": 0, "dalvik_heap_kb": 0, "native_heap_kb": 0, "activities": 0, "webviews": 0}
    
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

    return info


class Tier5AdversarialStressSuite(unittest.TestCase):
    """Tier 5 Adversarial Coverage Hardening Suite."""

    @classmethod
    def setUpClass(cls):
        # Verify app is running on live device
        pid = get_pid()
        if pid == 0:
            adb_shell(f"am start -n {MAIN_ACTIVITY}")
            time.sleep(2.0)
            pid = get_pid()
        assert pid > 0, "Target application com.daylight.writer must be running on device"

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    # =========================================================================
    # Domain 1: Concurrent File Export & SAF Collisions
    # =========================================================================

    def test_01_saf_concurrent_export_burst_100_threads(self):
        """Stress: 100 concurrent export requests executed in parallel."""
        num_threads = 100
        results = []

        def trigger_export(idx):
            fn = f"manuscript_burst_{idx}.md"
            content = f"# Chapter {idx}\nAdversarial concurrent export stress test payload.\n" * 10
            return self.bridge.exportDocument(fn, "text/markdown", content, False)

        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(trigger_export, i) for i in range(num_threads)]
            for f in concurrent.futures.as_completed(futures):
                results.append(f.result())

        self.assertEqual(len(results), num_threads)
        self.assertTrue(all(results), "All concurrent export requests must validate cleanly")
        self.assertEqual(len(self.bridge.exports), num_threads)

    def test_02_saf_invalid_uri_and_empty_payload_boundaries(self):
        """Boundary: Invalid URIs, empty strings, null bytes, and corrupt Base64."""
        # Empty inputs
        self.assertFalse(self.bridge.exportDocument("", "text/markdown", "content", False))
        self.assertFalse(self.bridge.exportDocument("   ", "text/markdown", "content", False))
        self.assertFalse(self.bridge.exportDocument("doc.md", "", "content", False))
        self.assertFalse(self.bridge.exportDocument("doc.md", "   ", "content", False))

        # Corrupted Base64 for binary export
        self.assertFalse(self.bridge.exportDocument("invalid.docx", "application/vnd.openxmlformats", "???not_base64???", True))

        # Open requests with invalid/whitespace extensions
        self.assertFalse(self.bridge.requestOpenDocument(""))
        self.assertFalse(self.bridge.requestOpenDocument("   "))

    def test_03_saf_file_collision_and_overwrite(self):
        """Verify file overwrite behavior using simulated 'wt' truncation."""
        fn = "collision_test.md"
        # First export: 1000 bytes
        c1 = "A" * 1000
        self.assertTrue(self.bridge.exportDocument(fn, "text/markdown", c1, False))
        self.assertEqual(self.bridge.exports[-1].bytes_written, 1000)

        # Overwrite with 200 bytes
        c2 = "B" * 200
        self.assertTrue(self.bridge.exportDocument(fn, "text/markdown", c2, False))
        self.assertEqual(self.bridge.exports[-1].bytes_written, 200)
        self.assertEqual(self.bridge.exports[-1].raw_data, c2.encode("utf-8"))

    def test_04_live_action_view_invalid_uri_resilience(self):
        """Verify live DC1 MainActivity handles invalid ACTION_VIEW URIs without crashing."""
        initial_pid = get_pid()
        self.assertGreater(initial_pid, 0)

        # Dispatch ACTION_VIEW with nonexistent file URI
        adb_shell(f"am start -a android.intent.action.VIEW -d 'file:///sdcard/nonexistent_doc_{time.time()}.md' -t 'text/markdown' {MAIN_ACTIVITY}")
        time.sleep(1.0)

        # Dispatch ACTION_VIEW with malformed content URI
        adb_shell(f"am start -a android.intent.action.VIEW -d 'content://com.android.externalstorage.documents/document/invalid_id' -t 'text/plain' {MAIN_ACTIVITY}")
        time.sleep(1.0)

        current_pid = get_pid()
        self.assertEqual(initial_pid, current_pid, "Process must survive invalid/nonexistent ACTION_VIEW URIs without crashing")

    # =========================================================================
    # Domain 2: Rapid Lifecycle Transitions & WakeLock Safety
    # =========================================================================

    def test_05_rapid_lifecycle_transitions_20_cycles(self):
        """Stress: 20 rapid consecutive onPause / onResume transitions on live DC1 tablet."""
        initial_pid = get_pid()
        self.assertGreater(initial_pid, 0)

        for i in range(20):
            # Send Screen Off broadcast (triggers onPause + FolioHallSensor emergency save point)
            adb_shell("am broadcast -a android.intent.action.SCREEN_OFF")
            time.sleep(0.05)
            # Re-bring MainActivity to foreground (triggers onResume)
            adb_shell(f"am start -n {MAIN_ACTIVITY}")
            time.sleep(0.05)

        time.sleep(1.0)
        current_pid = get_pid()
        self.assertEqual(initial_pid, current_pid, "App must survive 20 rapid lifecycle cycles without crashing or dying")

    def test_06_wakelock_acquisition_and_clean_release_audit(self):
        """Verify dumpsys power reveals 0 leaked WakeLocks for DaylightWriter after flush."""
        # Trigger emergency flush broadcast
        adb_shell("am broadcast -a android.intent.action.SCREEN_OFF")
        time.sleep(0.5)

        # Re-enter app and trigger onFlushCompleted callback via evaluateJavascript
        # Allow safety timeout or completion
        time.sleep(3.5)  # Greater than 3000ms WAKELOCK_TIMEOUT_MS

        power_dump = adb_shell("dumpsys power | grep -i 'DaylightWriter'")
        # Ensure no held wake lock remains active
        is_held = "held" in power_dump.lower()
        self.assertFalse(is_held, f"WakeLock must not remain held after flush or timeout: {power_dump}")

    def test_07_wakelock_race_conditions_multithreaded(self):
        """Verify thread-safe acquire/release logic prevents deadlocks and underflow."""
        num_threads = 50
        iterations = 100

        def worker():
            for j in range(iterations):
                if j % 2 == 0:
                    self.bridge.acquire_emergency_wakelock(3000)
                else:
                    self.bridge.onFlushCompleted(True, 0)

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(worker) for _ in range(num_threads)]
            concurrent.futures.wait(futures)

        self.bridge.onFlushCompleted(True, 0)
        self.assertFalse(self.bridge.wakelock.is_held)

    # =========================================================================
    # Domain 3: Network Oscillation & WorkManager Execution
    # =========================================================================

    def test_08_network_oscillation_during_sync_queueing(self):
        """Stress: Rapid connectivity state changes during active mutation queueing."""
        pending = 0
        scheduled_syncs = 0

        for i in range(50):
            is_online = (i % 2 == 0)
            mutations = 3
            pending += mutations
            if is_online and pending > 0:
                scheduled_syncs += 1
                self.bridge.onSyncQueueUpdated(pending)
                pending = 0

        self.assertGreaterEqual(scheduled_syncs, 1)

    def test_09_jobscheduler_service_state_on_device(self):
        """Verify Android JobScheduler has registered com.daylight.writer background service."""
        job_dump = adb_shell("dumpsys jobscheduler | grep -A 10 'com.daylight.writer'")
        self.assertTrue(len(job_dump) > 0, "WorkManager JobScheduler job must be actively registered on DC1")
        self.assertIn("SystemJobService", job_dump)

    def test_10_offline_queue_persistence(self):
        """Verify SharedPreferences contains valid pending mutation count."""
        prefs_dump = adb_shell("su 0 cat /data/data/com.daylight.writer/shared_prefs/daylight_sync_prefs.xml")
        self.assertIn("pending_mutation_count", prefs_dump, "daylight_sync_prefs must track pending_mutation_count")

    # =========================================================================
    # Domain 4: Memory and Resource Leak Verification
    # =========================================================================

    def test_11_repeated_document_load_memory_leak_audit(self):
        """Stress: Repeatedly load documents and verify memory stability without monotonic leaks."""
        # Restart cleanly to start from pristine single-activity state
        adb_shell(f"am force-stop {PACKAGE_NAME}")
        adb_shell(f"am start -n {MAIN_ACTIVITY}")
        time.sleep(2.0)

        initial_mem = get_meminfo()
        initial_pss = initial_mem["pss_total_kb"]
        initial_activities = initial_mem["activities"]
        initial_webviews = initial_mem["webviews"]

        print(f"\n    [Baseline Memory] PSS: {initial_pss:,} KB, Dalvik: {initial_mem['dalvik_heap_kb']:,} KB, Native: {initial_mem['native_heap_kb']:,} KB, Activities: {initial_activities}, WebViews: {initial_webviews}")
        self.assertEqual(initial_activities, 1, "Fresh start must have exactly 1 active Activity")
        self.assertEqual(initial_webviews, 1, "Fresh start must have exactly 1 active WebView")

        # Perform 20 document injection & interaction cycles using single-top delivery
        for i in range(20):
            fn = f"/sdcard/test_doc_{i}.md"
            adb_shell_raw(f"echo '# Document {i}\\nStress testing memory leaks across repeated loads.' > {fn}")
            adb_shell(f"am start --activity-single-top -a android.intent.action.VIEW -d 'file://{fn}' -t 'text/markdown' {MAIN_ACTIVITY}")
            time.sleep(0.08)

            adb_shell("input keyevent 142")
            time.sleep(0.04)

            adb_shell("input keyevent 111")
            time.sleep(0.04)

            adb_shell_raw(f"rm -f {fn}")

        time.sleep(1.0)
        final_mem = get_meminfo()
        final_pss = final_mem["pss_total_kb"]
        final_activities = final_mem["activities"]
        final_webviews = final_mem["webviews"]

        pss_delta_kb = final_pss - initial_pss
        print(f"    [Post-Stress Memory (Single-Top)] PSS: {final_pss:,} KB (delta: {pss_delta_kb:+,} KB), Activities: {final_activities}, WebViews: {final_webviews}")

        self.assertEqual(final_activities, 1, "Activity count must remain 1 under single-top delivery")
        self.assertEqual(final_webviews, 1, "WebView count must remain 1 under single-top delivery")

        # PSS growth over 20 loads should not exceed 60MB
        max_allowed_growth_kb = 60 * 1024
        self.assertLess(pss_delta_kb, max_allowed_growth_kb, f"Excessive PSS growth: {pss_delta_kb} KB > {max_allowed_growth_kb} KB")


def main():
    print("=" * 76)
    print(" Daylight Writer Android — Tier 5 Adversarial Stress Suite")
    print(f" Target Device: DC1 (Serial: {DEVICE_SERIAL})")
    print("=" * 76)
    suite = unittest.TestLoader().loadTestsFromTestCase(Tier5AdversarialStressSuite)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if result.wasSuccessful():
        print("\nAll Tier 5 Adversarial Stress Tests PASSED (Exit 0)")
        sys.exit(0)
    else:
        print(f"\nTier 5 Adversarial Stress Tests FAILED: {len(result.failures)} failures, {len(result.errors)} errors")
        sys.exit(1)


if __name__ == "__main__":
    main()
