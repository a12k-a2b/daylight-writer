# =============================================================================
# Daylight Writer Bespoke Android Shell - Proguard / R8 Optimization Rules
# =============================================================================

# -----------------------------------------------------------------------------
# 1. General Optimization & Shrinking Flags
# -----------------------------------------------------------------------------
-allowaccessmodification
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-verbose

# -----------------------------------------------------------------------------
# 2. JavaScript Interface Bridge (CRITICAL FOR WEB-NATIVE BRIDGE)
# -----------------------------------------------------------------------------
# The Chromium WebView engine reflectively calls methods annotated with
# @JavascriptInterface. R8 must NOT obfuscate, strip, or rename these methods.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep the bridge package classes and interfaces intact
-keep class com.daylight.writer.bridge.** { *; }

# -----------------------------------------------------------------------------
# 3. AndroidX WebKit & WebViewAssetLoader
# -----------------------------------------------------------------------------
-keep class androidx.webkit.** { *; }
-dontwarn androidx.webkit.**

# -----------------------------------------------------------------------------
# 4. WorkManager Background Worker (Reflective Instantiation)
# -----------------------------------------------------------------------------
# androidx.work.impl.WorkerFactory instantiates Workers reflectively via
# constructor (Context context, WorkerParameters workerParams).
-keep public class com.daylight.writer.sync.DaylightSyncWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class androidx.work.** { *; }
-dontwarn androidx.work.**

# -----------------------------------------------------------------------------
# 5. Core Application Components & Receivers
# -----------------------------------------------------------------------------
-keep public class com.daylight.writer.MainActivity {
    public <init>();
}
-keep public class com.daylight.writer.DaylightApplication {
    public <init>();
}
-keep public class com.daylight.writer.hardware.FolioHallSensorReceiver {
    public <init>();
}

# -----------------------------------------------------------------------------
# 6. Kotlin Coroutines & Standard Library
# -----------------------------------------------------------------------------
-keepclassmembernames class kotlinx.coroutines.** {
    volatile <fields>;
}
-dontwarn kotlinx.coroutines.**

# -----------------------------------------------------------------------------
# 7. FileProvider for Native Share Sheet (Milestone 2)
# -----------------------------------------------------------------------------
-keep class androidx.core.content.FileProvider {
    public <init>();
}
