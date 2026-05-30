#!/bin/bash
echo "Building NotificationTracker APK using Dockerized Android SDK..."
docker run --rm -v $(pwd):/project -w /project thyrlian/android-sdk bash -c "\
  yes | sdkmanager --licenses && \
  gradle assembleDebug"
echo "Build complete. APK should be in app/build/outputs/apk/debug/app-debug.apk"
