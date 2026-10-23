# HereMate M3/M4 single final acceptance — implementation ledger (2026-10-23)

Owner requested completing **all planned milestones before one physical acceptance
campaign**, replacing interim APK testing. This requests product development,
not a waiver of Firebase authorization, consent or OS/app-store privacy rules.

## Actual progress
- M0–M1: Android foundation, Guest/Google, private profiles/friends, TH/EN,
  light/dark; deferred physical cases remain recorded in Issue #33.
- M2: real Cloud Run Singapore deployed, synthetic 3-account live
  Firebase-Auth/Firestore consent/Start/Publish/Read/Stop E2E **PASS**;
  Android M2 code CI and Android Gradle installable test APK SUCCESS.
  **Phone GPS acceptance NOT VERIFIED**.
- M3 first slice: iOS foreground-only **opt-in source path** using same
  M2 backend and Firebase Guest identities, actual accepted M1 friends,
  mutually consented point sharing. Test only with explicit
  `EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND=true` in a Staging iOS bundle.
  Normal iOS Guest EAS profile remains unchanged and disabled. CI checks
  source and iOS Metro; this is NOT an iPhone installation, signed IPA,
  native/background QA or Google iOS sign-in acceptance.
- M4 first slice: pure explicit two-party-approved **geofence circle transition
  evaluator** with accurate fresh points, 2-sample stability, 5min cooldown,
  ambiguous-boundary suppression, revoked-consent fail-closed behavior, and
  only ephemeral inside/outside state (no persisted coordinates).
  **NOT wired** to mobile/background tasks, Cloud Run, Firestore or push
  notifications; no history.

## Outstanding gates before one final acceptance
1. M1 deferred identity/consent UI behavior and real Android M2 phone GPS
   integration must be verified automatically where possible, then included
   in the final owner campaign.
2. M3: real iPhone account/foreground sharing, shared cross-platform map,
   explicit independent background opt-in, OS-specific permission/restart
   lifecycle, owner-vs-active-device policy and battery/timeout behavior.
   App must keep background OFF unless each user independently opts in and
   revocation stops all publisher tasks.
3. iOS native device installation requires Apple signing/provisioning.
   An unsigned simulator build does NOT install on a physical iPhone;
   no developer credentials may be pasted into source or chat.
4. M4: subject-owned geofence approval, server-validated owner/subject
   relationship and M2 grant on EVERY sample/notification, confidential
   geofence storage/rules, event dedupe and explicit notification opt-in;
   anti-coercion and abuse limits, retention and deletion rules must
   be implemented and reviewed before enabling any new remote endpoints.
5. Optional location **history** is deliberately NOT enabled. Retaining
   movement history requires a *separate explicit data retention and deletion*
   decision; even an all-milestones development instruction is not consent
   by the tracked person to permanent location logging.
6. One consolidated final cross-platform Release Candidate with pinned SHA,
   passing emulators/native builds, restricted private artifact delivery,
   and one Z Fold7/RG406V + eligible iPhone acceptance matrix.
   No production/play-store/TestFlight deployment without separate approval.

Keep Issue #38 as the cross-platform change decision ledger and Issues
#33/#34 as the actual acceptance exceptions. Mark every slice PASS,
BLOCKED or NOT VERIFIED with evidence. No interim test request.
