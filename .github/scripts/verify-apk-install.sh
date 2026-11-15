#!/usr/bin/env bash
# A single shell process is required for variables and pipefail.
set -euo pipefail
APK="${TRIVO_APK_PATH:?Missing APK path}"
test -f "$APK"
[[ "$APK" == *.apk ]]
test -n "${TRIVO_VERSION_CODE:?Missing build version}"
if [[ -n "${TRIVO_EXPECTED_SDK:-}" ]]; then
  ACTUAL_SDK="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  [[ "$ACTUAL_SDK" == "$TRIVO_EXPECTED_SDK" ]] || {
    echo "Wrong Android API level: $ACTUAL_SDK, expected $TRIVO_EXPECTED_SDK"; exit 1;
  }
fi

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
# Also verify the APK can enter its native MainActivity on this API level.
# This is only a startup smoke test, not proof of all WebView/Tor functions.
adb logcat -c
adb shell am start -W -n com.baurp.trivochat/.MainActivity
sleep 5
adb shell pidof com.baurp.trivochat | grep -E '^[0-9]+'
echo "Verified Android API ${ACTUAL_SDK:-unspecified}: APK install/reinstall, private data retention, and live app process after launch."
