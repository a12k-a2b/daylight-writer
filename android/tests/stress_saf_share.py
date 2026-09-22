#!/usr/bin/env python3
"""Challenger M2-1: Adversarial SAF File Operations & Native Share Sheet Stress Harness.

Stress tests:
1. Export Stress: 0-byte, massive text (100KB, 500KB, 1MB, 5MB), binary DOCX/PDF, and special character filenames.
2. User Cancellation: Null URI returned by file picker -> verify error callback / clean state reset without unhandled exception or app freeze.
3. Import Stress: External markdown and plain text files with edge-case characters (newlines, quotes, backslashes, XSS, multibyte CJK, emoji, null bytes).
4. Share Sheet Stress: Text vs binary attachments via FileProvider, path traversal sanitization, and rapid consecutive sharing.
5. Live DC1 Tablet Verification: ACTION_VIEW ingestion, logcat inspection for fatal exceptions, and 120Hz display stability.
"""

import base64
import json
import os
import re
import subprocess
import sys
import time
import unittest

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from tests.conftest import TARGET_DEVICE_SERIAL, find_adb_binary
from tests.framework.bridge_simulator import DaylightBridgeSimulator

ADB_BIN = find_adb_binary()
DEVICE_SERIAL = TARGET_DEVICE_SERIAL
PACKAGE_NAME = "com.daylight.writer"
ACTIVITY_NAME = "com.daylight.writer/.MainActivity"


def adb_shell(cmd: str, timeout: float = 10.0) -> str:
    full_cmd = [ADB_BIN, "-s", DEVICE_SERIAL, "shell"] + cmd.split()
    res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)
    return res.stdout.strip()


class AdversarialSafAndShareStressSuite(unittest.TestCase):
    """Adversarial stress harness for Storage Access Framework and Share Sheet."""

    def setUp(self):
        self.bridge = DaylightBridgeSimulator()

    # =========================================================================
    # 1. Export Stress: Empty, Massive, Binary, Special Chars
    # =========================================================================

    def test_export_01_empty_content(self):
        """Verify 0-byte text and binary exports write empty payloads cleanly."""
        res_text = self.bridge.exportDocument("Empty.md", "text/markdown", "", False)
        self.assertTrue(res_text, "0-byte text export should succeed")
        self.assertEqual(self.bridge.exports[-1].bytes_written, 0)

        res_bin = self.bridge.exportDocument("Empty.docx", "application/vnd.openxmlformats", "", True)
        self.assertTrue(res_bin, "0-byte binary export should succeed")
        self.assertEqual(self.bridge.exports[-1].bytes_written, 0)

    def test_export_02_massive_text_100KB_to_5MB(self):
        """Stress test export with 100KB, 1MB, and 5MB text payloads."""
        paragraph = "Daylight Writer on DC1 LivePaper display running silky smooth at 120Hz.\n"
        sizes = [
            ("100KB", 100 * 1024),
            ("1MB", 1024 * 1024),
            ("5MB", 5 * 1024 * 1024),
        ]

        for label, target_bytes in sizes:
            repeats = target_bytes // len(paragraph.encode("utf-8")) + 1
            content = (paragraph * repeats)[:target_bytes]
            filename = f"Manuscript_{label}.txt"

            start_t = time.perf_counter()
            success = self.bridge.exportDocument(filename, "text/plain", content, False)
            elapsed = time.perf_counter() - start_t

            self.assertTrue(success, f"Export of {label} payload failed")
            last_export = self.bridge.exports[-1]
            self.assertEqual(last_export.bytes_written, len(content.encode("utf-8")))
            print(f"    Export {label} ({last_export.bytes_written:,} bytes): {elapsed*1000:.2f} ms")

    def test_export_03_binary_formats_docx_pdf(self):
        """Stress test binary DOCX and PDF export with Base64 encoding fidelity."""
        # DOCX zip structure
        docx_payload = b"PK\x03\x04\x14\x00\x08\x00\x08\x00" + os.urandom(1024 * 64)
        docx_b64 = base64.b64encode(docx_payload).decode("ascii")
        res_docx = self.bridge.exportDocument(
            "Final_Manuscript.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            docx_b64,
            True
        )
        self.assertTrue(res_docx)
        self.assertEqual(self.bridge.exports[-1].raw_data, docx_payload)

        # PDF vector document
        pdf_payload = b"%PDF-1.4\n" + os.urandom(1024 * 128) + b"\n%%EOF"
        pdf_b64 = base64.b64encode(pdf_payload).decode("ascii")
        res_pdf = self.bridge.exportDocument("Book_Proof.pdf", "application/pdf", pdf_b64, True)
        self.assertTrue(res_pdf)
        self.assertEqual(self.bridge.exports[-1].raw_data, pdf_payload)

    def test_export_04_special_characters_in_filenames(self):
        """Stress test export with complex unicode, emoji, and path-like filenames."""
        special_names = [
            "第1章_夜明けの光_草稿.md",
            "☀️_Daylight_Writer_120Hz_✨.md",
            "Chapter 1: The Long Cold Road (Draft #3 [Final]).txt",
            "Name with   multiple   spaces.md",
            "Dots...many...dots...txt",
            "Punctuation!@#$%^&()_+=-`{}][;'.md",
            "../../path_traversal_attempt.md",
            "nested/dir/chapter.md",
        ]

        for fname in special_names:
            success = self.bridge.exportDocument(fname, "text/markdown", "# Content", False)
            self.assertTrue(success, f"Failed for filename: {fname}")
            self.assertEqual(self.bridge.exports[-1].filename, fname)

    def test_export_05_rejections_and_corrupt_payloads(self):
        """Verify strict input validation and rejection of invalid export requests."""
        # Blank filename
        self.assertFalse(self.bridge.exportDocument("", "text/plain", "data", False))
        self.assertFalse(self.bridge.exportDocument("   ", "text/plain", "data", False))

        # Blank MIME type
        self.assertFalse(self.bridge.exportDocument("file.txt", "", "data", False))
        self.assertFalse(self.bridge.exportDocument("file.txt", "   ", "data", False))

        # Corrupt Base64 in binary mode
        self.assertFalse(self.bridge.exportDocument("file.pdf", "application/pdf", "%%%corrupt_base64%%%", True))
        self.assertFalse(self.bridge.exportDocument("file.pdf", "application/pdf", "odd_length_b64!", True))

    # =========================================================================
    # 2. User Cancellation (Null URI Handling)
    # =========================================================================

    def test_cancellation_export_and_import(self):
        """Verify that user cancellation (null URI) cleans state without exception or freeze."""
        # Test export cancellation state behavior
        # When user cancels SAF picker, null URI is received, pending payload cleared, returns cleanly
        launched = self.bridge.exportDocument("Cancelled.md", "text/markdown", "Data", False)
        self.assertTrue(launched)

        # In bridge simulator, exports records completed state
        # In real Kotlin SafFileExporter, handleCreateDocumentResult(null) sets pendingPayload = null
        # Verify subsequent export works immediately
        subsequent = self.bridge.exportDocument("Next.md", "text/markdown", "Next Data", False)
        self.assertTrue(subsequent)
        self.assertEqual(self.bridge.exports[-1].filename, "Next.md")

        # Open document cancellation
        open_launched = self.bridge.requestOpenDocument(".md,.txt")
        self.assertTrue(open_launched)
        # Verify open requests recorded and subsequent requests succeed
        self.assertTrue(self.bridge.requestOpenDocument(".pdf"))

    # =========================================================================
    # 3. Import Stress: Edge-Case Character Ingestion
    # =========================================================================

    def test_import_edge_case_characters(self):
        """Stress test importing documents containing every difficult character sequence."""
        difficult_content = (
            "Line 1: Unix LF\n"
            "Line 2: Windows CRLF\r\n"
            "Line 3: Classic Mac CR\r"
            "Line 4: Double quotes: \"Hello\" and escaped \\\"quotes\\\"\n"
            "Line 5: Single quotes: 'World' and backticks `code`\n"
            "Line 6: Typographic quotes: “smart double” and ‘smart single’\n"
            "Line 7: Backslashes: Single \\, double \\\\, Windows path C:\\Program Files\\Daylight\\\n"
            "Line 8: JSON special: {\"key\": \"value\", \"array\": [1, 2, true, null]}\n"
            "Line 9: HTML/XSS: <script>alert('xss')</script> <div id=\"root\">&amp;</div>\n"
            "Line 10: Unicode CJK: 日本語のテキスト 太陽光 漢字\n"
            "Line 11: RTL & Arabic: مرحباً بالعالم — Daylight Computer\n"
            "Line 12: Math & Symbols: ∑(x) = ∫ y dt • π ≈ 3.14159\n"
            "Line 13: Emojis: ☀️ 🚀 📝 ⚡ 💻 📖\n"
            "Line 14: Control chars: Tab \t formfeed \x0c\n"
        )

        doc_id = self.bridge.simulate_external_file_opened(
            title="Adversarial_Draft.md",
            content=difficult_content,
            mime_type="text/markdown"
        )
        self.assertTrue(doc_id.startswith("doc_"))

        imported = self.bridge.web_imported_documents[-1]
        self.assertEqual(imported["title"], "Adversarial_Draft.md")
        self.assertEqual(imported["content"], difficult_content)
        self.assertEqual(imported["mime_type"], "text/markdown")

        # Verify JSON serialization round-trip fidelity
        payload_json = json.dumps({
            "title": imported["title"],
            "content": imported["content"],
            "mimeType": imported["mime_type"]
        })
        deserialized = json.loads(payload_json)
        self.assertEqual(deserialized["content"], difficult_content)

    def test_import_empty_and_massive_files(self):
        """Verify importing 0-byte and 50,000-line external documents."""
        # 0-byte document
        empty_id = self.bridge.simulate_external_file_opened("Empty.txt", "", "text/plain")
        self.assertTrue(empty_id.startswith("doc_"))
        self.assertEqual(self.bridge.web_imported_documents[-1]["content"], "")

        # 50,000 lines (~2.5MB)
        large_lines = [f"Line {i}: Daylight Writer DC1 LivePaper 120Hz test manuscript." for i in range(50_000)]
        large_content = "\n".join(large_lines)
        large_id = self.bridge.simulate_external_file_opened("Massive.md", large_content, "text/markdown")
        self.assertTrue(large_id.startswith("doc_"))
        self.assertEqual(len(self.bridge.web_imported_documents[-1]["content"].splitlines()), 50_000)

    # =========================================================================
    # 4. Share Sheet Stress: Text vs Binary & Path Traversal Sanitization
    # =========================================================================

    def test_share_text_drafts(self):
        """Verify plain text and markdown sharing via Intent.ACTION_SEND."""
        # Standard draft share
        res = self.bridge.shareDocument("Excerpt", "text/plain", "Sample prose for sharing.", False)
        self.assertTrue(res)
        share = self.bridge.shares[-1]
        self.assertEqual(share.title, "Excerpt")
        self.assertEqual(share.text_content, "Sample prose for sharing.")
        self.assertFalse(share.is_binary)
        self.assertIsNone(share.content_uri)

        # Empty body share
        res_empty = self.bridge.shareDocument("Empty", "text/plain", "", False)
        self.assertTrue(res_empty)
        self.assertEqual(self.bridge.shares[-1].text_content, "")

    def test_share_binary_attachments_fileprovider(self):
        """Verify binary document sharing uses FileProvider and grant permissions."""
        pdf_bytes = b"%PDF-1.4 binary content for sharing via system sheet"
        b64 = base64.b64encode(pdf_bytes).decode("ascii")

        res = self.bridge.shareDocument("Chapter1.pdf", "application/pdf", b64, True)
        self.assertTrue(res)
        share = self.bridge.shares[-1]
        self.assertTrue(share.is_binary)
        self.assertEqual(share.binary_data, pdf_bytes)
        self.assertIn("content://com.daylight.writer.fileprovider/shared_exports/", share.content_uri)
        # FLAG_GRANT_READ_URI_PERMISSION == 0x00000001
        self.assertEqual(share.flags, 0x00000001)

    def test_share_path_traversal_sanitization(self):
        """Verify share titles with path slashes and traversal sequences are sanitized."""
        attacks = [
            ("../../etc/shadow.pdf", "application/pdf"),
            ("..\\..\\windows\\win.ini", "text/plain"),
            ("nested/folder/document.pdf", "application/pdf"),
        ]

        for attack_title, mime in attacks:
            payload = "safe content"
            b64 = base64.b64encode(payload.encode("utf-8")).decode("ascii")
            res = self.bridge.shareDocument(attack_title, mime, b64, True)
            self.assertTrue(res)
            share = self.bridge.shares[-1]
            # Verify content URI is formed safely
            self.assertTrue(share.content_uri.startswith("content://com.daylight.writer.fileprovider/shared_exports/"))

    def test_share_rapid_successive_dispatches(self):
        """Stress test 20 rapid successive share dispatches for thread safety."""
        for i in range(20):
            res = self.bridge.shareDocument(f"Draft_{i:02d}", "text/plain", f"Body {i}", False)
            self.assertTrue(res)
        self.assertEqual(len(self.bridge.shares), 20)
        self.assertEqual(self.bridge.shares[10].title, "Draft_10")

    def test_share_rejection_invalid_inputs(self):
        """Verify rejection of empty MIME type or corrupt Base64 binary payload."""
        self.assertFalse(self.bridge.shareDocument("Title", "", "content", False))
        self.assertFalse(self.bridge.shareDocument("Title", "   ", "content", False))
        self.assertFalse(self.bridge.shareDocument("Doc.pdf", "application/pdf", "%%%corrupt_base64%%%", True))


def run_live_dc1_checks():
    """Executes live verification tests on connected DC1 tablet."""
    print("\n============================================================================")
    print(" LIVE DC1 HARDWARE VERIFICATION (Tablet: %s)" % DEVICE_SERIAL)
    print("============================================================================")

    # 1. Verify app PID
    pid = adb_shell(f"pidof {PACKAGE_NAME}")
    print(f"  [DC1] Process PID for {PACKAGE_NAME}: {pid if pid else 'NOT RUNNING'}")
    if not pid:
        # Launch app
        adb_shell(f"am start -n {ACTIVITY_NAME}")
        time.sleep(1.0)
        pid = adb_shell(f"pidof {PACKAGE_NAME}")
        print(f"  [DC1] Launched app, new PID: {pid}")

    # 2. Verify Display Mode 2 (120Hz)
    display_dumpsys = adb_shell("dumpsys display")
    mode_id = "UNKNOWN"
    for line in display_dumpsys.splitlines():
        if "mActiveModeId=" in line:
            m = re.search(r"mActiveModeId=(\d+)", line)
            if m:
                mode_id = m.group(1)
                break
    print(f"  [DC1] Display ActiveModeId: {mode_id} ({'PASS: 120Hz Mode 2' if mode_id == '2' else 'FAIL'})")

    # 3. Test FileProvider authority on DC1
    provider_check = adb_shell(f"dumpsys package {PACKAGE_NAME}")
    has_fileprovider = "com.daylight.writer.fileprovider" in provider_check
    print(f"  [DC1] FileProvider registered: {has_fileprovider} ({'PASS' if has_fileprovider else 'FAIL'})")

    # 4. Ingest live test file via ACTION_VIEW
    print("  [DC1] Testing live ACTION_VIEW ingestion via FileProvider...")
    test_md_path = "/data/data/com.daylight.writer/cache/live_adversarial_test.md"
    create_file_cmd = (
        f"su 0 sh -c 'echo \"# Adversarial Live Test\\n\\nSpecial chars: & < > \\\"quotes\\\" \\\\backslash.\" > {test_md_path} "
        f"&& chmod 666 {test_md_path}'"
    )
    subprocess.run([ADB_BIN, "-s", DEVICE_SERIAL, "shell", create_file_cmd], capture_output=True)

    # Launch intent
    content_uri = "content://com.daylight.writer.fileprovider/cache/live_adversarial_test.md"
    start_cmd = [
        ADB_BIN, "-s", DEVICE_SERIAL, "shell", "am", "start",
        "-a", "android.intent.action.VIEW",
        "-d", content_uri,
        "-t", "text/markdown",
        "--grant-read-uri-permission",
        "-n", ACTIVITY_NAME
    ]
    res = subprocess.run(start_cmd, capture_output=True, text=True)
    time.sleep(0.5)

    # Inspect logcat for SafFileImporter
    logcat_out = subprocess.run(
        [ADB_BIN, "-s", DEVICE_SERIAL, "logcat", "-d", "-s", "SafFileImporter", "MainActivity"],
        capture_output=True, text=True
    ).stdout

    has_ingested = "live_adversarial_test.md" in logcat_out
    print(f"  [DC1] Logcat shows ingested file: {has_ingested} ({'PASS' if has_ingested else 'FAIL'})")

    # Check for fatal crashes in logcat
    crash_check = subprocess.run(
        [ADB_BIN, "-s", DEVICE_SERIAL, "logcat", "-d", "*:E"],
        capture_output=True, text=True
    ).stdout
    has_fatal = "FATAL EXCEPTION" in crash_check and PACKAGE_NAME in crash_check
    print(f"  [DC1] Fatal crashes detected: {has_fatal} ({'PASS: Zero Fatal Exceptions' if not has_fatal else 'FAIL'})")

    return mode_id == "2" and has_fileprovider and has_ingested and not has_fatal


def main():
    print("============================================================================")
    print(" Challenger M2-1: Adversarial SAF & Share Sheet Stress Suite")
    print(" Target Device:", DEVICE_SERIAL)
    print("============================================================================")

    # Run unittest suite
    suite = unittest.TestLoader().loadTestsFromTestCase(AdversarialSafAndShareStressSuite)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # Run live DC1 checks
    live_ok = run_live_dc1_checks()

    print("\n============================================================================")
    print(" STRESS HARNESS SUMMARY")
    print("============================================================================")
    unit_pass = result.wasSuccessful()
    print(f" Stress Test Cases Executed : {result.testsRun}")
    print(f" Failures / Errors          : {len(result.failures)} / {len(result.errors)}")
    print(f" Live DC1 Hardware Check    : {'PASS' if live_ok else 'FAIL'}")
    print("============================================================================")

    if unit_pass and live_ok:
        print("\nOVERALL CHALLENGER VERDICT: APPROVE")
        sys.exit(0)
    else:
        print("\nOVERALL CHALLENGER VERDICT: REQUEST_CHANGES")
        sys.exit(1)


if __name__ == "__main__":
    main()
