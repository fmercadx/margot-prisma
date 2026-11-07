import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// CI passes its run number so every build installs over the previous one.
val buildNumber = (findProperty("buildNumber") as String?)?.toIntOrNull() ?: 1

// -PplayUpload signs with the private Google Play upload key instead of the shared one.
// CI passes it, with the key's path and password in the environment, only when the repo
// secrets exist. See README "Selling on Google Play".
val playUpload = project.hasProperty("playUpload")

android {
    namespace = "io.github.fmercadx.carmirror"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.fmercadx.carmirror"
        minSdk = 29
        targetSdk = 36
        versionCode = buildNumber
        versionName = "0.1.$buildNumber"
    }

    signingConfigs {
        // A fixed key checked into the repo, so a new build installs over the old one
        // instead of Android refusing it as a different app. See README "Signing".
        create("shared") {
            storeFile = file("signing.keystore")
            storePassword = "carmirror"
            keyAlias = "carmirror"
            keyPassword = "carmirror"
        }
        if (playUpload) {
            create("upload") {
                val path = System.getenv("CAR_MIRROR_UPLOAD_KEYSTORE")
                    ?: error("-PplayUpload needs CAR_MIRROR_UPLOAD_KEYSTORE (path to the upload keystore)")
                val password = System.getenv("CAR_MIRROR_UPLOAD_PASSWORD")
                    ?: error("-PplayUpload needs CAR_MIRROR_UPLOAD_PASSWORD")
                storeFile = file(path)
                storePassword = password
                keyAlias = "upload"
                keyPassword = password
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (playUpload) "upload" else "shared")
        }
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))
}
