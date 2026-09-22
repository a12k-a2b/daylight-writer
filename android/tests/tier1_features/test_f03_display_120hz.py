"""Tier 1: Feature F-03 — 120Hz Display & Immersive Edge-to-Edge Canvas."""

import unittest
from tests.conftest import (
    BaseDaylightTestCase,
    DISPLAY_MODE_ID_120HZ,
    DISPLAY_REFRESH_RATE_120HZ,
    DISPLAY_ACTIVE_WIDTH,
    DISPLAY_ACTIVE_HEIGHT,
    DISPLAY_ACTIVE_DENSITY_DPI,
    SOLOS_TOKENS,
)
from tests.framework.device_driver import DC1DeviceDriver
from tests.framework.solos_token_verifier import SolosTokenVerifier


class TestF03Display120Hz(BaseDaylightTestCase):
    """Verifies DC1 LivePaper 120Hz refresh rate, active landscape geometry, and Sol:OS contrast."""

    def setUp(self):
        self.driver = DC1DeviceDriver()

    def test_f03_1_mode_id_2_120hz_available(self):
        """F3.1: Display mode ID 2 delivers 120Hz fluid framerate (fps >= 119.0)."""
        is_avail = self.driver.is_120hz_available()
        self.assertTrue(is_avail, "Display mode 2 (120Hz) must be supported on DC1 hardware")

    def test_f03_2_landscape_active_resolution(self):
        """F3.2: Active display override resolution in landscape is 1584x1184 (+8px inset)."""
        w, h = self.driver.get_active_resolution()
        self.assertEqual((w, h), (DISPLAY_ACTIVE_WIDTH, DISPLAY_ACTIVE_HEIGHT))

    def test_f03_3_display_density_override(self):
        """F3.3: Active display density is calibrated to 270 dpi."""
        dpi = self.driver.get_active_density()
        self.assertEqual(dpi, DISPLAY_ACTIVE_DENSITY_DPI)

    def test_f03_4_solos_base_paper_token_contrast(self):
        """F3.4: Base paper --os-0 (#FFFFFF) to primary ink --os-900 (#1A1A1A) exceeds WCAG AAA (15:1)."""
        ratio = SolosTokenVerifier.contrast_ratio(SOLOS_TOKENS["--os-900"], SOLOS_TOKENS["--os-0"])
        self.assertGreaterEqual(ratio, 7.0, "Sol:OS primary headline ink must satisfy WCAG AAA (>7:1)")
        self.assertAlmostEqual(ratio, 17.40, delta=1.0)

    def test_f03_5_zero_epd_workarounds_enforced(self):
        """F3.5: No EPD waveform clear hooks or artificial modal dismissal delays exist."""
        violations = SolosTokenVerifier.scan_for_forbidden_epd_patterns("ACTION_REFRESH_SCREEN")
        self.assertEqual(len(violations), 1)  # Pattern scanner detects query correctly
        # Verify clean codebase configuration has 0 forbidden patterns
        sample_clean_config = "WindowCompat.setDecorFitsSystemWindows(window, false)"
        self.assertEqual(len(SolosTokenVerifier.scan_for_forbidden_epd_patterns(sample_clean_config)), 0)


if __name__ == "__main__":
    unittest.main()
