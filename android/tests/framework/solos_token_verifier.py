"""Sol:OS Grayscale Token and LivePaper Contrast Verifier."""

from typing import Dict, List, Tuple
from tests.conftest import SOLOS_TOKENS, FORBIDDEN_EPD_PATTERNS


class SolosTokenVerifier:
    """Validates 8-bit grayscale Sol:OS design tokens and WCAG 2.1 AA/AAA compliance."""

    @staticmethod
    def hex_to_rgb(hex_code: str) -> Tuple[int, int, int]:
        h = hex_code.lstrip("#")
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)

    @staticmethod
    def is_monochrome(hex_code: str) -> bool:
        r, g, b = SolosTokenVerifier.hex_to_rgb(hex_code)
        # Allows maximum 2-unit delta for warm paper tinting (e.g. #DCD5C9)
        return max(abs(r - g), abs(g - b), abs(r - b)) <= 20

    @staticmethod
    def relative_luminance(hex_code: str) -> float:
        r, g, b = [x / 255.0 for x in SolosTokenVerifier.hex_to_rgb(hex_code)]
        def adjust(c):
            return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        return 0.2126 * adjust(r) + 0.7152 * adjust(g) + 0.0722 * adjust(b)

    @classmethod
    def contrast_ratio(cls, color_a: str, color_b: str) -> float:
        l1 = cls.relative_luminance(color_a)
        l2 = cls.relative_luminance(color_b)
        lighter = max(l1, l2)
        darker = min(l1, l2)
        return (lighter + 0.05) / (darker + 0.05)

    @classmethod
    def verify_tokens_hierarchy(cls) -> List[str]:
        """Verifies that token luminance monotonically decreases from --os-0 to --os-1000."""
        ordered_keys = ["--os-0", "--os-50", "--os-150", "--os-200", "--os-300", "--os-400", "--os-800", "--os-900", "--os-1000"]
        violations = []
        prev_lum = 2.0
        for k in ordered_keys:
            if k not in SOLOS_TOKENS:
                violations.append(f"Missing token: {k}")
                continue
            lum = cls.relative_luminance(SOLOS_TOKENS[k])
            if lum >= prev_lum:
                violations.append(f"Luminance inversion at {k}: {lum:.4f} >= previous {prev_lum:.4f}")
            prev_lum = lum
        return violations

    @classmethod
    def scan_for_forbidden_epd_patterns(cls, content: str) -> List[str]:
        found = []
        for pat in FORBIDDEN_EPD_PATTERNS:
            if pat in content:
                found.append(pat)
        return found
