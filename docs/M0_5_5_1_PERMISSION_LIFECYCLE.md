# HereMate M0.5.5.1 — Android permission-dialog lifecycle hotfix

The owner video showed Start GPS returning to Off immediately after Android permission UI. React Native AppState can report background during a temporary system Activity; the previous unconditional stop invalidated the permission promise.

Fix: while a foreground permission request is outstanding, ignore the transient background event. After permission approval, wait for AppState active **before** creating any foreground watcher. Stop or unmount invalidates pending asynchronous work and cleans the subscription; after the watcher starts, a genuine background event still stops and clears GPS. No background location permission or remote GPS sharing.

Re-test on Android using a new APK: revoke app location permission, log in Guest, press Start, grant while using, verify coordinates appear, press Stop; then separately leave the app while GPS is on and verify it stops. The owner has waived Fold7 unfolded-screen UI testing.

Source tests cannot prove real GPS acquisition; acceptance requires physical-device video.
