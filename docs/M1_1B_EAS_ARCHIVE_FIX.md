# M1.1B — Fix missing Google Services in EAS Build archive

## Evidence (22 Oct 2026)
- Owner provided internal EAS Cloud Build logs for two failed runs:
  - https://expo.dev/accounts/smartyyys-team/projects/heremate/builds/35182e24-1545-46dc-8672-fe575a01f08f
  - https://expo.dev/accounts/smartyyys-team/projects/heremate/builds/e3fb21ec-6ecd-4558-958c-3ffe76549433
- Expo Cloud: dependency install and config read succeeded; native prebuild failed with `ENOENT` copying `/home/expo/workingdir/build/google-services.json`.
- Root cause: the root `.gitignore` contained `google-services.json`. Even though a reviewed copy was committed to Git, EAS CLI excludes paths matched by `.gitignore` from the build archive by default.
- Remedy: `.easignore` repeats **all** existing exclusion rules, then places `!google-services.json` last. This makes the single public Firebase Android client configuration available for Android Prebuild, while continuing to exclude secrets, private key/certificate/keystore files, environment files and binary build outputs.
- Removed the legacy `expo.newArchEnabled: true` because SDK 57+ with RN 0.86 uses the new architecture by default, and Expo Doctor says this config field is not accepted by the current schema.
- The Expo Doctor dependency check additionally suggests Expo ~57.0.31, expo-location ~57.0.22 and React Native 0.86.3 (rather than installed 57.0.30, 57.0.12 and 0.86.2). These patch mismatches were *warnings separate from the fatal file ENOENT* and are **not changed in this narrow release hotfix**. Address them with a separate pinned lockfile, Expo compatibility and security-audit review so as not to broaden scope.

## Release and validation
1. Run Foundation/security snapshot tests, Firebase Emulator, Mobile TypeScript and Metro, and Android native Prebuild smoke in PR CI. Test EAS-specific ignore patterns including retention of all credential exclusions and explicit inclusion of Firebase JSON.
2. Merge only after CI green and reviewed.
3. Trigger a **new, reviewed main-branch EAS Android Staging build**, verify Prebuild now finds the JSON. Only mark build delivered after the GitHub run and private Drive manifest confirm upload.
4. Before testing Google Sign-In on Android, verify signing SHA-1 still equals the Firebase OAuth Android SHA-1. Repeat signed-out Google login, Guest→Google linking with same UID and owner-profile persistence; collision must not silently switch accounts.
5. No Production or iOS Google activation and no remote GPS sharing.

Source: https://docs.expo.dev/build-reference/easignore/
