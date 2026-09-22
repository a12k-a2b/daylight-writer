"""Tier 4: Workload W-03 — External Manuscript Ingestion via SAF."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestW03ExternalManuscriptIngestionViaSaf(BaseDaylightTestCase):
    """Scenario 3: External .md file opened via system file manager (ACTION_VIEW) imports into repository and canvas."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_w03_external_manuscript_ingestion_flow(self):
        """W03: System intent ACTION_VIEW triggers ContentResolver read, reverse bridge dispatch, and editor load."""
        external_title = "Field_Notes_2026.md"
        external_content = (
            "# Field Notes: Sol:OS LivePaper Deployment\n\n"
            "- 120Hz refresh rate eliminates typing lag.\n"
            "- Pure amber frontlight provides zero blue light exposure.\n"
            "- Sub-16ms hardware button response.\n"
        )

        # 1. System delivers intent
        doc_id = self.bridge.simulate_external_file_opened(external_title, external_content, "text/markdown")
        self.assertIsNotNone(doc_id)

        # 2. Assert document is registered in memory repository
        imported = self.bridge.web_imported_documents[-1]
        self.assertEqual(imported["id"], doc_id)
        self.assertEqual(imported["title"], external_title)
        self.assertEqual(imported["content"], external_content)

        # 3. Author shares newly imported draft to review partner
        share_ok = self.bridge.shareDocument(external_title, "text/plain", external_content, False)
        self.assertTrue(share_ok)
        self.assertEqual(self.bridge.shares[-1].text_content, external_content)


if __name__ == "__main__":
    unittest.main()
