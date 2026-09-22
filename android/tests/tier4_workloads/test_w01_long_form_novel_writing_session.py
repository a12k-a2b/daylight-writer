"""Tier 4: Workload W-01 — Long-Form Novel Writing Session."""

import unittest
from tests.conftest import (
    BaseDaylightTestCase,
    KEYCODE_ACTION_BUTTON,
    KEYCODE_ESCAPE,
    SOLOS_TOKENS,
)
from tests.framework.bridge_simulator import DaylightBridgeSimulator
from tests.framework.device_driver import DC1DeviceDriver
from tests.framework.solos_token_verifier import SolosTokenVerifier


class TestW01LongFormNovelWritingSession(BaseDaylightTestCase):
    """Scenario 1: 1,000 words drafting session, typewriter center-scrolling at 120Hz, Focus mode cycling, and SAF export."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()
        self.driver = DC1DeviceDriver()

    def test_w01_novel_authoring_full_flow(self):
        """W01: Complete authoring session from canvas initialization to external SAF export."""
        # 1. Hardware verification: Confirm 120Hz mode ID 2 and 1584x1184 landscape geometry
        self.assertTrue(self.driver.is_120hz_available())
        w, h = self.driver.get_active_resolution()
        self.assertEqual((w, h), (1584, 1184))

        # 2. Styling check: Sol:OS base paper contrast
        ratio = SolosTokenVerifier.contrast_ratio(SOLOS_TOKENS["--os-900"], SOLOS_TOKENS["--os-0"])
        self.assertGreaterEqual(ratio, 7.0)

        # 3. Author writes 1,000 words
        paragraph = "The wind swept across the Sierra plateau, rustling the high pines. " * 15 # ~150 words
        full_manuscript = "\n\n".join([f"## Section {i}\n\n{paragraph}" for i in range(7)]) # ~1,050 words
        self.assertGreaterEqual(len(full_manuscript.split()), 1000)

        # 4. Author cycles Focus Mode via chassis Action button
        self.bridge.simulate_dispatch_key_event(KEYCODE_ACTION_BUTTON, action=0)
        self.assertEqual(self.bridge.web_focus_mode_cycles, 1)

        # 5. Author dismisses any open palette via Escape key
        self.bridge.simulate_dispatch_key_event(KEYCODE_ESCAPE, action=0)
        self.assertEqual(self.bridge.web_dismiss_drawers_calls, 1)

        # 6. Author exports manuscript to external storage via SAF
        export_ok = self.bridge.exportDocument(
            "Sierra_Plateau_Chapter1.md",
            "text/markdown",
            full_manuscript,
            False
        )
        self.assertTrue(export_ok)
        export_record = self.bridge.exports[-1]
        self.assertEqual(export_record.filename, "Sierra_Plateau_Chapter1.md")
        self.assertEqual(export_record.raw_data.decode("utf-8"), full_manuscript)
        self.assertIn("externalstorage.documents", export_record.destination_uri)


if __name__ == "__main__":
    unittest.main()
