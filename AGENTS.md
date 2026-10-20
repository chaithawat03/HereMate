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
