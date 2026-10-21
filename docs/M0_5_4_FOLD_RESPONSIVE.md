# HereMate M0.5.4 — Fold-responsive UI / Safe Area

Source: Z Fold7 Android Staging Guest trial screen-recording review, 21 Oct 2026.

## Fixes in this candidate
- A single top-level native `SafeAreaView` wraps both the synthetic Demo and Firebase Guest preview. On Android the root additionally reserves `StatusBar.currentHeight` because React Native's legacy `SafeAreaView` alone does not apply Android status bar insets. Child screens use plain `View` to avoid double padding.
- The Demo screen uses `useWindowDimensions` and a pure `getResponsiveLayout()` calculation so folding/unfolding can rerender automatically without fixed device assumptions.
- Map height adapts to available window height (300–460 dp cover and 360–520 dp expanded); no fixed 290 dp map.
- At >= 600 dp window width, constrain the content to 960 dp and display friend cards in two columns. Smaller windows keep one column.
- Increase secondary text from 11 to 13 sp, add bottom scroll padding, and improve Guest header height. No Firebase Auth logic or synthetic coordinates changed.
- No extra native dependencies, no Android permissions, no real GPS, no Production.

## Acceptance requirements
1. Build an updated `android-guest-staging` APK from the reviewed merge; **the M0.5.3 APK cannot contain this UI fix**.
2. On Z Fold7 cover: status bar time/icons must not overlap FIREBASE STAGING or Logout; map and filters should remain usable.
3. Expand to inner display: the layout must recalculate without cropped content, text overlap or loss of guest session. Friend list should become two columns.
4. Re-fold, rotate if enabled, and check signed-out Guest login screen, keyboard/search, long lists, and navigation bar clearance.
5. Physical-device verification is **PENDING** until owner reports results; CI tests only establish responsive dimension logic and bundle compilation.

Implementation note: This is a dependency-free Android status-bar top-inset repair for the Staging trial. If device tests show OEM-specific inset or gesture-bar problems, replace this with the Expo-compatible `react-native-safe-area-context` library in a separate locked-dependency PR.
