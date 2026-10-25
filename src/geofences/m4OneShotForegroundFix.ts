/**
 * M4 one-shot foreground GPS evaluation for an explicitly opted-in subject.
 * Capture a single owner/account/UI-operation generation in isCurrent().
 * Native permission requests and GPS reads may settle AFTER logout, account
 * switch, foreground loss or cancellation. Never submit such a stale fix.
 * This helper retains no coordinates, registers no task and emits no alert.
 */
import type {ShareFix} from '../location/m2ForegroundSession';

export type M4OneShotPorts=Readonly<{
  isCurrent:()=>boolean;
  servicesEnabled:()=>Promise<boolean>;
  requestPermission:()=>Promise<boolean>;
  hasPermission:()=>Promise<boolean>;
  getCurrentFix:()=>Promise<ShareFix>;
  evaluate:(fix:ShareFix)=>Promise<'enter'|'exit'|null>;
  now:()=>number;
}>;

const validFix=(fix:ShareFix,now:number):boolean=>
  Number.isSafeInteger(now)&&Number.isSafeInteger(fix?.capturedAtMs)&&
  fix.capturedAtMs>=now-30_000&&fix.capturedAtMs<=now+5_000&&
  Number.isFinite(fix.latitude)&&fix.latitude>=-90&&fix.latitude<=90&&
  Number.isFinite(fix.longitude)&&fix.longitude>=-180&&fix.longitude<=180&&
  Number.isFinite(fix.accuracyMeters)&&
  fix.accuracyMeters>=0&&fix.accuracyMeters<=100;

export async function evaluateM4OneShotForegroundFix(
  p:M4OneShotPorts
):Promise<'enter'|'exit'|null>{
  const current=()=>{
    if(p.isCurrent()!==true)throw Error('M4_ONE_SHOT_CANCELLED');
  };
  current();
  // A native one-shot GPS API may resolve with a cached location whose age
  // is acceptable but whose capture predates the subject's explicit tap.
  // Record consent time before ANY asynchronous OS permission or GPS work.
  const consentStartedAtMs=p.now();
  if(!Number.isSafeInteger(consentStartedAtMs))
    throw Error('M4_ONE_SHOT_UNAVAILABLE');
  const services=await p.servicesEnabled();
  current();
  if(services!==true)throw Error('M4_ONE_SHOT_UNAVAILABLE');
  const granted=await p.requestPermission();
  current();
  if(granted!==true)throw Error('M4_ONE_SHOT_UNAVAILABLE');
  // A native GPS fix may return long after a Firebase account/OS transition.
  const fix=await p.getCurrentFix();
  current();
  const permitted=await p.hasPermission();
  current();
  if(permitted!==true||!validFix(fix,p.now())||
     fix.capturedAtMs<consentStartedAtMs)
    throw Error('M4_ONE_SHOT_UNAVAILABLE');
  current(); // no stale-account coordinate may enter the HTTPS transport
  const event=await p.evaluate(fix);
  current();
  // An OS Settings revoke while the network call was pending suppresses the
  // result even when the server had already accepted the point.
  const stillPermitted=await p.hasPermission();
  current();
  if(stillPermitted!==true)throw Error('M4_ONE_SHOT_UNAVAILABLE');
  if(event!==null&&event!=='enter'&&event!=='exit')
    throw Error('M4_ONE_SHOT_UNAVAILABLE');
  return event;
}
