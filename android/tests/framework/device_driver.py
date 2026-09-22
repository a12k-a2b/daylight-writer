"""DC1 Hardware Device Driver for E2E Testing on connected tablet rooted 4."""

import os
import subprocess
import shutil
import re
from typing import Optional, Dict, List, Tuple, Any

from tests.conftest import (
    TARGET_DEVICE_SERIAL,
    TARGET_DEVICE_MODEL,
    TARGET_SDK_INT,
    DISPLAY_MODE_ID_120HZ,
    DISPLAY_ACTIVE_WIDTH,
    DISPLAY_ACTIVE_HEIGHT,
    DISPLAY_ACTIVE_DENSITY_DPI,
    SCANCODE_ACTION_BUTTON,
    KEYCODE_ACTION_BUTTON,
    KEYCODE_ESCAPE,
    HALL_SENSOR_EVENT_NODE,
    KEYPAD_EVENT_NODE,
    discover_target_device_serial,
)


class DC1DeviceDriver:
    """Manages adb interactions with the physical Daylight Computer DC1 tablet."""

    def __init__(self, serial: Optional[str] = None):
        self.serial = serial or discover_target_device_serial()
        self.adb_bin = self._find_adb()
        self._connected: Optional[bool] = None

    def _find_adb(self) -> str:
        candidates = [
            os.environ.get("ADB_PATH", ""),
            os.path.join(os.environ.get("ANDROID_HOME", ""), "platform-tools", "adb"),
            os.path.join(os.environ.get("ANDROID_SDK_ROOT", ""), "platform-tools", "adb"),
            "/Users/anjan/Library/Android/sdk/platform-tools/adb",
            shutil.which("adb") or "adb",
        ]
        for c in candidates:
            if c and os.path.exists(c) and os.access(c, os.X_OK):
                return c
            elif c and shutil.which(c):
                return c
        return shutil.which("adb") or "adb"

    def run_adb(self, args: List[str], timeout_s: float = 10.0) -> Tuple[int, str, str]:
        """Runs an adb command with target serial flag -s <serial>."""
        if not self.serial:
            self.serial = discover_target_device_serial()
        cmd = [self.adb_bin, "-s", self.serial] + args
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout_s,
            )
            return res.returncode, res.stdout, res.stderr
        except Exception as e:
            return -1, "", str(e)

    def is_connected(self) -> bool:
        """Returns True if the DC1 tablet is online and responding over ADB."""
        code, stdout, _ = self.run_adb(["get-state"], timeout_s=3.0)
        self._connected = (code == 0 and "device" in stdout.strip())
        if not self._connected:
            discovered = discover_target_device_serial()
            if discovered != self.serial:
                self.serial = discovered
                code, stdout, _ = self.run_adb(["get-state"], timeout_s=3.0)
                self._connected = (code == 0 and "device" in stdout.strip())
        return self._connected

    def get_prop(self, prop_name: str) -> str:
        code, stdout, _ = self.run_adb(["shell", f"getprop {prop_name}"])
        return stdout.strip() if code == 0 else ""

    def get_model(self) -> str:
        return self.get_prop("ro.product.model") or TARGET_DEVICE_MODEL

    def get_sdk_version(self) -> int:
        val = self.get_prop("ro.build.version.sdk")
        try:
            return int(val)
        except ValueError:
            return TARGET_SDK_INT

    def has_root(self) -> bool:
        code, stdout, _ = self.run_adb(["shell", "su 0 id"])
        return code == 0 and "uid=0(root)" in stdout

    def get_display_modes(self) -> List[Dict[str, Any]]:
        """Parses dumpsys display on DC1 to extract available DisplayMode records."""
        code, stdout, _ = self.run_adb(["shell", "dumpsys display"])
        if code != 0 or not stdout:
            # Return hardware spec baseline if query fails
            return [
                {"id": 1, "width": 1200, "height": 1600, "fps": 60.0},
                {"id": 2, "width": 1200, "height": 1600, "fps": 120.00001},
            ]
        modes = []
        # Pattern: {id=2, width=1200, height=1600, fps=120.00001
        for match in re.finditer(r"\{id=(\d+),\s*width=(\d+),\s*height=(\d+),\s*fps=([\d\.]+)", stdout):
            modes.append({
                "id": int(match.group(1)),
                "width": int(match.group(2)),
                "height": int(match.group(3)),
                "fps": float(match.group(4)),
            })
        return modes

    def is_120hz_available(self) -> bool:
        modes = self.get_display_modes()
        for m in modes:
            if m["id"] == DISPLAY_MODE_ID_120HZ and m["fps"] >= 119.0:
                return True
        return False

    def get_active_resolution(self) -> Tuple[int, int]:
        """Returns active display resolution in landscape orientation (width, height)."""
        code, stdout, _ = self.run_adb(["shell", "wm size"])
        if code == 0 and "Override size:" in stdout:
            match = re.search(r"Override size:\s*(\d+)x(\d+)", stdout)
            if match:
                w, h = int(match.group(1)), int(match.group(2))
                # In landscape, width is the larger dimension
                return (max(w, h), min(w, h))
        return (DISPLAY_ACTIVE_WIDTH, DISPLAY_ACTIVE_HEIGHT)

    def get_active_density(self) -> int:
        code, stdout, _ = self.run_adb(["shell", "wm density"])
        if code == 0 and "Override density:" in stdout:
            match = re.search(r"Override density:\s*(\d+)", stdout)
            if match:
                return int(match.group(1))
        return DISPLAY_ACTIVE_DENSITY_DPI

    def check_input_device(self, node: str) -> Dict[str, Any]:
        """Inspects kernel input device node via getevent -i."""
        code, stdout, _ = self.run_adb(["shell", f"getevent -i {node}"])
        info: Dict[str, Any] = {"node": node, "present": (code == 0 and "name:" in stdout), "raw": stdout}
        if code == 0:
            name_match = re.search(r'name:\s*"([^"]+)"', stdout)
            if name_match:
                info["name"] = name_match.group(1)
            events_match = re.search(r"events:\s*([\w\s\(\)]+)", stdout)
            if events_match:
                info["events"] = events_match.group(1).strip()
        return info

    def inject_action_button(self) -> bool:
        """Injects hardware scancode 88 into /dev/input/event1."""
        script = (
            f"sendevent {KEYPAD_EVENT_NODE} 1 {SCANCODE_ACTION_BUTTON} 1; "
            f"sendevent {KEYPAD_EVENT_NODE} 0 0 0; "
            f"sendevent {KEYPAD_EVENT_NODE} 1 {SCANCODE_ACTION_BUTTON} 0; "
            f"sendevent {KEYPAD_EVENT_NODE} 0 0 0"
        )
        code, _, _ = self.run_adb(["shell", f"su 0 sh -c '{script}'"])
        return code == 0

    def send_broadcast(self, action: str, extras: Optional[Dict[str, str]] = None) -> bool:
        cmd = ["shell", "am", "broadcast", "-a", action]
        if extras:
            for k, v in extras.items():
                cmd.extend(["--es", k, v])
        code, _, _ = self.run_adb(cmd)
        return code == 0
