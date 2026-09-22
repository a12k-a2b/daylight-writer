"""Web Application Test Runner for validating bundled Daylight Writer integrity."""

import subprocess
import re
from typing import Dict, Any

from tests.conftest import WEB_PROJECT_ROOT


class WebTestRunner:
    """Executes and inspects unit and E2E tests in the Daylight Writer web application bundle."""

    def __init__(self, web_root: str = WEB_PROJECT_ROOT):
        self.web_root = web_root

    def run_tests(self, timeout_s: float = 60.0) -> Dict[str, Any]:
        """Executes npm test and extracts structured pass/fail metrics."""
        try:
            res = subprocess.run(
                ["npm", "test", "--prefix", self.web_root],
                capture_output=True,
                text=True,
                timeout=timeout_s,
            )
            output = res.stdout + "\n" + res.stderr
            return self._parse_test_output(res.returncode, output)
        except Exception as e:
            return {
                "exit_code": -1,
                "passed": 0,
                "failed": 0,
                "total": 0,
                "success": False,
                "error": str(e),
            }

    def _parse_test_output(self, exit_code: int, output: str) -> Dict[str, Any]:
        # Node test runner output pattern:
        # ℹ tests 535
        # ℹ pass 535
        # ℹ fail 0
        total_match = re.search(r"ℹ tests\s+(\d+)", output)
        pass_match = re.search(r"ℹ pass\s+(\d+)", output)
        fail_match = re.search(r"ℹ fail\s+(\d+)", output)

        total = int(total_match.group(1)) if total_match else 0
        passed = int(pass_match.group(1)) if pass_match else 0
        failed = int(fail_match.group(1)) if fail_match else 0

        return {
            "exit_code": exit_code,
            "total": total,
            "passed": passed,
            "failed": failed,
            "success": (exit_code == 0 and failed == 0 and passed > 0),
            "output_snippet": output[-500:],
        }
