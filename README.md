# HereMate

**Your People. One Map.**

HereMate is an Android-first, iOS-ready mobile location-sharing app. This repository is a **new native project** built with Expo, React Native, and TypeScript.

## Architecture decisions

- **Android hero:** first signed internal APK, installed on a real device.
- **iOS in parallel:** shared codebase and simulator readiness; on-device iOS signing and GPS acceptance are deferred until the owner enables Apple Developer membership.
- **Backend baseline:** Firebase Authentication, Firestore for persistent data, Realtime Database for authorized live position feeds, Cloud Run for server authorization and GPS lease coordination.
- **Privacy:** explicit location sharing; do not claim stale positions are live; never expose another user's raw GPS feed without authorization.
- **Scale:** no fixed 30-friend limit; filtering, clustering, and selective subscriptions.

## Delivery contract

Plan → implement/test → review → PR/CI → merge → staging build → verify artifact → private Google Drive delivery → physical-device acceptance.

- Reviewed PRs must pass required checks before merge.
- Staging builds use Expo EAS Build and GitHub Actions; they are **not production releases**.
- Google Drive artifacts are uploaded using the **owner's OAuth authorization**, not an openly shared folder or service account ownership.
- **Production / app-store release requires separate explicit approval.**
- Never commit credentials, tokens, key stores, or user location data.

## Current status

M0 — Project foundation. Repository initialized for source control; native app code, EAS credentials, CI gates, and staging distribution are configured in subsequent milestones. No production deployment.

[Engineering tracker](https://github.com/chaithawat03/HereMate/issues/2)

## HereMate v2 preview (Demo/Live redesign, Android)

A new app root (`HereMateApp.tsx`) with a full-screen OpenStreetMap map (MapLibre + OpenFreeMap, no API key), Premium Minimal UI, and an in-app **Demo | Live** switch.

- **Enable:** bundle with `EXPO_PUBLIC_ENABLE_HEREMATE_V2=true` (Android only). Without the flag every existing build is unchanged; `app.config.js` adds background-location permissions only under this flag.
- **Demo mode:** offline simulator — 8 synthetic Bangkok friends, places/alerts, wave, background sharing. Never writes to Firebase.
- **Live mode:** existing Staging Firebase + Cloud Run. Phone login and wave show "Coming soon"; places and closed-app sharing appear only when their routes are deployed (probed at runtime).
- **Closed-app sharing (Live):** explicit per-friend consent, 1/4/8 h auto-stop, ongoing notification, server-enforced deadline (`POST /v1/locations/background/start`).
- **Build:** owner-dispatched `.github/workflows/android-v2-preview-apk.yml` (input `heremate/android-v2-preview`) → 7-day APK artifact + SHA-256 manifest. Not Production.
- **Design/plan:** `docs/superpowers/specs/2026-10-31-demo-live-redesign-design.md`, `docs/superpowers/plans/2026-10-31-demo-live-redesign.md`.
