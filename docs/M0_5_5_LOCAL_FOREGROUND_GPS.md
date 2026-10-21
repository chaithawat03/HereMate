# HereMate M0.5.5 — Local foreground GPS trial
Owner approved continuing without additional Fold7 unfolded-screen acceptance.

Only in Staging Guest mode with EXPO_PUBLIC_ENABLE_LOCAL_GPS=true. Guest login does not request location. User presses Start GPS to request foreground permission, then sees an on-device GPS fix, accuracy and timestamp. Stop, background or logout clears the fix and removes watcher. No background tracking, storage, GPS-to-Firebase upload, friend sharing or Production release. Friend map remains synthetic.

Native dependency: expo-location 57.0.12 (Expo SDK 57 family). Validate with npm ci, typecheck, unit tests and Android/iOS Metro exports; rebuild Android EAS APK after Merge.

Physical Android test: Guest login without permission prompt; Start GPS and grant foreground permission; read local coordinates/accuracy/time; Stop GPS clears fields; deny permission; switch away and back; Logout. Do not post real coordinates in issue logs. Fold7 unfolded-screen testing intentionally waived by owner.
