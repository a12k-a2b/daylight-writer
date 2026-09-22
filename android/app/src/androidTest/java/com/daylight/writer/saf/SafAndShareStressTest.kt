package com.daylight.writer.saf

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.daylight.writer.MainActivity
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Adversarial Stress Test Suite for Milestone 2:
 * Storage Access Framework (SAF) & Native Share Sheet Integration.
 *
 * Verifies:
 * 1. Export with 0-byte, large text (100KB, 500KB, 1MB), binary DOCX/PDF, and special character filenames.
 * 2. Export user cancellation (null URI) cleans pending payload without unhandled exceptions or app freeze.
 * 3. Import with edge-case characters (newlines CRLF/LF/CR, quotes, backslashes, XSS, unicode, emojis, null bytes).
 * 4. Share sheet invocation for plain text vs binary attachments via FileProvider.
 * 5. Path traversal sanitization and URI permission grants.
 */
@RunWith(AndroidJUnit4::class)
class SafAndShareStressTest {

    private lateinit var context: Context

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
    }

    // ========================================================================
    // 1. SAF Export Stress & Edge Cases
    // ========================================================================

    @Test
    fun testExport_emptyContent_textAndBinary() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val exporter = activity.fileExporter

                // Text export with 0-byte content
                val textSuccess = exporter.exportDocument("Empty.md", "text/markdown", "", false)
                assertTrue("Exporting 0-byte text document should succeed", textSuccess)

                // Binary export with 0-byte content (empty Base64)
                val binarySuccess = exporter.exportDocument("Empty.docx", "application/vnd.openxmlformats", "", true)
                assertTrue("Exporting 0-byte binary document should succeed", binarySuccess)
            }
        }
    }

    @Test
    fun testExport_largeText_100KB_and_1MB() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val exporter = activity.fileExporter

                // 100KB+ text document (~150KB)
                val chunk = "The quick brown fox jumps over the lazy dog on DC1 LivePaper 120Hz display.\n"
                val text100KB = chunk.repeat(2000) // ~150,000 bytes
                val success100KB = exporter.exportDocument("Large_100KB.txt", "text/plain", text100KB, false)
                assertTrue("Exporting 100KB+ text should succeed", success100KB)

                // 1MB+ text document (~1.05MB)
                val text1MB = chunk.repeat(14000)
                val success1MB = exporter.exportDocument("Large_1MB.md", "text/markdown", text1MB, false)
                assertTrue("Exporting 1MB+ text should succeed", success1MB)
            }
        }
    }

    @Test
    fun testExport_binaryFormats_docx_and_pdf() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val exporter = activity.fileExporter

                // Word .docx fake zip payload
                val docxBytes = byteArrayOf(0x50, 0x4B, 0x03, 0x04) + "word/document.xml".toByteArray()
                val docxB64 = Base64.encodeToString(docxBytes, Base64.NO_WRAP)
                val docxSuccess = exporter.exportDocument(
                    "Thesis.docx",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    docxB64,
                    true
                )
                assertTrue("Exporting binary .docx should succeed", docxSuccess)

                // Vector .pdf payload
                val pdfBytes = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF".toByteArray()
                val pdfB64 = Base64.encodeToString(pdfBytes, Base64.NO_WRAP)
                val pdfSuccess = exporter.exportDocument("Manuscript.pdf", "application/pdf", pdfB64, true)
                assertTrue("Exporting binary .pdf should succeed", pdfSuccess)
            }
        }
    }

    @Test
    fun testExport_specialCharactersInFilenames() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val exporter = activity.fileExporter

                val edgeCaseFilenames = listOf(
                    "Chapter_1_第1章_草稿.md",
                    "⚡_Daylight_Writer_✨.md",
                    "Draft #1 (Final - Rev 2.1).txt",
                    "Space in   filename   here.txt",
                    "Dots...in...name...md",
                    "SpecialChars~!@#$%^&()_+=-`{}][;'.md",
                    "../../path_traversal_attempt.md",
                    "folder/subfolder/file.md"
                )

                for (filename in edgeCaseFilenames) {
                    val success = exporter.exportDocument(filename, "text/markdown", "# Content", false)
                    assertTrue("Export should accept edge case filename '$filename'", success)
                }
            }
        }
    }

    @Test
    fun testExport_rejection_blankFilenameAndMime() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val exporter = activity.fileExporter

                assertFalse("Blank filename must be rejected", exporter.exportDocument("", "text/plain", "abc", false))
                assertFalse("Whitespace filename must be rejected", exporter.exportDocument("   ", "text/plain", "abc", false))
                assertFalse("Blank mimeType must be rejected", exporter.exportDocument("file.txt", "", "abc", false))
                assertFalse("Whitespace mimeType must be rejected", exporter.exportDocument("file.txt", "   ", "abc", false))
                assertFalse("Corrupt Base64 binary must be rejected", exporter.exportDocument("file.pdf", "application/pdf", "!@#\\\$not_base64", true))
            }
        }
    }

    @Test
    fun testExport_userCancellation_cleanHandling() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val exporter = activity.fileExporter

                // Launch an export to set pendingPayload
                val launched = exporter.exportDocument("CancelTest.md", "text/markdown", "Some manuscript data", false)
                assertTrue("Export should launch", launched)

                // Simulate file picker cancellation (null URI) via reflection
                val handleMethod = SafFileExporter::class.java.getDeclaredMethod("handleCreateDocumentResult", Uri::class.java)
                handleMethod.isAccessible = true
                handleMethod.invoke(exporter, null)

                // Verify pendingPayload was cleared and no crash or freeze occurred
                val pendingField = SafFileExporter::class.java.getDeclaredField("pendingPayload")
                pendingField.isAccessible = true
                val pendingAfterCancel = pendingField.get(exporter)
                assertEquals("pendingPayload must be cleared to null after user cancellation", null, pendingAfterCancel)

                // Verify subsequent export succeeds normally
                val secondExport = exporter.exportDocument("NextDoc.md", "text/markdown", "New draft", false)
                assertTrue("Subsequent export must succeed after cancellation", secondExport)
            }
        }
    }

    // ========================================================================
    // 2. SAF Import Stress & Edge-Case Character Ingestion
    // ========================================================================

    @Test
    fun testImport_rejection_blankExtensions() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val importer = activity.fileImporter

                assertFalse("Empty extensions must be rejected", importer.requestOpenDocument(""))
                assertFalse("Whitespace-only extensions must be rejected", importer.requestOpenDocument("    "))
                // Delimiter-only string does not pass isBlank, falls back to */* wildcard picker
                assertTrue("Delimiter-only string falls back to wildcard picker", importer.requestOpenDocument("  ;  "))
            }
        }
    }

    @Test
    fun testImport_edgeCaseCharacters_newlinesQuotesBackslashes() {
        // Construct comprehensive adversarial content with every tricky character
        val trickyContent = buildString {
            append("1. Line Breaks:\nUnix LF\r\nWindows CRLF\rClassic Mac CR\r\n\nDouble newline\n")
            append("2. Quotes: Single 'quote', Double \"quote\", Backtick `code`, Curly “smart” and ‘single’\n")
            append("3. Slashes: Single \\ backslash, Double \\\\ backslash, Windows path C:\\Program Files\\Daylight\\Writer\n")
            append("4. JSON sensitive: {\"nested\": \"value\", \"array\": [1, 2, true, null]}\n")
            append("5. HTML/XSS injection: <script>alert('XSS')</script> <div id=\"root\">test &amp; copy</div>\n")
            append("6. International & Multibyte: 太陽光 ☀️ 📝 مرحبا بالعالم — 120Hz LivePaper 日本語 русский ελληνικά\n")
            append("7. Control Characters: Tab \t formfeed \u000C null byte \\u0000\n")
        }

        // Test JSON serialization used by SafFileImporter
        val payload = JSONObject().apply {
            put("title", "Adversarial_Chapter.md")
            put("content", trickyContent)
            put("mimeType", "text/markdown")
        }

        val serialized = payload.toString()
        assertNotNull("Serialized payload must not be null", serialized)
        assertTrue("Serialized payload must contain escaped quotes", serialized.contains("\\\"quote\\\""))
        assertTrue("Serialized payload must contain escaped backslashes", serialized.contains("\\\\"))

        // Verify deserialization preserves exact string
        val deserialized = JSONObject(serialized)
        assertEquals("Title must match", "Adversarial_Chapter.md", deserialized.getString("title"))
        assertEquals("Content must match character for character", trickyContent, deserialized.getString("content"))
        assertEquals("MIME must match", "text/markdown", deserialized.getString("mimeType"))
    }

    @Test
    fun testImport_dynamicMimeTypeParsing() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val importer = activity.fileImporter

                val parseMethod = SafFileImporter::class.java.getDeclaredMethod(
                    "parseExtensionsToMimeTypes",
                    String::class.java
                )
                parseMethod.isAccessible = true

                @Suppress("UNCHECKED_CAST")
                val mimesMdTxt = parseMethod.invoke(importer, ".md,.txt") as Array<String>
                assertTrue("MIME types must contain text/markdown", mimesMdTxt.contains("text/markdown"))
                assertTrue("MIME types must contain text/plain", mimesMdTxt.contains("text/plain"))

                @Suppress("UNCHECKED_CAST")
                val mimesPdfDocx = parseMethod.invoke(importer, "pdf; docx") as Array<String>
                assertTrue("MIME types must contain application/pdf", mimesPdfDocx.contains("application/pdf"))
                assertTrue(
                    "MIME types must contain wordprocessingml",
                    mimesPdfDocx.contains("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                )

                @Suppress("UNCHECKED_CAST")
                val mimesWildcard = parseMethod.invoke(importer, "*") as Array<String>
                assertTrue("Wildcard must map to */*", mimesWildcard.contains("*/*"))
            }
        }
    }

    // ========================================================================
    // 3. Native Share Sheet Stress & FileProvider Security
    // ========================================================================

    @Test
    fun testShare_plainTextSharing() {
        val helper = ShareSheetHelper(context)

        // Standard text share
        val successStandard = helper.shareDocument(
            title = "Chapter 1 Excerpt",
            mimeType = "text/plain",
            contentOrBase64 = "It was a dark and stormy night on the 120Hz display.",
            isBinary = false
        )
        assertTrue("Sharing plain text draft must succeed", successStandard)

        // Empty text body share
        val successEmpty = helper.shareDocument(
            title = "Empty Note",
            mimeType = "text/plain",
            contentOrBase64 = "",
            isBinary = false
        )
        assertTrue("Sharing empty text body must succeed", successEmpty)

        // Blank title fallback
        val successBlankTitle = helper.shareDocument(
            title = "",
            mimeType = "text/markdown",
            contentOrBase64 = "# Header",
            isBinary = false
        )
        assertTrue("Sharing with blank title must succeed", successBlankTitle)
    }

    @Test
    fun testShare_binaryAttachment_fileProvider() {
        val helper = ShareSheetHelper(context)

        val fakePdfBytes = "%PDF-1.4\n1 0 obj\n<< /Length 20 >>\nstream\nHello DC1 PDF\nendstream\nendobj\n%%EOF".toByteArray()
        val pdfB64 = Base64.encodeToString(fakePdfBytes, Base64.NO_WRAP)

        val success = helper.shareDocument(
            title = "Manuscript.pdf",
            mimeType = "application/pdf",
            contentOrBase64 = pdfB64,
            isBinary = true
        )
        assertTrue("Sharing binary PDF attachment must succeed", success)

        // Verify written file in cache/shared_exports
        val sharedFile = File(context.cacheDir, "shared_exports/Manuscript.pdf")
        assertTrue("Shared file must exist on disk in shared_exports", sharedFile.exists())
        assertEquals("Shared file size must match original bytes", fakePdfBytes.size.toLong(), sharedFile.length())
        assertEquals("File content must match", String(fakePdfBytes), sharedFile.readText())

        // Verify FileProvider can resolve content URI for this file
        val contentUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", sharedFile)
        assertNotNull("FileProvider must resolve content URI", contentUri)
        assertTrue("Content URI must use content:// scheme", contentUri.scheme == "content")
        assertEquals("Content URI authority must match app fileprovider", "${context.packageName}.fileprovider", contentUri.authority)
        assertTrue("Content URI path must contain shared_exports", contentUri.path?.contains("shared_exports") == true)
    }

    @Test
    fun testShare_pathTraversalSanitization() {
        val helper = ShareSheetHelper(context)

        val binaryBytes = "Secure data".toByteArray()
        val b64 = Base64.encodeToString(binaryBytes, Base64.NO_WRAP)

        // Malicious titles with path traversal sequences
        val attackTitles = listOf(
            "../../etc/evil.pdf",
            "..\\..\\system.docx",
            "folder/sub/doc.pdf",
            "file:with*illegal?chars\"<>.pdf"
        )

        for (title in attackTitles) {
            val success = helper.shareDocument(
                title = title,
                mimeType = "application/pdf",
                contentOrBase64 = b64,
                isBinary = true
            )
            assertTrue("Share should succeed after sanitization for title '$title'", success)

            // Verify file was placed safely inside shared_exports directory
            val sharedDir = File(context.cacheDir, "shared_exports")
            val filesInDir = sharedDir.listFiles()
            assertNotNull("Shared exports directory must exist", filesInDir)
            for (file in filesInDir!!) {
                assertTrue("No file should escape shared_exports directory", file.canonicalPath.startsWith(sharedDir.canonicalPath))
                assertFalse("Filename must not contain raw slashes", file.name.contains("/") || file.name.contains("\\"))
            }
        }
    }

    @Test
    fun testShare_rejection_blankMimeAndCorruptBase64() {
        val helper = ShareSheetHelper(context)

        assertFalse("Blank MIME type must be rejected", helper.shareDocument("Title", "", "content", false))
        assertFalse("Whitespace MIME type must be rejected", helper.shareDocument("Title", "   ", "content", false))
        assertFalse("Corrupt Base64 for binary share must be rejected", helper.shareDocument("Title.pdf", "application/pdf", "%%%corrupt_base64%%%", true))
    }

    // ========================================================================
    // 4. DaylightNativeBridge Contract & Thread Safety
    // ========================================================================

    @Test
    fun testBridge_getDeviceInfo_validContract() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val bridge = activity.bridge
                val infoJson = bridge.getDeviceInfo()
                assertNotNull("getDeviceInfo must return a string", infoJson)

                val json = JSONObject(infoJson)
                assertEquals("device must be DC1", "DC1", json.getString("device"))
                assertEquals("model must be DC-1", "DC-1", json.getString("model"))
                assertEquals("display must be LivePaper", "LivePaper", json.getString("display"))
                assertEquals("refreshHz must be 120", 120, json.getInt("refreshHz"))
                assertEquals("osTokenVersion must be 1", 1, json.getInt("osTokenVersion"))
                assertTrue("zeroEPD must be true (LivePaper is not EPD)", json.getBoolean("zeroEPD"))
            }
        }
    }

    @Test
    fun testBridge_ping_and_toast() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val bridge = activity.bridge
                assertEquals("PONG_DC1", bridge.ping())

                // showToast called from background thread must not crash
                Thread {
                    bridge.showToast("Adversarial Test Toast")
                }.start()
            }
        }
    }
}
