"""Tier 3: Pairwise X-14 — SAF File Export (F04) + SAF File Open (F05) Roundtrip."""

import unittest
from tests.conftest import BaseDaylightTestCase
from tests.framework.bridge_simulator import DaylightBridgeSimulator


class TestX14RoundtripExportAndReopenFidelity(BaseDaylightTestCase):
    """Verifies complete 100% byte-for-byte fidelity across SAF export and subsequent re-open."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    def test_x14_roundtrip_markdown_export_and_import(self):
        """X14: Export document to Markdown via SAF, then re-import via open intent; content matches 100%."""
        original_title = "Roundtrip Chapter"
        original_body = "# Chapter 5: The High Plateau\n\nWords typed on DC1 120Hz LivePaper."

        # 1. Export
        export_ok = self.bridge.exportDocument(f"{original_title}.md", "text/markdown", original_body, False)
        self.assertTrue(export_ok)
        exported_bytes = self.bridge.exports[-1].raw_data

        # 2. Re-open / import
        doc_id = self.bridge.simulate_external_file_opened(
            f"{original_title}.md",
            exported_bytes.decode("utf-8"),
            "text/markdown"
        )
        self.assertIsNotNone(doc_id)

        # 3. Assert fidelity
        imported = self.bridge.web_imported_documents[-1]
        self.assertEqual(imported["content"], original_body)
        self.assertEqual(imported["title"], f"{original_title}.md")


if __name__ == "__main__":
    unittest.main()
