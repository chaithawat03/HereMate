# HereMate M1.2–M1.4 — Consolidated Friends milestone

Owner changed delivery policy: finish M1 and request **one** coordinated physical acceptance run, not one per PR. Tracking Issue #23; Theme/Locale #30.

## Technical design
- Staging Firebase Auth UID doubles as an **explicit invitation code** (long-press/copy from own private panel); only a person who receives that UID can send a request. No phone contacts, no searchable member directory, no guessing / list of `users`.
- Each relationship starts as a directed `friendRequests/{senderUid}__{recipientUid}` document. Both sides may query only records in which they are a member; stranger direct gets and global list queries fail security rules.
- Sender must have a profile and can create exactly one pending request to another existing profile. Sender's display name is verified by Firestore Rules against their private profile, preventing spoofing. Receiver can accept/decline; sender can cancel; either party can remove an accepted friendship. Terminal documents remain immutable (v1 does not permit repeated invites in the same direction).
- A confirmed friend can opt into **future** sharing as an explicit personal consent bool. Sender may only change senderConsent; receiver may only change recipientConsent. Both default false, and removing the friendship forces both false. No location is published or read as a result, even if both flags become true.
- Friend request contains no phone number, email address, latitude/longitude, precise coordinates, presence status, profile secrets or GPS history. This is not M2 live location sharing.
- Retains existing `users/{uid}` private owner-only rules. Legacy credential collections, `friend_requests`, `friendships` and `locations` remain blanket denied.

## Configuration dependency — manual Staging Firestore Rules deployment
**CI and Android EAS build do NOT deploy the new rules.** After PR review and Emulator tests PASS, owner must deploy the exact reviewed `firebase/firestore.rules` from main to Firebase project `heremate`. This is a **manual Staging Firestore Rules deployment** required before any real friend request can be created or accepted. Review/readback of the published rules and second account are part of the pre-RC service setup. Never deploy to Production.

No composite query indexes are needed for the two existing single-field `senderUid` / `recipientUid` equality queries. If Firebase requests an index in a later design, use a reviewed staging-only index plan.

## End-of-M1 integrated acceptance (one campaign)
- Guest sign in, create profile, unique Google credential linking preserving UID and profile; signed-out Google login; collision with already-used Google account fails closed.
- User A and B create separate profile names and share exact invitation code. A sends B a request, B refreshes, accepts, both refresh and see each other under real-friends panel. Verify a stranger cannot read or list private profiles / requests.
- B and A toggle their own future-sharing consent and observe both states; **GPS remains local only**. Either party removes friendship; both consent flags reset to false.
- Separate pending request cancel and decline flow; test invalid/self codes and offline errors. Re-sending a terminal request in the same direction remains unsupported in M1 v1.
- Light/Dark and TH/EN on sign-in, friends, profile and GPS; persist over restart. No Fold7 unfolded-layout acceptance is required.
- Use one named **M1 Release Candidate** signed Android Staging APK + private Google Drive manifest from final merged SHA. If issues are found, focused retests only; CI success is not device acceptance.

## Remaining scope / limitations
- No automatic handling of duplicate reciprocal requests, no rate limiter/server-side invitation throttling; one immutable directed document per pair mitigates simple repeat spam. More public/social discovery requires a separately approved anti-abuse service.
- Invitations currently use exact UID as a shared invite code; can be redesigned later to opaque rotating invitation codes with server-side validation. Do not treat Firebase UID as an authentication secret.
- Existing simulated friends/map UI remains explicitly labelled simulated; real friend list is a separate panel. Real map markers and live positions are strictly M2.
