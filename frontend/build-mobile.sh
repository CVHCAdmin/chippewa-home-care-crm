#!/bin/bash
# build-mobile.sh — Build native iOS & Android apps via Capacitor
# Run from /frontend directory

set -e

echo "🏗️  Building HomeCare CRM for mobile..."

# 1. Build the web app
echo "📦 Building web bundle..."
npm run build

# 2. Sync to native platforms
echo "🔄 Syncing to native platforms..."
npx cap sync

# 3. Platform-specific builds
case "${1:-both}" in
  ios)
    echo "🍎 Opening iOS project in Xcode..."
    npx cap open ios
    echo ""
    echo "Next steps for iOS:"
    echo "  1. Set your Apple Developer Team in Signing & Capabilities"
    echo "  2. Update bundle ID to com.buildpro.homecare (or your custom ID)"
    echo "  3. Archive → Distribute App → App Store Connect"
    ;;
  android)
    echo "🤖 Opening Android project in Android Studio..."
    npx cap open android
    echo ""
    echo "Next steps for Android:"
    echo "  1. Build → Generate Signed Bundle/APK"
    echo "  2. Upload .aab to Google Play Console"
    ;;
  both)
    echo "✅ Web bundle built and synced to iOS and Android"
    echo ""
    echo "To open platform projects:"
    echo "  npx cap open ios      # Opens Xcode"
    echo "  npx cap open android  # Opens Android Studio"
    echo ""
    echo "App Store requirements checklist:"
    echo "  □ Apple Developer account (\$99/yr)"
    echo "  □ App icons: 1024x1024 PNG (no alpha)"
    echo "  □ Screenshots for iPhone 6.5\" and 5.5\""
    echo "  □ Privacy policy URL"
    echo "  □ App description and keywords"
    echo ""
    echo "Google Play requirements:"
    echo "  □ Google Play Developer account (\$25 one-time)"  
    echo "  □ App icons: 512x512 PNG"
    echo "  □ Feature graphic: 1024x500 PNG"
    echo "  □ Screenshots (min 2)"
    ;;
esac

echo ""
echo "🎉 Done!"
