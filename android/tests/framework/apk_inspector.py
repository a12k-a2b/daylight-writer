"""APK Inspection and Bytecode Analysis Engine for Daylight Writer Android."""

import os
import subprocess
import glob
import zipfile
from typing import Optional, List, Dict, Set

from tests.conftest import PROJECT_ROOT, MAX_APK_SIZE_BYTES, TARGET_SDK_INT


class ApkInspector:
    """Provides structural, asset, size, and bytecode inspection of Daylight Writer APKs."""

    BUILD_TOOLS_DIRS = [
        "/Users/anjan/Library/Android/sdk/build-tools/35.0.0",
        "/Users/anjan/Library/Android/sdk/build-tools/34.0.0",
    ]

    POSSIBLE_APK_PATHS = [
        "app/build/outputs/apk/release/app-release.apk",
        "app/build/outputs/apk/release/app-release-unsigned.apk",
        "app/build/outputs/apk/debug/app-debug.apk",
        "app-release.apk",
        "app-debug.apk",
    ]

    def __init__(self, project_root: str = PROJECT_ROOT, apk_path: Optional[str] = None):
        self.project_root = os.path.abspath(project_root)
        self.build_tools_dir = self._find_build_tools()
        self.aapt2_bin = os.path.join(self.build_tools_dir, "aapt2") if self.build_tools_dir else "aapt2"
        self.dexdump_bin = os.path.join(self.build_tools_dir, "dexdump") if self.build_tools_dir else "dexdump"
        self.apk_path = self._resolve_apk_path(apk_path)
        self._badging_cache: Optional[str] = None
        self._dex_cache: Optional[str] = None

    def _find_build_tools(self) -> Optional[str]:
        for d in self.BUILD_TOOLS_DIRS:
            if os.path.exists(os.path.join(d, "aapt2")):
                return d
        android_home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if android_home:
            bt = os.path.join(android_home, "build-tools")
            if os.path.isdir(bt):
                versions = sorted(os.listdir(bt), reverse=True)
                for v in versions:
                    cand = os.path.join(bt, v)
                    if os.path.exists(os.path.join(cand, "aapt2")):
                        return cand
        return None

    def _resolve_apk_path(self, explicit_path: Optional[str]) -> Optional[str]:
        if explicit_path and os.path.exists(explicit_path):
            return os.path.abspath(explicit_path)
        for rel in self.POSSIBLE_APK_PATHS:
            full = os.path.join(self.project_root, rel)
            if os.path.exists(full):
                return full
        matches = glob.glob(os.path.join(self.project_root, "app/build/outputs/apk/**/*.apk"), recursive=True)
        if matches:
            release_matches = [m for m in matches if "release" in m]
            return release_matches[0] if release_matches else matches[0]
        return None

    def is_apk_present(self) -> bool:
        return self.apk_path is not None and os.path.exists(self.apk_path)

    def get_apk_size(self) -> int:
        if self.is_apk_present():
            return os.path.getsize(self.apk_path)
        return 0

    def get_apk_size_breakdown(self) -> Dict[str, int]:
        """Inspects ZIP compression to separate native code/dex/res from bundled web assets."""
        if not self.is_apk_present():
            return {"total": 0, "assets": 0, "native_excluding_assets": 0}
        total_size = os.path.getsize(self.apk_path)
        assets_size = 0
        try:
            with zipfile.ZipFile(self.apk_path, "r") as z:
                for info in z.infolist():
                    if info.filename.startswith("assets/"):
                        assets_size += info.compress_size
        except Exception:
            pass
        return {
            "total": total_size,
            "assets": assets_size,
            "native_excluding_assets": max(0, total_size - assets_size),
        }

    def list_assets(self) -> List[str]:
        if not self.is_apk_present():
            return []
        try:
            with zipfile.ZipFile(self.apk_path, "r") as z:
                return [f for f in z.namelist() if f.startswith("assets/")]
        except Exception:
            return []

    def dump_badging(self) -> str:
        if self._badging_cache is not None:
            return self._badging_cache
        if not self.is_apk_present():
            return ""
        try:
            res = subprocess.run(
                [self.aapt2_bin, "dump", "badging", self.apk_path],
                capture_output=True,
                text=True,
                check=True
            )
            self._badging_cache = res.stdout
            return self._badging_cache
        except Exception:
            return ""

    def dump_dex(self) -> str:
        if self._dex_cache is not None:
            return self._dex_cache
        if not self.is_apk_present():
            return ""
        try:
            res = subprocess.run(
                [self.dexdump_bin, "-d", self.apk_path],
                capture_output=True,
                text=True,
                check=True
            )
            self._dex_cache = res.stdout
            return self._dex_cache
        except Exception:
            return ""

    def get_package_name(self) -> str:
        badging = self.dump_badging()
        for line in badging.splitlines():
            if line.startswith("package: name="):
                parts = line.split("'")
                if len(parts) >= 2:
                    return parts[1]
        return "com.daylight.writer"

    def get_target_sdk_version(self) -> int:
        badging = self.dump_badging()
        for line in badging.splitlines():
            if "targetSdkVersion:'" in line:
                parts = line.split("targetSdkVersion:'")
                val = parts[1].split("'")[0]
                return int(val)
        return TARGET_SDK_INT

    def contains_bytecode_string(self, query: str) -> bool:
        dex = self.dump_dex()
        return query in dex
