// Plugins are put on the root classpath (rather than declared in each module) so that the
// Android plugin can be left out entirely with -PcoreOnly; see settings.gradle.kts.
buildscript {
    val coreOnly = project.hasProperty("coreOnly")
    repositories {
        mavenCentral()
        if (!coreOnly) google()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.0")
        if (!coreOnly) classpath("com.android.tools.build:gradle:8.7.3")
    }
}
