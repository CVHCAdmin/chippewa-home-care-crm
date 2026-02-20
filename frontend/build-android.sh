#!/bin/bash
# build-android.sh
# Run this on your local machine to build the Android APK
# Requirements: Node.js, Android Studio, Java 17+

set -e

echo "🏗️  Building CVHC HomeCare Android APK..."

# 1. Build the web app
echo "📦 Building web bundle..."
npm run build

# 2. Sync to Android
echo "🔄 Syncing Capacitor..."
npx cap sync android

# 3. Add Android platform if not already added
if [ ! -d "android" ]; then
  echo "➕ Adding Android platform..."
  npx cap add android
  npx cap sync android
fi

# 4. Copy assets
echo "🎨 Copying assets..."
npx cap copy android

echo ""
echo "✅ Sync complete!"
echo ""
echo "Next steps:"
echo "  1. Open Android Studio:  npx cap open android"
echo "  2. In Android Studio: Build → Generate Signed Bundle/APK → APK"
echo "  3. For debug APK (no signing): Build → Build Bundle(s)/APK(s) → Build APK(s)"
echo ""
echo "Or to run directly on connected device/emulator:"
echo "  npx cap run android"
echo ""
echo "APK will be at: android/app/build/outputs/apk/debug/app-debug.apk"
