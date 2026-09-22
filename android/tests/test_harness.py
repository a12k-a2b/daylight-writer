#!/usr/bin/env python3
"""Daylight Writer Android E2E Standalone Test Harness & Runner."""

import os
import sys
import time
import unittest
import argparse
from typing import List, Dict, Tuple

# ANSI Color Codes
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


class CustomTestResult(unittest.TestResult):
    def __init__(self, stream=sys.stdout):
        super().__init__()
        self.stream = stream
        self.successes: List[unittest.TestCase] = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.successes.append(test)

    def addFailure(self, test, err):
        super().addFailure(test, err)

    def addError(self, test, err):
        super().addError(test, err)


def run_tier_suite(test_loader: unittest.TestLoader, test_dir: str, pattern: str = "test_*.py", top_level_dir: str = None) -> Tuple[int, int, int, List[str]]:
    """Runs tests matching pattern in test_dir, returns (passes, failures, errors, failure_details)."""
    suite = test_loader.discover(test_dir, pattern=pattern, top_level_dir=top_level_dir)
    result = CustomTestResult()
    suite.run(result)

    passes = len(result.successes)
    fails = len(result.failures)
    errs = len(result.errors)

    details = []
    for test, trace in result.failures:
        details.append(f"{RED}[FAIL]{RESET} {test.id()}:\n{trace}")
    for test, trace in result.errors:
        details.append(f"{RED}[ERROR]{RESET} {test.id()}:\n{trace}")

    return passes, fails, errs, details


def main():
    parser = argparse.ArgumentParser(description="Daylight Writer Android E2E Test Suite Runner")
    parser.add_argument("--tier", type=int, choices=[1, 2, 3, 4], help="Run specific test tier only (1-4)")
    parser.add_argument("--feature", type=str, help="Run tests for specific feature (e.g. F01, F07, F10)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose test execution output")
    args = parser.parse_args()

    tests_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(tests_dir)

    # Ensure project root and tests dir are on PYTHONPATH
    if project_root not in sys.path:
        sys.path.insert(0, project_root)
    if tests_dir not in sys.path:
        sys.path.insert(0, tests_dir)

    from tests.conftest import TARGET_DEVICE_SERIAL, get_device_alias
    device_alias = get_device_alias(TARGET_DEVICE_SERIAL)

    print(f"{BOLD}{'=' * 76}{RESET}")
    print(f"{BOLD}{CYAN} Daylight Writer Android — 4-Tier E2E Test Suite Runner{RESET}")
    print(f"{BOLD}{'=' * 76}{RESET}")
    print(f" [INFO] Project Root   : {project_root}")
    print(f" [INFO] Target Device  : DC1 {device_alias} (serial {TARGET_DEVICE_SERIAL})")
    print(f" [INFO] Display Profile: 120Hz LivePaper (Reflective LCD, 8-bit Grayscale)")
    print(f" [INFO] Python Runtime : Python {sys.version.split()[0]} on {sys.platform}")
    print(f"{'—' * 76}")

    loader = unittest.TestLoader()
    start_time = time.time()

    total_pass = 0
    total_fail = 0
    total_err = 0
    all_details = []

    tiers_to_run = [args.tier] if args.tier else [1, 2, 3, 4]

    tier_dirs = {
        1: (os.path.join(tests_dir, "tier1_features"), "Tier 1: Feature Coverage (F-01 to F-11)"),
        2: (os.path.join(tests_dir, "tier2_boundaries"), "Tier 2: Boundary & Corner Cases (F-01 to F-11)"),
        3: (os.path.join(tests_dir, "tier3_interactions"), "Tier 3: Cross-Feature Pairwise Interactions"),
        4: (os.path.join(tests_dir, "tier4_workloads"), "Tier 4: Real-World Workload Scenarios"),
    }

    feature_pattern_map = {
        "F1": "*f01*", "F01": "*f01*",
        "F2": "*f02*", "F02": "*f02*",
        "F3": "*f03*", "F03": "*f03*",
        "F4": "*f04*", "F04": "*f04*",
        "F5": "*f05*", "F05": "*f05*",
        "F6": "*f06*", "F06": "*f06*",
        "F7": "*f07*", "F07": "*f07*",
        "F8": "*f08*", "F08": "*f08*",
        "F9": "*f09*", "F09": "*f09*",
        "F10": "*f10*", "F-10": "*f10*",
        "F11": "*f11*", "F-11": "*f11*",
    }

    for tier_num in tiers_to_run:
        dir_path, tier_name = tier_dirs[tier_num]
        pattern = "test_*.py"

        if args.feature:
            feat_key = args.feature.upper()
            if feat_key in feature_pattern_map:
                if tier_num == 1:
                    pattern = f"test_{feature_pattern_map[feat_key].strip('*')}_*.py"
                elif tier_num == 2:
                    pattern = f"test_b{feat_key.lstrip('F').lstrip('-').zfill(2)}*.py"
                else:
                    pattern = "test_*.py"

        p, f, e, details = run_tier_suite(loader, dir_path, pattern, top_level_dir=project_root)
        total_pass += p
        total_fail += f
        total_err += e
        all_details.extend(details)

        tier_total = p + f + e
        status_str = f"{GREEN}[{p}/{tier_total} PASS]{RESET}" if f == 0 and e == 0 else f"{RED}[{f + e}/{tier_total} FAIL]{RESET}"
        dots = "." * max(2, 54 - len(tier_name))
        print(f" {tier_name} {dots} {status_str}")

    elapsed = time.time() - start_time
    print(f"{'—' * 76}")

    if all_details:
        print(f"\n{BOLD}{RED}Failure Diagnostics:{RESET}\n")
        for d in all_details:
            print(d)
        print(f"{'—' * 76}")

    print(f" {BOLD}Summary:{RESET} {GREEN}{total_pass} Passed{RESET}, {RED if total_fail > 0 else GREEN}{total_fail} Failed{RESET}, {RED if total_err > 0 else GREEN}{total_err} Errors{RESET} in {elapsed:.3f}s")

    if total_fail == 0 and total_err == 0 and total_pass > 0:
        print(f" {BOLD}Status :{RESET} {GREEN}{BOLD}PASSED (Exit 0){RESET}")
        print(f"{BOLD}{'=' * 76}{RESET}")
        sys.exit(0)
    else:
        print(f" {BOLD}Status :{RESET} {RED}{BOLD}FAILED (Exit 1){RESET}")
        print(f"{BOLD}{'=' * 76}{RESET}")
        sys.exit(1)


if __name__ == "__main__":
    main()
