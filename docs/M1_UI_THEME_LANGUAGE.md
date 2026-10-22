# HereMate M1 UI — light/dark theme and TH/EN switch

Issue #30. Owner requested bright default theme, manual Dark/Light switch and TH/EN toggle on 22 Oct 2026.

## Implementation
- Default Light + Thai; user can switch either instantly from a global preference bar on both signed-out and authenticated screens. Includes original synthetic Demo.
- Preferences saved under `@heremate/ui-preferences/v1` using existing React Native AsyncStorage; no Firebase writes, no UI preference fields in user profiles and no extra permissions/dependencies.
- `PreferencesProvider` loads saved preferences before rendering authentication so initial UI does not flash the wrong theme. It saves only after restoration. Corrupt preference JSON falls back to safe defaults.
- One token palette for Light and Dark across map placeholder, friend markers/list, profile editor, GPS local-only panel, Guest/Google login, error messages, header ribbon, Android status bar.
- Central TH/EN dictionary with strict key-parity and placeholder tests. Switching language also changes existing error/status messages since state holds translation keys, not rendered strings.
- All Google credential linking, Firebase owner rules, GPS start/stop watchers and Android build settings remain unchanged. No production release.

## Acceptance
1. Install fresh staging APK. First launch uses Light/TH.
2. On signed-out login screen select Dark and EN. Confirm immediate dark colors, white text, English Login/Google labels and Android status icons; toggle back to Light and TH.
3. Authenticate Guest or Google, verify preference controls remain visible. Check map labels, synthetic friend statuses, GPS actions/errors, profile loading/create/save/rename/status in both languages.
4. Force-close/reopen app, then sign out/sign in; selected theme/language persist without changing Firebase UID/profile or GPS permissions.
5. Test error messages including existing-Google-account collision, denied GPS and invalid profile name; no raw credential errors or literal untranslated Thai when EN is selected.
6. No Fold7 unfolded-screen acceptance required; system status bar remains unobstructed.

Do not infer physical acceptance from CI: on-device visual contrast and interaction remain to be confirmed.
