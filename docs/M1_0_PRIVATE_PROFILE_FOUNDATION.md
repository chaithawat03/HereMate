# M1.0 — Owner-only user profile foundation (Staging)

Tracking issue: https://github.com/chaithawat03/HereMate/issues/23

## Model and permission boundary
Collection `users/{auth.uid}` contains exactly:
- `displayName` (2–32 characters, user-entered pseudonym)
- `schemaVersion: 1`
- `shareLocation: false` (immutable in M1.0)
- `createdAt` and `updatedAt` server timestamp fields.

The client derives the document ID exclusively from Firebase Auth `currentUser.uid`; never accepts a UID supplied in a request or search field. Firestore Rules permit only the authenticated owner to get/create/update that one document; list queries, other users' profiles, deletion, other fields and sharing toggles are rejected. Private phone credential and rate-limit collections remain denied. `friend_requests`, `friendships` and `locations` remain denied until separate M1.2/M2 rules reviews. No public directory, email, phone, personal address or GPS history in the profile.

## Delivery / deployment dependency
- Reviewed PR+CI adds app UI, Firestore Rules and offline emulator ACL tests, but **does not deploy Firestore Rules**. GitHub EAS builds alone cannot change the live Firestore rules.
- Existing live Staging rules are expected to be DENY ALL until owner deploys the reviewed `firebase/firestore.rules` to project `heremate`; a profile may display a permissions warning in that state. Do not claim live profile writes succeeded before verified deployment.
- After deployment, install the new staging APK, use Guest Login, choose "สร้างโปรไฟล์ส่วนตัว", reopen and confirm name persists, edit own name, test with second different UID. Sharing must remain OFF.
- No Production; Firebase rule deployment requires staging permissions and explicit rule readback. Do not ship production Firestore Rules unreviewed.

## M1 sequence
M1.0 private profiles (this PR) -> M1.1 Google identity/linking -> M1.2 friend invites -> M1.3 accept/decline/remove -> M1.4 two-device privacy acceptance. GPS remains device-local until M2.
