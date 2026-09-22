"""Common test fixtures, constants, and paths for Daylight Writer Android E2E Suite."""

import os
import shutil
import subprocess
import unittest
from typing import Dict, Any, Optional

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP_DIR = os.path.join(PROJECT_ROOT, "app")
RES_DIR = os.path.join(APP_DIR, "src/main/res")
ASSETS_DIR = os.path.join(APP_DIR, "src/main/assets")
MANIFEST_PATH = os.path.join(APP_DIR, "src/main/AndroidManifest.xml")

WEB_PROJECT_ROOT = "/Users/anjan/teamwork_projects/daylight_writer"
WEB_DIST_DIR = os.path.join(WEB_PROJECT_ROOT, "dist")
WEB_ASSETS_DIR = os.path.join(WEB_DIST_DIR, "assets")


def find_adb_binary() -> str:
    """Locates the adb executable on the host system."""
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
    return shutil.which("adb") or "adb"


def discover_target_device_serial() -> str:
    """Dynamically discovers connected Daylight Computer (DC1) tablet serial.

    Resolution order:
    1. DAYLIGHT_DEVICE_SERIAL (or ANDROID_SERIAL) environment variable if set.
    2. Parsing `adb devices -l` / `adb devices`:
       - JMBR00405 ('rooted 4') preferred if online and authorized.
       - JMBR00380 ('rooted 3') fallback if online and authorized.
       - Any connected tablet with model 'DC_1' / 'DC-1', product 'vext_jagar', or serial 'JMBR*' / 'JP5R*'.
       - Any active device in state 'device'.
    3. Fallback default: 'JMBR00405'.
    """
    env_serial = os.environ.get("DAYLIGHT_DEVICE_SERIAL") or os.environ.get("ANDROID_SERIAL")
    if env_serial and env_serial.strip():
        return env_serial.strip()

    adb = find_adb_binary()
    try:
        res = subprocess.run([adb, "devices", "-l"], capture_output=True, text=True, timeout=5.0)
        if res.returncode == 0:
            lines = res.stdout.strip().splitlines()
            connected_devices = []
            for line in lines[1:]:
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) >= 2 and parts[1] == "device":
                    serial = parts[0]
                    extra = " ".join(parts[2:])
                    connected_devices.append((serial, extra))

            connected_serials = [s for s, _ in connected_devices]

            # JMBR00405 ('rooted 4') preferred
            if "JMBR00405" in connected_serials:
                return "JMBR00405"
            # JMBR00380 ('rooted 3') fallback
            if "JMBR00380" in connected_serials:
                return "JMBR00380"

            # Any connected DC1 tablet
            for s, extra in connected_devices:
                if any(x in extra.lower() for x in ["vext_jagar", "dc_1", "dc-1"]) or s.startswith("JMBR") or s.startswith("JP5R"):
                    return s

            if connected_serials:
                return connected_serials[0]
    except Exception:
        pass

    return "JMBR00405"


def get_device_alias(serial: str) -> str:
    """Returns human-friendly alias for DC1 hardware."""
    if serial == "JMBR00405":
        return "rooted 4"
    elif serial == "JMBR00380":
        return "rooted 3"
    return serial


# Target Hardware: Daylight Computer DC1 (dynamically resolved)
TARGET_DEVICE_SERIAL = discover_target_device_serial()
TARGET_DEVICE_MODEL = "DC-1"
TARGET_PRODUCT_NAME = "vext_jagar"
TARGET_SOC_NAME = "mt8781"
TARGET_ANDROID_VERSION = "13"
TARGET_SDK_INT = 33
COMPILE_SDK_INT = 33

# Display Specifications (R1)
DISPLAY_PHYSICAL_WIDTH = 1200
DISPLAY_PHYSICAL_HEIGHT = 1600
DISPLAY_ACTIVE_WIDTH = 1584
DISPLAY_ACTIVE_HEIGHT = 1184
DISPLAY_ACTIVE_DENSITY_DPI = 270
DISPLAY_BEZEL_INSET_PX = 8
DISPLAY_MODE_ID_120HZ = 2
DISPLAY_REFRESH_RATE_120HZ = 120.00001

# APK Size Budget Threshold (Acceptance Criteria: <10MB excluding assets)
MAX_APK_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB

# Hardware Key & Sensor Definitions (R3)
SCANCODE_ACTION_BUTTON = 88
KEYCODE_ACTION_BUTTON = 142  # KeyEvent.KEYCODE_F12
KEYCODE_ESCAPE = 111         # KeyEvent.KEYCODE_ESCAPE
HALL_SENSOR_EVENT_NODE = "/dev/input/event3"
KEYPAD_EVENT_NODE = "/dev/input/event1"
HALL_SWITCH_CODE = 0x00      # SW_LID
ACTION_SCREEN_OFF = "android.intent.action.SCREEN_OFF"
ACTION_BUTTON_BROADCAST = "com.daylightcomputer.solosserver.ACTION_BUTTON_SINGLE_PRESS"
WAKELOCK_TIMEOUT_MS = 3000

# Sol:OS 8-bit Grayscale Tokens (Calibrated neutral scale)
SOLOS_TOKENS = {
    "--os-0": "#FFFFFF",      # Base paper / ground
    "--os-50": "#F7F7F7",     # Surface panels / cards
    "--os-100": "#DCD5C9",    # Hairline borders (or rgba(0,0,0,0.08))
    "--os-150": "#F5F5F5",    # Recessed canvas
    "--os-200": "#CCCCCC",    # Disabled
    "--os-300": "#858585",    # Low emphasis / tertiary text
    "--os-400": "#535353",    # Secondary text ink
    "--os-800": "#343434",    # Dark fields / pressed states
    "--os-900": "#1A1A1A",    # Primary text ink / headlines
    "--os-1000": "#000000",   # Max black ink
}

# Forbidden EPD Anti-Patterns (Must never be present)
FORBIDDEN_EPD_PATTERNS = [
    "ACTION_REFRESH_SCREEN",
    "com.daylight.action.REFRESH_SCREEN",
    "epd_waveform",
    "waveform_clear",
    "EPD_PARTICLE_REFRESH",
]


class BaseDaylightTestCase(unittest.TestCase):
    """Base test case providing shared fixtures, paths, and assertion helpers."""

    @classmethod
    def setUpClass(cls):
        cls.project_root = PROJECT_ROOT
        cls.web_project_root = WEB_PROJECT_ROOT
        cls.web_dist_dir = WEB_DIST_DIR
        cls.device_serial = TARGET_DEVICE_SERIAL
        cls.solos_tokens = SOLOS_TOKENS

    def assertGrayscaleContrast(self, fg_hex: str, bg_hex: str, min_ratio: float, msg: str = None):
        """Calculate relative luminance and assert contrast ratio satisfies threshold."""
        ratio = self._calculate_contrast_ratio(fg_hex, bg_hex)
        self.assertGreaterEqual(
            ratio,
            min_ratio,
            msg or f"Contrast ratio {ratio:.2f}:1 between {fg_hex} and {bg_hex} is below required {min_ratio}:1"
        )

    @staticmethod
    def _calculate_contrast_ratio(color1: str, color2: str) -> float:
        """WCAG 2.1 relative luminance contrast calculation."""
        def hex_to_rgb(h: str):
            h = h.lstrip("#")
            return tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))

        def luminance(rgb):
            components = []
            for c in rgb:
                if c <= 0.03928:
                    components.append(c / 12.92)
                else:
                    components.append(((c + 0.055) / 1.055) ** 2.4)
            return 0.2126 * components[0] + 0.7152 * components[1] + 0.0722 * components[2]

        l1 = luminance(hex_to_rgb(color1))
        l2 = luminance(hex_to_rgb(color2))
        lighter = max(l1, l2)
        darker = min(l1, l2)
        return (lighter + 0.05) / (darker + 0.05)
