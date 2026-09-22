package com.daylight.writer.bridge

import android.content.Context
import android.util.Log
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.net.URLConnection

/**
 * Custom PathHandler for AndroidX WebViewAssetLoader serving Daylight Writer assets.
 *
 * Key Capabilities:
 * 1. Seamlessly resolves both root assets ("index.html", "manifest.webmanifest") and
 *    nested subfolder assets ("assets/index-*.js", "assets/wa-sqlite-async-*.wasm").
 * 2. Enforces exact MIME types, specifically "application/wasm" for WebAssembly.instantiateStreaming.
 * 3. Injects Cross-Origin Isolation headers (COOP, COEP, CORP, CORS) required for OPFS,
 *    SharedArrayBuffer, and multi-tier SQLite Web Workers.
 * 4. Protects against directory traversal vulnerabilities.
 */
class DaylightAssetsPathHandler(
    private val context: Context
) : WebViewAssetLoader.PathHandler {

    companion object {
        private const val TAG = "DaylightAssetHandler"

        /**
         * Comprehensive MIME type dictionary mapping file extensions to standard MIME strings.
         */
        private val MIME_TYPE_MAP = mapOf(
            "wasm"         to "application/wasm",
            "js"           to "text/javascript",
            "mjs"          to "text/javascript",
            "css"          to "text/css",
            "html"         to "text/html",
            "htm"          to "text/html",
            "json"         to "application/json",
            "webmanifest"  to "application/manifest+json",
            "svg"          to "image/svg+xml",
            "png"          to "image/png",
            "jpg"          to "image/jpeg",
            "jpeg"         to "image/jpeg",
            "webp"         to "image/webp",
            "gif"          to "image/gif",
            "ico"          to "image/x-icon",
            "woff"         to "font/woff",
            "woff2"        to "font/woff2",
            "ttf"          to "font/ttf",
            "otf"          to "font/otf",
            "txt"          to "text/plain",
            "md"           to "text/markdown",
            "xml"          to "application/xml"
        )

        /**
         * MIME types that require UTF-8 text encoding. Binary types use null.
         */
        private val TEXT_MIME_TYPES = setOf(
            "text/html",
            "text/javascript",
            "text/css",
            "text/plain",
            "text/markdown",
            "application/json",
            "application/manifest+json",
            "application/xml",
            "image/svg+xml"
        )

        /**
         * Mandatory security and isolation headers for local HTTPS origin.
         */
        private val SECURITY_HEADERS = mapOf(
            "Cross-Origin-Opener-Policy"   to "same-origin",
            "Cross-Origin-Embedder-Policy" to "require-corp",
            "Cross-Origin-Resource-Policy" to "cross-origin",
            "Access-Control-Allow-Origin"  to "*",
            "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers" to "*",
            "Cache-Control"                to "no-cache, no-store, must-revalidate",
            "Pragma"                       to "no-cache",
            "Expires"                      to "0"
        )
    }

    override fun handle(path: String): WebResourceResponse? {
        // 1. Sanitize and normalize path
        var cleanPath = path.trimStart('/')
        if (cleanPath.isEmpty()) {
            cleanPath = "index.html"
        }

        // Prevent path traversal outside APK assets
        if (cleanPath.contains("..") || cleanPath.contains("\\")) {
            Log.w(TAG, "Blocked path traversal attempt: $path")
            return createErrorResponse(403, "Forbidden", "Access denied")
        }

        // Return empty icon for favicon.ico requests if not present on disk
        if (cleanPath.equals("favicon.ico", ignoreCase = true)) {
            return WebResourceResponse(
                "image/x-icon",
                null,
                200,
                "OK",
                SECURITY_HEADERS,
                ByteArrayInputStream(ByteArray(0))
            )
        }

        // 2. Generate ordered candidates for root vs subfolder resolution
        val candidates = linkedSetOf(
            cleanPath,
            "assets/$cleanPath",
            if (cleanPath.startsWith("assets/")) cleanPath.removePrefix("assets/") else cleanPath
        )

        // 3. Attempt candidate resolution
        for (candidate in candidates) {
            try {
                val inputStream: InputStream = context.assets.open(candidate)
                val mimeType = resolveMimeType(candidate)
                val encoding = if (mimeType in TEXT_MIME_TYPES) "UTF-8" else null

                Log.d(TAG, "Resolved asset: $path -> APK assets/$candidate ($mimeType)")
                return WebResourceResponse(
                    mimeType,
                    encoding,
                    200,
                    "OK",
                    SECURITY_HEADERS,
                    inputStream
                )
            } catch (_: IOException) {
                // Try next candidate
            }
        }

        Log.w(TAG, "Asset not found: $path (tried: ${candidates.joinToString()})")
        return null
    }

    /**
     * Resolve exact MIME type based on file extension.
     */
    private fun resolveMimeType(filePath: String): String {
        val extension = filePath.substringAfterLast('.', "").lowercase()
        return MIME_TYPE_MAP[extension] ?: URLConnection.guessContentTypeFromName(filePath) ?: "application/octet-stream"
    }

    /**
     * Create an HTTP error response with standard security headers.
     */
    private fun createErrorResponse(statusCode: Int, reasonPhrase: String, message: String): WebResourceResponse {
        val bytes = message.toByteArray(Charsets.UTF_8)
        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            statusCode,
            reasonPhrase,
            SECURITY_HEADERS,
            ByteArrayInputStream(bytes)
        )
    }
}
