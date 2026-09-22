plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.daylight.writer"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.daylight.writer"
        minSdk = 33
        targetSdk = 33
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    androidResources {
        noCompress += listOf("wasm")
    }

    signingConfigs {
        create("release") {
            storeFile = file("${System.getProperty("user.home")}/.android/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = false
        buildConfig = true
    }
    packaging {
        resources {
            excludes += listOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE*",
                "/META-INF/NOTICE*",
                "DebugProbesKt.bin"
            )
        }
    }
}

tasks.matching { it.name.contains("AarMetadata") }.configureEach {
    enabled = false
}

dependencies {
    // Core AndroidX
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.activity:activity-ktx:1.8.2")

    // AndroidX WebKit for WebViewAssetLoader & modern Chromium integration
    implementation("androidx.webkit:webkit:1.12.1")

    // AndroidX WorkManager for background sync
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    // Unit Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlin:kotlin-test")

    // Instrumented Testing
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}

// ---------------------------------------------------------------------------
// Production Web Assets Packaging Pipeline
// ---------------------------------------------------------------------------
val webProjectDir = rootProject.file("../daylight_writer")
val webDistDir = rootProject.file("../daylight_writer/dist")
val targetAssetsDir = layout.projectDirectory.dir("src/main/assets")

val buildWebAssets = tasks.register<Exec>("buildWebAssets") {
    group = "daylight"
    description = "Compiles Daylight Writer web bundle via npm run build if dist/ is missing"
    workingDir = webProjectDir
    commandLine("npm", "run", "build")
    onlyIf {
        !webDistDir.resolve("index.html").exists()
    }
}

val syncWebAssets = tasks.register<Sync>("syncWebAssets") {
    group = "daylight"
    description = "Syncs production web distribution from daylight_writer/dist into app/src/main/assets/"
    dependsOn(buildWebAssets)

    from(webDistDir)
    into(targetAssetsDir)

    doFirst {
        if (!webDistDir.resolve("index.html").exists()) {
            throw GradleException(
                "Web distribution bundle missing at ${webDistDir.absolutePath}. " +
                "Run 'npm run build' inside ${webProjectDir.absolutePath} first."
            )
        }
    }
}

// Ensure web assets are synced before compiling assets into APK
tasks.named("preBuild").configure {
    dependsOn(syncWebAssets)
}
