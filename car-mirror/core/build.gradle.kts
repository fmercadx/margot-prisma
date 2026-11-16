import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    // X25519, ChaCha20-Poly1305 and HKDF for pairing and the encrypted session (see Crypto).
    // Android has no X25519 before API 31, and this app runs on 29, so the platform's own
    // providers can't be relied on; BouncyCastle's lightweight API is the same everywhere.
    implementation("org.bouncycastle:bcprov-jdk18on:1.86")

    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.11.3")
}

tasks.test {
    useJUnitPlatform()
}

// Serves a moving test pattern through the real server, for checking the viewer page in a
// desktop browser:  ./gradlew -PcoreOnly :core:demoServer --args="8080"
tasks.register<JavaExec>("demoServer") {
    group = "verification"
    description = "Serves a synthetic phone screen to the viewer page."
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("io.github.fmercadx.carmirror.core.DemoServerKt")
}
