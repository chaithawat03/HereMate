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
- Stop before creating billable Firebase/GCP resources until the actual staging target, billing, budget alerts, region and security gates are verified and approved.
