# M2.4C — Android Staging UI/permission-revocation preparation (code only)

Previous: M2.4A #41, M2.4B #42. Tracking M2 #34; owner Cloud Run approval gate #43. M3/M4 CR #38 stays separate.

- `M2AndroidStagingScreens.tsx` is the **typechecked but UNMOUNTED** seam between existing Android M2.2 sharing controls, M2.3 friend map and M2.4 verified HTTPS client. It requires an exact reviewed Staging Cloud Run origin provided in code, a separate `backendReviewedAndEnabled` security acceptance and Android+Staging+Guest-enabled context. No Staging URL exists yet. `App.tsx` and all `eas.json` profiles remain unchanged. This code DOES NOT transmit GPS or enable map.
- GPS watch callback checks `Location.getForegroundPermissionsAsync()` and `Location.hasServicesEnabledAsync()` **for every candidate fix**, even if permission was originally granted, and checks `AppState` again after the asynchronous permission inquiry. On denial invokes existing Stop / unconfirmed-Stop semantics, never publishes the point. Existing backend only grants a 60-second owner/recipient lease and checks consent on every read.
- The M2.4 HTTPS transport rechecks foreground + OS permission AFTER receiving a response and before returning a coordinate, rejects malformed/beyond-bounds points and expiry shapes. This protects against permission revocation during a pending request.
- The Node Cloud Run candidate rejects ambiguous/duplicate Authorization headers before passing a request to the Firebase Auth domain service, with a raw HTTP request regression test. No tokens, GPS or private user records are logged.
- The isolated new static CI gate checks these M2 integration files remain dormant and no EAS M2 enable flag exists.

**Not yet done, not waived:** #43 owner authorization of billable Staging Cloud Run architecture/region/IAM/cost, four Firestore TTL policies, deployment and authenticated real-account E2E, tested backend invocation abuse controls, explicit reviewed Android application mounting and EAS activation, SHA-pinned signed one-time RC and acceptance by Z Fold7/RG406V. There is no valid physical-device M2 test until then. No Production or iOS deployment.
