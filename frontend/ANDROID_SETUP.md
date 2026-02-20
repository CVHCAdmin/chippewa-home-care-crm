# Android Setup Notes
# After running `npx cap add android`, you need to add these permissions
# to android/app/src/main/AndroidManifest.xml inside the <manifest> tag:

<!--
    <!-- Location (EVV clock in/out) -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

    <!-- Camera (future: document scanning) -->
    <uses-permission android:name="android.permission.CAMERA" />

    <!-- Notifications -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <!-- Network -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <!-- Wake lock (keep GPS running during shift) -->
    <uses-permission android:name="android.permission.WAKE_LOCK" />
-->

# Also add inside <application> tag:
<!--
    <meta-data
        android:name="com.google.firebase.messaging.default_notification_icon"
        android:resource="@mipmap/ic_launcher" />
    <meta-data
        android:name="com.google.firebase.messaging.default_notification_color"
        android:resource="@color/colorPrimary" />
-->

# Build commands:
# npx cap add android          — add Android platform (one time)
# npx cap sync android         — sync web build + plugins to Android
# npx cap open android         — open in Android Studio
# npx cap run android          — run on connected device/emulator
