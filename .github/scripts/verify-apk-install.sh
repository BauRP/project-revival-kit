#!/usr/bin/env bash
# A single shell process is required for variables and pipefail.
set -euo pipefail
APK="${TRIVO_APK_PATH:?Missing APK path}"
test -f "$APK"
[[ "$APK" == *.apk ]]
test -n "${TRIVO_VERSION_CODE:?Missing build version}"

adb install "$APK"
adb shell pm path com.baurp.trivochat | grep -F "base.apk"

# Data-survival proof across an in-place reinstall of the same signed APK.
# Absolute app-private path: run-as may not use the app-data directory
# as its working directory on Android 15.
APP_FILES="/data/data/com.baurp.trivochat/files"
adb shell run-as com.baurp.trivochat mkdir -p "$APP_FILES"
adb shell run-as com.baurp.trivochat touch "$APP_FILES/trivo-ci-upgrade-test"
adb shell run-as com.baurp.trivochat ls "$APP_FILES/trivo-ci-upgrade-test" | grep -F trivo-ci-upgrade-test
adb install -r "$APK"
adb shell run-as com.baurp.trivochat ls "$APP_FILES/trivo-ci-upgrade-test" | grep -F trivo-ci-upgrade-test
adb shell dumpsys package com.baurp.trivochat | grep -m1 "versionCode=${TRIVO_VERSION_CODE:?Missing build version}"
echo "Verified Android emulator APK install/reinstall and private data retention."
