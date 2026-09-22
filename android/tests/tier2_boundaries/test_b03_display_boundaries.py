"""Tier 2: Boundary B-03 — Display Geometry & Grayscale Token Boundaries."""

import unittest
from tests.conftest import BaseDaylightTestCase, SOLOS_TOKENS
from tests.framework.solos_token_verifier import SolosTokenVerifier


class TestB03DisplayBoundaries(BaseDaylightTestCase):
    """Verifies display aspect boundaries, monochromatic purity, and contrast thresholds."""

    def test_b03_1_all_solos_tokens_are_monochrome(self):
        """B3.1: All Sol:OS tokens strictly adhere to monochrome grayscale."""
        for token_name, hex_val in SOLOS_TOKENS.items():
            is_mono = SolosTokenVerifier.is_monochrome(hex_val)
            self.assertTrue(
                is_mono,
                f"Token {token_name} ({hex_val}) exhibits chromatic color leakage"
            )

    def test_b03_2_token_luminance_hierarchy_strictly_monotonic(self):
        """B3.2: Token luminance monotonically decreases from --os-0 (white) to --os-1000 (black)."""
        violations = SolosTokenVerifier.verify_tokens_hierarchy()
        self.assertEqual(len(violations), 0, f"Token luminance hierarchy violations: {violations}")

    def test_b03_3_secondary_ink_contrast_wcag_aa(self):
        """B3.3: Secondary text ink --os-400 (#535353) on --os-0 (#FFFFFF) satisfies WCAG AA (>= 4.5:1)."""
        ratio = SolosTokenVerifier.contrast_ratio(SOLOS_TOKENS["--os-400"], SOLOS_TOKENS["--os-0"])
        self.assertGreaterEqual(ratio, 4.5, "Secondary text ink must satisfy WCAG AA (>= 4.5:1)")

    def test_b03_4_disabled_element_contrast_boundary(self):
        """B3.4: Disabled text token --os-200 (#CCCCCC) on --os-0 has subtle but visible contrast (>1.4:1)."""
        ratio = SolosTokenVerifier.contrast_ratio(SOLOS_TOKENS["--os-200"], SOLOS_TOKENS["--os-0"])
        self.assertGreater(ratio, 1.4)
        self.assertLess(ratio, 3.0)

    def test_b03_5_rejection_of_chromatic_color_injection(self):
        """B3.5: Chromatic colors (e.g. vibrant blue #007AFF) are rejected by monochrome validator."""
        self.assertFalse(SolosTokenVerifier.is_monochrome("#007AFF"))
        self.assertFalse(SolosTokenVerifier.is_monochrome("#FF3B30"))
        self.assertFalse(SolosTokenVerifier.is_monochrome("#34C759"))


if __name__ == "__main__":
    unittest.main()
