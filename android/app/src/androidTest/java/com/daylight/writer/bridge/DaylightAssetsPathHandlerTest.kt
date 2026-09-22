package com.daylight.writer.bridge

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebViewAssetLoader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DaylightAssetsPathHandlerTest {

    private lateinit var pathHandler: DaylightAssetsPathHandler
    private lateinit var assetLoader: WebViewAssetLoader

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        pathHandler = DaylightAssetsPathHandler(context)
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", pathHandler)
            .addPathHandler("/", pathHandler)
            .build()
    }

    // ------------------------------------------------------------------------
    // 1. Directory Traversal Adversarial Challenges
    // ------------------------------------------------------------------------

    @Test
    fun testDirectTraversal_dotDotSlash() {
        val response = pathHandler.handle("../..")
        assertNotNull("Response must not be null for blocked traversal", response)
        assertEquals(403, response!!.statusCode)
        assertEquals("Forbidden", response.reasonPhrase)
    }

    @Test
    fun testDirectTraversal_backslash() {
        val response = pathHandler.handle("\\..")
        assertNotNull("Response must not be null for backslash traversal", response)
        assertEquals(403, response!!.statusCode)
        assertEquals("Forbidden", response.reasonPhrase)
    }

    @Test
    fun testDirectTraversal_assetsDotDot() {
        val response = pathHandler.handle("/assets/../../AndroidManifest.xml")
        assertNotNull("Response must not be null for /assets/../../ traversal", response)
        assertEquals(403, response!!.statusCode)
        assertEquals("Forbidden", response.reasonPhrase)
    }

    @Test
    fun testDirectTraversal_comprehensiveAttacks() {
        val attacks = listOf(
            "assets/../../../etc/hosts",
            "..\\..\\windows\\system32",
            "assets/..",
            "../assets/index.html",
            "....//....//etc/passwd",
            "assets/wa-sqlite-async-zc68fxQq.wasm/../../AndroidManifest.xml",
            "..",
            "../",
            "/..",
            "/../..",
            "assets/..\\..",
            "\\\\shared\\network",
            "foo/bar/../../../../../../data/data/com.daylight.writer/databases"
        )
        for (attack in attacks) {
            val response = pathHandler.handle(attack)
            assertNotNull("Attack '$attack' must return a 403 response", response)
            assertEquals("Attack '$attack' status must be 403", 403, response!!.statusCode)
            assertEquals("Forbidden", response.reasonPhrase)
        }
    }

    // ------------------------------------------------------------------------
    // 2. Malformed or Nonexistent URIs (Clean 404 / no crash)
    // ------------------------------------------------------------------------

    @Test
    fun testNonexistentAsset_directHandler() {
        val nonexistentPaths = listOf(
            "does_not_exist_xyz_12345.js",
            "assets/missing_file.wasm",
            "subfolder/nonexistent.png",
            "random_binary.bin",
            "invalid?query=true"
        )
        for (path in nonexistentPaths) {
            val response = pathHandler.handle(path)
            // Handler returns null when asset not found in AssetManager (clean delegation to WebView)
            assertNull("Nonexistent asset '$path' must return null for clean delegation without crashing", response)
        }
    }

    @Test
    fun testMalformedUri_assetLoader() {
        val malformedUris = listOf(
            "https://appassets.androidplatform.net/assets/non_existent_file.xyz",
            "https://appassets.androidplatform.net/non_existent.html",
            "https://appassets.androidplatform.net/assets/%20%20",
            "https://appassets.androidplatform.net/assets/index.html?query=param#fragment",
            "https://appassets.androidplatform.net/",
            "https://appassets.androidplatform.net/assets/",
            "https://appassets.androidplatform.net/assets/wa-sqlite-async-zc68fxQq.wasm?v=1.0.0",
            "https://appassets.androidplatform.net///triple//slash",
            "https://appassets.androidplatform.net/assets/!@#$%^&*()",
            "https://evil.com/assets/index.html"
        )
        for (uriStr in malformedUris) {
            val uri = Uri.parse(uriStr)
            try {
                val response = assetLoader.shouldInterceptRequest(uri)
                // If it resolves or returns null, it must NOT throw an unhandled exception
            } catch (t: Throwable) {
                throw AssertionError("Asset loader crashed on URI: $uriStr", t)
            }
        }
    }

    @Test
    fun testEmptyAndBlankPaths() {
        // Empty path should resolve default index.html
        val emptyResp = pathHandler.handle("")
        assertNotNull("Empty path should resolve to index.html", emptyResp)
        assertEquals("text/html", emptyResp!!.mimeType)

        val slashResp = pathHandler.handle("/")
        assertNotNull("Slash path should resolve to index.html", slashResp)
        assertEquals("text/html", slashResp!!.mimeType)
    }

    // ------------------------------------------------------------------------
    // 3. MIME Type Header Correctness
    // ------------------------------------------------------------------------

    @Test
    fun testMimeType_wasm() {
        val response = pathHandler.handle("assets/wa-sqlite-async-zc68fxQq.wasm")
        assertNotNull("wa-sqlite-async wasm asset must be resolved", response)
        assertEquals("application/wasm", response!!.mimeType)
        assertNull("Binary WASM must have null encoding", response.encoding)
    }

    @Test
    fun testMimeType_webmanifest() {
        val response = pathHandler.handle("manifest.webmanifest")
        assertNotNull("manifest.webmanifest must be resolved", response)
        assertEquals("application/manifest+json", response!!.mimeType)
        assertEquals("UTF-8", response.encoding)
    }

    @Test
    fun testMimeType_javascript() {
        val response = pathHandler.handle("assets/index-CycQVS2x.js")
        assertNotNull("index.js asset must be resolved", response)
        assertEquals("text/javascript", response!!.mimeType)
        assertEquals("UTF-8", response.encoding)
    }

    @Test
    fun testMimeType_htmlAndCss() {
        val htmlResp = pathHandler.handle("index.html")
        assertNotNull("index.html must be resolved", htmlResp)
        assertEquals("text/html", htmlResp!!.mimeType)
        assertEquals("UTF-8", htmlResp.encoding)

        val cssResp = pathHandler.handle("assets/index-11mUxNd8.css")
        assertNotNull("css asset must be resolved", cssResp)
        assertEquals("text/css", cssResp!!.mimeType)
        assertEquals("UTF-8", cssResp.encoding)
    }

    @Test
    fun testMultiCandidateResolution() {
        // Root candidate resolution
        val rootIndex = pathHandler.handle("index.html")
        assertNotNull("Root 'index.html' must resolve", rootIndex)

        // Nested candidate resolution with 'assets/' prefix
        val nestedIndex = pathHandler.handle("assets/index.html")
        assertNotNull("Prefixed 'assets/index.html' must resolve", nestedIndex)

        // Both should yield text/html
        assertEquals("text/html", rootIndex!!.mimeType)
        assertEquals("text/html", nestedIndex!!.mimeType)
    }

    // ------------------------------------------------------------------------
    // 4. Security Headers (COOP, COEP, CORP, CORS)
    // ------------------------------------------------------------------------

    @Test
    fun testSecurityHeaders_onSuccess() {
        val response = pathHandler.handle("index.html")
        assertNotNull(response)
        val headers = response!!.responseHeaders
        assertNotNull("Response headers must not be null", headers)

        assertEquals("same-origin", headers["Cross-Origin-Opener-Policy"])
        assertEquals("require-corp", headers["Cross-Origin-Embedder-Policy"])
        assertEquals("cross-origin", headers["Cross-Origin-Resource-Policy"])
        assertEquals("*", headers["Access-Control-Allow-Origin"])
        assertEquals("GET, HEAD, OPTIONS", headers["Access-Control-Allow-Methods"])
        assertEquals("*", headers["Access-Control-Allow-Headers"])
        assertEquals("no-cache, no-store, must-revalidate", headers["Cache-Control"])
        assertEquals("no-cache", headers["Pragma"])
        assertEquals("0", headers["Expires"])
    }

    @Test
    fun testSecurityHeaders_onForbidden() {
        val response = pathHandler.handle("../..")
        assertNotNull(response)
        assertEquals(403, response!!.statusCode)
        val headers = response.responseHeaders
        assertNotNull("Forbidden response headers must not be null", headers)

        assertEquals("same-origin", headers["Cross-Origin-Opener-Policy"])
        assertEquals("require-corp", headers["Cross-Origin-Embedder-Policy"])
        assertEquals("cross-origin", headers["Cross-Origin-Resource-Policy"])
        assertEquals("*", headers["Access-Control-Allow-Origin"])
    }

    @Test
    fun testFavicon_gracefulHandling() {
        val response = pathHandler.handle("favicon.ico")
        assertNotNull(response)
        assertEquals(200, response!!.statusCode)
        assertEquals("image/x-icon", response.mimeType)
        val headers = response.responseHeaders
        assertEquals("same-origin", headers["Cross-Origin-Opener-Policy"])
    }
}
