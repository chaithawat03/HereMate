# M0.1 — Expo Native Shell

Expo URL: https://expo.dev/accounts/smartyyys-team/projects/heremate/settings
- Owner: `smartyyys-team`
- Slug: `heremate`
- **Immutable EAS UUID still unknown.** Do not create another Expo project; securely run `eas init --account smartyyys-team` interactively in the linked native project and confirm link to EXISTING @smartyyys-team/heremate. Review the generated `extra.eas.projectId` and `eas project:info`.
- No Expo token is required for PR CI. Never pass a token to PR checks.
- Android Hero preview: `android-preview` in eas.json. iOS simulator profile also exists; no Apple Developer enrollment now.
- Native app displays a **synthetic, map-like placeholder**, *not* Google Maps and *not* live GPS.
- Data uses made-up names and map points; no user data, Firebase, location access, or server writes.
- Dynamic sample counts 0, 5, 30, 100, 500, 1000; filter and search, limited preview markers, own sharing **simulation**.
- The personal Google Drive HereMate folder is **Restricted** as of owner re-check; separate OAuth approval is still pending.
- No Production profile and no Production release allowed.

## M0.1 verification
- PR CI: npm ci, strict TypeScript, Node tests, Expo config, dependency audit.
- Not verified yet: Expo cloud link, Android binary build, physical device, iOS simulator build, Drive upload or GPS tracking.
- We deliberately do not start EAS build until immutable Expo Project ID and CI/EAS credentials are confirmed.
