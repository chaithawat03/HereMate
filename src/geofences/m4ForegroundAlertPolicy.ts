/**
 * M4 foreground-only in-app alert presentation policy.
 * This is NOT push delivery, a notification permission, or a GPS subscription.
 * All events originate from the already-authorized server geofence evaluator.
 * No UID, private position, movement history or token enters an alert payload.
 */
export type M4ZoneEvent='enter'|'exit';
export type ForegroundAlertContext=Readonly<{
  platform:string;
  currentUid:string|null;
  panelUid:string|null;
  appActive:boolean;
  optedIn:boolean;
  event:M4ZoneEvent|null;
}>;
export function shouldPresentM4ForegroundAlert(context:ForegroundAlertContext):boolean{
  return (context.platform==='android'||context.platform==='ios')&&
    context.appActive===true&&context.optedIn===true&&
    typeof context.panelUid==='string'&&context.panelUid.length>0&&
    context.currentUid===context.panelUid&&
    (context.event==='enter'||context.event==='exit');
}
