"""Asset Loader Verifier for WebViewAssetLoader and WASM Cross-Origin Isolation."""

import os
import glob
from typing import Dict, Optional, Tuple

from tests.conftest import WEB_DIST_DIR, WEB_ASSETS_DIR


class AssetLoaderVerifier:
    """Verifies that production web assets and custom WebViewAssetLoader rules conform to specifications."""

    EXPECTED_SCHEME = "https"
    EXPECTED_DOMAIN = "appassets.androidplatform.net"
    EXPECTED_ASSET_PREFIX = "/assets/"

    MIME_TYPES = {
        ".wasm": "application/wasm",
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
    }

    REQUIRED_HEADERS = {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Access-Control-Allow-Origin": "*",
    }

    def __init__(self, dist_dir: str = WEB_DIST_DIR):
        self.dist_dir = os.path.abspath(dist_dir)
        self.assets_dir = os.path.join(self.dist_dir, "assets")

    def check_production_bundle_exists(self) -> bool:
        """Verifies dist/index.html and dist/assets/ are present."""
        index_path = os.path.join(self.dist_dir, "index.html")
        return os.path.exists(index_path) and os.path.isdir(self.assets_dir)

    def find_wasm_asset(self) -> Optional[str]:
        """Finds wa-sqlite-async wasm binary in assets directory."""
        matches = glob.glob(os.path.join(self.assets_dir, "*.wasm"))
        return matches[0] if matches else None

    def get_bundle_size_bytes(self) -> int:
        """Calculates total uncompressed size of production web assets."""
        total = 0
        for root, _, files in os.walk(self.dist_dir):
            for f in files:
                total += os.path.getsize(os.path.join(root, f))
        return total

    def resolve_mime_type(self, path: str) -> str:
        """Resolves MIME type with mandatory application/wasm enforcement."""
        ext = os.path.splitext(path)[1].lower()
        return self.MIME_TYPES.get(ext, "application/octet-stream")

    def simulate_intercept_request(self, url: str) -> Tuple[int, str, Dict[str, str], bytes]:
        """Simulates WebViewClient.shouldInterceptRequest resolving an asset."""
        prefix = f"{self.EXPECTED_SCHEME}://{self.EXPECTED_DOMAIN}"
        if not url.startswith(prefix):
            return 404, "text/plain", {}, b"Not Found"

        path_part = url[len(prefix):]
        clean_path = path_part.lstrip("/")

        # Search in dist root, dist/assets, and clean path
        candidates = [
            os.path.join(self.dist_dir, clean_path),
            os.path.join(self.dist_dir, clean_path.replace("assets/", "")),
            os.path.join(self.assets_dir, os.path.basename(clean_path)),
        ]

        found_path = None
        for cand in candidates:
            if os.path.exists(cand) and os.path.isfile(cand):
                found_path = cand
                break

        if not found_path:
            return 404, "text/plain", {}, b"Asset not found in bundle"

        mime = self.resolve_mime_type(found_path)
        headers = dict(self.REQUIRED_HEADERS)

        with open(found_path, "rb") as f:
            data = f.read()

        return 200, mime, headers, data
