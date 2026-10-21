# Engineering instructions — HereMate

- **Never deploy to Production** without separate, explicit owner approval.
- Android is the hero/test-install platform. Preserve iOS source compatibility; iOS Simulator build does not prove iPhone installation/background GPS.
- No copying prior projects. Build independent HereMate code on approved requirements.
- Use feature branches, PR review, required CI and verified commit SHA before merge.
- Never commit OAuth refresh tokens, Expo access tokens, service account keys, keystores, GPS coordinates or real user records.
- PR CI runs without cloud credentials. Staging cloud builds are separate, behind reviewed-main/credentials guards.
- Firebase authorization is server-validated. One active GPS publisher per account.
- Friend count is dynamic; status freshness and sharing consent must be explicit.
- Report only actual test/build/deployment evidence, distinguishing PASS, BLOCKED, and NOT VERIFIED.

## Product-first scope discipline
- The owner explicitly rejects overengineering supporting systems as prerequisites for core project progress. Prior example: polishing Google Drive Auto Delivery until custom domains/OAuth branding became an avoidable blocker for the Native Mobile App.
- Prioritize minimum viable, secure Android-first login, friend connections and consent-controlled live GPS. Document optional infrastructure separately, with its cost and fallback; never turn it into a gate without showing why it is necessary for the current milestone.
- Before creating billable Firebase/GCP services, verify the staging target, region, IAM and data security gates. Billing alerts are monitoring, not hard spending caps; an existing alert threshold breach must not block the owner's approved M0.5.3 work. Never deploy Production without separate approval.

## HereMate M0.5.3 Authentication contract (approved)
- Support Phone + Password through server-verified Cloud Run → Firebase Admin Custom Token; no SMS OTP in V1. Password hashes must be Argon2id, backend-only. Phone ownership is NOT verified and must not drive account recovery/linking without separate proof.
- Google login and Firebase Anonymous Guest use one stable application identity through explicit secure linking only, no duplicate/implicit merges; never allow unverified phone-based lookup of friends.
- All public login endpoints require durable server-side rate limits, nonenumerating responses and strict per-user Firebase Auth validation. Reject and redact client-provided UID, claims, phone/password logs, tokens and recovery codes.
- The M0.1 synthetic-only security exception DOES NOT authorize real user Auth/Firestore/RTDB/GPS. No real data or staging backend deploy until dedicated security rules and audited dependency gates pass.
