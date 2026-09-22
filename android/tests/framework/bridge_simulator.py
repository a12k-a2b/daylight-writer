"""Daylight Bridge Simulator modeling bidirectional Kotlin <-> JavaScript Bridge Contracts."""

import base64
import json
import time
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Callable

from tests.conftest import KEYCODE_ACTION_BUTTON, KEYCODE_ESCAPE, WAKELOCK_TIMEOUT_MS


@dataclass
class NativeExportPayload:
    filename: str
    mime_type: str
    raw_data: bytes
    is_binary: bool
    destination_uri: Optional[str] = None
    bytes_written: int = 0
    completed: bool = False


@dataclass
class NativeSharePayload:
    title: str
    mime_type: str
    text_content: Optional[str]
    binary_data: Optional[bytes]
    is_binary: bool
    content_uri: Optional[str] = None
    flags: int = 0


@dataclass
class FolioWakeLockState:
    is_held: bool = False
    acquired_at_ms: float = 0.0
    timeout_ms: int = WAKELOCK_TIMEOUT_MS
    tag: str = "DaylightWriter:EmergencyFlush"


class DaylightBridgeSimulator:
    """Accurately models the native Android Kotlin bridge and web reverse dispatcher."""

    def __init__(self):
        # Native Web->Native Bridge State
        self.exports: List[NativeExportPayload] = []
        self.shares: List[NativeSharePayload] = []
        self.open_requests: List[str] = []
        self.toast_messages: List[str] = []
        self.flush_completion_history: List[Dict[str, Any]] = []
        self.sync_queue_updates: List[int] = []

        # WakeLock State (Folio Sensor Emergency Save Point)
        self.wakelock = FolioWakeLockState()

        # Reverse Dispatcher (Native -> Web) Handlers
        self.web_imported_documents: List[Dict[str, Any]] = []
        self.web_focus_mode_cycles: int = 0
        self.web_split_at_cursor_calls: int = 0
        self.web_dismiss_drawers_calls: int = 0
        self.web_keyboard_actions: List[str] = []
        self.web_sync_triggers: int = 0

        # Sync Queue Mirror (WorkManager)
        self.native_sync_queue: List[Dict[str, Any]] = []

    # =========================================================================
    # 1. Web -> Native Bridge Implementation (@JavascriptInterface)
    # =========================================================================

    def exportDocument(self, filename: str, mime_type: str, base64_data: str, is_binary: bool) -> bool:
        """Simulates native SAF Intent.ACTION_CREATE_DOCUMENT handling."""
        if not filename or not filename.strip() or not mime_type or not mime_type.strip():
            return False

        try:
            if is_binary:
                raw_bytes = base64.b64decode(base64_data, validate=True)
            else:
                raw_bytes = base64_data.encode("utf-8")
        except Exception:
            return False

        dest_uri = f"content://com.android.externalstorage.documents/document/primary%3A{filename}"
        payload = NativeExportPayload(
            filename=filename,
            mime_type=mime_type,
            raw_data=raw_bytes,
            is_binary=is_binary,
            destination_uri=dest_uri,
            bytes_written=len(raw_bytes),
            completed=True,
        )
        self.exports.append(payload)
        return True

    def requestOpenDocument(self, supported_extensions: str) -> bool:
        """Simulates native SAF Intent.ACTION_OPEN_DOCUMENT."""
        if not supported_extensions or not supported_extensions.strip():
            return False
        self.open_requests.append(supported_extensions.strip())
        return True

    def shareDocument(self, title: str, mime_type: str, content_or_base64: str, is_binary: bool) -> bool:
        """Simulates native share sheet via Intent.ACTION_SEND and FileProvider."""
        if not mime_type or not mime_type.strip():
            return False

        content_uri = None
        text_content = None
        binary_bytes = None

        if is_binary:
            try:
                binary_bytes = base64.b64decode(content_or_base64, validate=True)
                content_uri = f"content://com.daylight.writer.fileprovider/shared_exports/{title or 'manuscript'}"
            except Exception:
                return False
        else:
            text_content = content_or_base64

        FLAG_GRANT_READ_URI_PERMISSION = 0x00000001
        self.shares.append(NativeSharePayload(
            title=title,
            mime_type=mime_type,
            text_content=text_content,
            binary_data=binary_bytes,
            is_binary=is_binary,
            content_uri=content_uri,
            flags=FLAG_GRANT_READ_URI_PERMISSION if is_binary else 0,
        ))
        return True

    def onFlushCompleted(self, success: bool, dirty_remaining: int):
        """Simulates callback when web SQLite WAL flush finishes."""
        self.flush_completion_history.append({"success": success, "dirty_remaining": dirty_remaining, "time": time.time()})
        if self.wakelock.is_held:
            self.wakelock.is_held = False

    def onSyncQueueUpdated(self, pending_count: int):
        """Notifies native WorkManager that new mutations are ready."""
        self.sync_queue_updates.append(pending_count)

    def getDeviceInfo(self) -> str:
        return json.dumps({
            "device": "DC1",
            "model": "DC-1",
            "display": "LivePaper",
            "refreshHz": 120,
            "osTokenVersion": 1,
            "zeroEPD": True,
        })

    def showToast(self, message: str):
        self.toast_messages.append(message)

    # =========================================================================
    # 2. Native -> Web Reverse Dispatcher Simulator
    # =========================================================================

    def simulate_action_button_press(self, action: str = "toggle_focus_mode"):
        """Invoked when KEYCODE_F12 (142) is intercepted in dispatchKeyEvent."""
        if action == "toggle_focus_mode":
            self.web_focus_mode_cycles += 1
        elif action == "split_at_cursor":
            self.web_split_at_cursor_calls += 1

    def simulate_escape_key_press(self) -> bool:
        """Invoked when KEYCODE_ESCAPE (111) is intercepted in dispatchKeyEvent."""
        self.web_dismiss_drawers_calls += 1
        self.web_keyboard_actions.append("dismiss_drawers")
        # Native dispatchKeyEvent returns true to prevent system back exit
        return True

    def simulate_dispatch_key_event(self, key_code: int, action: int = 0) -> bool:
        """Simulates MainActivity.dispatchKeyEvent logic."""
        ACTION_DOWN = 0
        if action == ACTION_DOWN:
            if key_code == KEYCODE_ACTION_BUTTON:
                self.simulate_action_button_press("toggle_focus_mode")
                return True
            elif key_code == KEYCODE_ESCAPE:
                return self.simulate_escape_key_press()
        return False

    def simulate_folio_cover_closed(self):
        """Simulates Hall sensor SW_LID triggering ACTION_SCREEN_OFF."""
        # 1. Acquire Partial WakeLock with 3000ms safety timeout
        self.wakelock.is_held = True
        self.wakelock.acquired_at_ms = time.time() * 1000

        # 2. Native triggers web emergency flush: window.DaylightBridgeClient.flushPendingEdits()
        # 3. Web commits and calls onFlushCompleted(True, 0)
        self.onFlushCompleted(success=True, dirty_remaining=0)

    def simulate_external_file_opened(self, title: str, content: str, mime_type: str = "text/markdown") -> str:
        """Simulates Intent.ACTION_VIEW or SAF open injecting document into web editor."""
        doc_id = f"doc_{int(time.time()*1000)}_{len(self.web_imported_documents)}"
        self.web_imported_documents.append({
            "id": doc_id,
            "title": title,
            "content": content,
            "mime_type": mime_type,
        })
        return doc_id

    def simulate_workmanager_sync_run(self) -> Dict[str, int]:
        """Simulates DaylightSyncWorker executing periodic background sync."""
        self.web_sync_triggers += 1
        pushed = len(self.native_sync_queue)
        self.native_sync_queue.clear()
        return {"pushed": pushed, "pulled": 0}
