# Mobile App Build Guide

The frontend ships as a Capacitor-wrapped native app for Android and iOS in
addition to the PWA. The same React build is used; Capacitor wraps it in a
WKWebView (iOS) or WebView (Android) and exposes native APIs (push, GPS,
biometrics).

## App identity

- **App ID**: `com.cvhc.homecare`
- **App name**: `CVHC HomeCare`
- **Config**: `capacitor.config.ts`

## Building the web bundle first

Every native build starts from a current web build:

```bash
cd frontend
npm install
npm run build         # produces dist/
npx cap sync          # copies dist/ into android/ + ios/ and updates plugins
```

`cap sync` is the command you run after any web code change OR any
`npm install` of a Capacitor plugin.

---

## Android

Android is already scaffolded in `frontend/android/`. You don't need
`npx cap add android` again.

### Debug APK (sideload on a tester device)

```bash
cd frontend/android
./gradlew assembleDebug
# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

Transfer to the device and install (enable "Install unknown apps" first).

### Release AAB (Play Store upload)

1. Generate a release keystore (one-time):

   ```bash
   keytool -genkey -v -keystore cvhc-release.keystore \
     -alias cvhc -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Put the keystore somewhere outside the repo (do NOT commit it).

3. Create `frontend/android/keystore.properties` (gitignored):

   ```
   storeFile=/absolute/path/to/cvhc-release.keystore
   storePassword=…
   keyAlias=cvhc
   keyPassword=…
   ```

4. Build:

   ```bash
   cd frontend/android
   ./gradlew bundleRelease
   # AAB at: android/app/build/outputs/bundle/release/app-release.aab
   ```

5. Upload AAB at https://play.google.com/console.

### Android Studio (recommended for first-timers)

```bash
cd frontend
npx cap open android
```

Run on connected device or emulator from the IDE.

---

## iOS

iOS is **not yet scaffolded** because it requires macOS + Xcode (Linux/Windows
can't compile iOS). One-time setup on a Mac:

```bash
cd frontend
npx cap add ios       # creates frontend/ios/
npm install --save @capacitor/ios   # (already in package.json after add)
npx cap sync ios
npx cap open ios      # opens Xcode
```

### Apple Developer account requirements

- Apple Developer Program membership ($99/yr)
- An App ID for `com.cvhc.homecare` registered in
  https://developer.apple.com/account/resources/identifiers
- Provisioning profile + distribution certificate

### Build & ship

In Xcode:

1. Select **Any iOS Device** as the run target.
2. Product → Archive.
3. Organizer window → Distribute App → App Store Connect → Upload.
4. Submit for TestFlight / App Store review at
   https://appstoreconnect.apple.com.

### Capabilities to enable in Xcode

- Push Notifications (for `@capacitor/push-notifications`)
- Background Modes → Background fetch + Remote notifications
- Sign In with Apple (if you ever add it)

---

## Live reload during native dev

To run the React dev server and have the native app point at it:

1. Edit `capacitor.config.ts` and uncomment the `server.url` line with your
   laptop's LAN IP:

   ```ts
   server: {
     androidScheme: 'https',
     iosScheme:     'https',
     url:           'http://192.168.1.42:5173',
     cleartext:     true,
   },
   ```

2. `npm run dev` from `frontend/`
3. `npx cap sync` (one-time, picks up the URL change)
4. Run the native app; it loads from your laptop and hot-reloads.

REMOVE the `url:` and `cleartext:` lines before building for production.

---

## Updating the wrapper

When Capacitor or any plugin updates:

```bash
cd frontend
npm install
npx cap update android
npx cap update ios     # macOS only
npx cap sync
```

## Troubleshooting

- **Push notifications not arriving on Android**: verify
  `google-services.json` is in `android/app/` and `VAPID_PUBLIC_KEY` is set
  on the backend (`/api/push/vapid-key` returns 200 not 503).
- **iOS GPS prompts every launch**: `NSLocationAlwaysAndWhenInUseUsageDescription`
  must be set in `ios/App/App/Info.plist` with a real description string.
- **Network requests fail with "App Transport Security"**: production API
  must be served over HTTPS. The dev `cleartext: true` toggle covers local LAN
  only — never ship with it.

## Quick reference

| Action                  | Command                            |
| ----------------------- | ---------------------------------- |
| Rebuild web bundle      | `npm run build`                    |
| Push web → native       | `npx cap sync`                     |
| Open Android Studio     | `npx cap open android`             |
| Open Xcode (mac only)   | `npx cap open ios`                 |
| Add iOS platform        | `npx cap add ios` (mac only)       |
| Update Capacitor        | `npx cap update`                   |
