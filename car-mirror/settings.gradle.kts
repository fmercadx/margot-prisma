rootProject.name = "car-mirror"

// -PcoreOnly builds just the streaming core, which needs only a JDK: no Android SDK and no
// Google Maven repository. CI builds everything.
val coreOnly = providers.gradleProperty("coreOnly").isPresent

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        if (!coreOnly) google()
    }
}

include(":core")
if (!coreOnly) include(":app")
