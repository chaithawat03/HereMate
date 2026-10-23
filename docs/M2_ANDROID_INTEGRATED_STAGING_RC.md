# HereMate M2 Android Integrated Staging Test APK

**Backend verified live:** Cloud Run `heremate-m2-location-staging` at
`https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app`.
On 2026-10-23 the owner confirmed actual authenticated Firebase/Firestore/HTTPS
E2E (two mutually consenting accounts; third stranger blocked): START, synthetic
(0,0) PUBLISH, authorized READ, consent revocation and STOP all PASS.

## One APK without Expo EAS quota

The reviewed Android-only opt-in root `M2StagingApp.tsx` combines Guest/Google
login, own M1 profile, real M1 friendship and dual-consent management, M2
foreground-only sharing, and consent-filtered friend location schematic.
Normal Demo/Guest EAS profiles and iOS remain unchanged.

GitHub Actions workflow `android-m2-native-staging-apk.yml` is a
**manual-only** single native release APK build. It uses locked Expo dependencies,
`expo prebuild`, Android Gradle `assembleRelease` with the local debug signing
configuration intended strictly for owner-device testing (not Google Play
production signing), and an APK/immutable SHA-256 manifest as one 7-day
Actions artifact. It uses no EAS cloud build or extra OAuth/GCP credentials.
The workflow may fail if GitHub hosted Android builds are incompatible or
exceed compute limits; do not claim an APK exists without a successful job.

To run after merge/green PR CI, open GitHub Actions →
**HereMate M2 Android APK — one manual test build**, select `main`, enter
`heremate/android-m2-staging` and click **Run workflow once**. When finished
SUCCESS, download `HereMate-M2-Android-Staging-Test-APK` from the run's
Artifacts, unzip, verify SHA-256 against `android-m2-rc-manifest.json`, then
install on owner-approved Android devices. This test APK may require
uninstalling a different-signature package version already installed with
the same Android package name, potentially losing that app's local data;
review before uninstalling.

No real-device GPS sharing has been verified yet. Test on Samsung Galaxy Z Fold7
and Anbernic RG406V with two distinct Firebase test accounts and mutual
friend consent. Foreground-only START→PUBLISH→READ→STOP; background/permission
revocation; stranger denial and consent OFF. The location schematic is not a
Google Maps/Apple Find My basemap; persistent/background device finding,
iOS native real-device deployment, Production, M3 and M4 are out of scope.
Never share real coordinates without user consent.
