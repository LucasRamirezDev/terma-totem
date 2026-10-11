$ErrorActionPreference = "Stop"

$jdkPath = "D:\ARCHIVOS 2026\tools\jdk-21.0.12.1+1"
$androidSdkPath = "D:\ARCHIVOS 2026\tools\android-sdk"

$env:JAVA_HOME = $jdkPath
$env:ANDROID_HOME = $androidSdkPath
$env:ANDROID_SDK_ROOT = $androidSdkPath
$env:PATH = "$jdkPath\bin;$androidSdkPath\cmdline-tools\latest\bin;$androidSdkPath\platform-tools;$env:PATH"

Write-Host "Configuring local.properties..."
$localProperties = "sdk.dir=" + ($androidSdkPath -replace '\\', '/')
Set-Content -Path "D:\ARCHIVOS 2026\envero-totem-react\envero-totem\android\local.properties" -Value $localProperties

Write-Host "Compiling Android project with Gradle wrapper using JDK 21..."
Set-Location "D:\ARCHIVOS 2026\envero-totem-react\envero-totem\android"
& ".\gradlew.bat" assembleDebug
