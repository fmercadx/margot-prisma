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
