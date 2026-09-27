package com.daylight.writer.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DaylightWebViewClientTest {

    @Test
    fun testIsGoogleDocsOrDriveUrl_googleDocsUrls() {
        assertTrue(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://docs.google.com/document/d/gdoc-123/edit")
        )
        assertTrue(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://docs.google.com/document/u/0/d/abc/edit?usp=sharing")
        )
        assertTrue(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("http://docs.google.com/spreadsheets/d/123")
        )
    }

    @Test
    fun testIsGoogleDocsOrDriveUrl_googleDriveUrls() {
        assertTrue(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://drive.google.com/drive/folders/folder-abc-123")
        )
        assertTrue(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://drive.google.com/file/d/file-xyz/view")
        )
    }

    @Test
    fun testIsGoogleDocsOrDriveUrl_googleAccountsUrls() {
        assertTrue(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=123")
        )
        assertTrue(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://accounts.google.com/signin/v2/identifier")
        )
    }

    @Test
    fun testIsGoogleDocsOrDriveUrl_internalAssets_returnsFalse() {
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://appassets.androidplatform.net/index.html")
        )
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://appassets.androidplatform.net/assets/main.css")
        )
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("http://localhost:8080/")
        )
    }

    @Test
    fun testIsGoogleDocsOrDriveUrl_internalAssetsWithGoogleQueryParam_returnsFalse() {
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl(
                "https://appassets.androidplatform.net/index.html?q=docs.google.com"
            )
        )
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl(
                "https://appassets.androidplatform.net/search?target=drive.google.com&auth=accounts.google.com"
            )
        )
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl(
                "https://appassets.androidplatform.net/index.html#docs.google.com"
            )
        )
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl(
                "https://attacker.com/phish?target=docs.google.com"
            )
        )
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl(
                "https://not-google.com/docs.google.com"
            )
        )
    }

    @Test
    fun testIsGoogleDocsOrDriveUrl_unrelatedExternalUrls_returnsFalse() {
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://example.com/some/article")
        )
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://github.com/daylight-computer")
        )
        assertFalse(
            DaylightWebViewClient.isGoogleDocsOrDriveUrl("https://daylightcomputer.com/")
        )
    }

    @Test
    fun testExternalUrlHandler_interceptsMatchingUrls() {
        val interceptedUrls = mutableListOf<String>()
        val url = "https://docs.google.com/document/d/doc-1/edit"
        val shouldIntercept = DaylightWebViewClient.isGoogleDocsOrDriveUrl(url)
        assertTrue(shouldIntercept)

        if (shouldIntercept) {
            interceptedUrls.add(url)
        }

        assertEquals(1, interceptedUrls.size)
        assertEquals("https://docs.google.com/document/d/doc-1/edit", interceptedUrls[0])
    }
}
