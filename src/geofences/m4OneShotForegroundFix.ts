/**
 * M4 one-shot foreground GPS evaluation for an explicitly opted-in subject.
 * Capture a single owner/account/UI-operation generation in isCurrent().
 * Native permission requests and GPS reads may settle AFTER logout, account
 * switch, foreground loss or cancellation. Never submit such a stale fix.
 * This helper retains no coordinates, registers no task and emits no alert.
 */
import type {ShareFix} from '../location/m2ForegroundSession';

export const M4_ONE_SHOT_MAX_MS=60_000;
export type M4OneShotPorts=Readonly<{
  isCurrent:()=>boolean;
  servicesEnabled:()=>Promise<boolean>;
  requestPermission:()=>Promise<boolean>;
  hasPermission:()=>Promise<boolean>;
  getCurrentFix:()=>Promise<ShareFix>;
  evaluate:(fix:ShareFix)=>Promise<'enter'|'exit'|null>;
  now:()=>number;
  // Monotonic time independently bounds a delayed OS prompt/GPS response.
  monotonicNow:()=>number;
  // A shorter deadline may be injected by offline tests; never exceed consent.
  deadlineMs?:number;
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
  if(p.isCurrent()!==true)throw Error('M4_ONE_SHOT_CANCELLED');
  // One explicit tap authorizes one evaluation for at most 60 elapsed seconds.
  // GPS permission prompts and getCurrentPositionAsync can remain unresolved
  // after app suspension. A fresh fix alone must not renew old consent.
  const consentStartedAtMs=p.now();
  const consentStartedMonoMs=p.monotonicNow();
  if(!Number.isSafeInteger(consentStartedAtMs)||
     !Number.isFinite(consentStartedMonoMs))
    throw Error('M4_ONE_SHOT_UNAVAILABLE');
  const deadlineMs=p.deadlineMs??M4_ONE_SHOT_MAX_MS;
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<20||
     deadlineMs>M4_ONE_SHOT_MAX_MS)
    throw Error('M4_ONE_SHOT_UNAVAILABLE');
  let lastObservedMonoMs=consentStartedMonoMs,expired=false;
  const current=()=>{
    // Promise.race alone cannot cancel a hung native promise's continuation.
    // Retire the exact tap before any late OS/GPS/HTTPS result can progress.
    if(expired)throw Error('M4_ONE_SHOT_UNAVAILABLE');
    if(p.isCurrent()!==true)throw Error('M4_ONE_SHOT_CANCELLED');
    const wall=p.now(),mono=p.monotonicNow();
    if(!Number.isSafeInteger(wall)||!Number.isFinite(mono)||
       wall<consentStartedAtMs||wall-consentStartedAtMs>=60_000||
       mono<lastObservedMonoMs||
       mono-consentStartedMonoMs>=60_000)
      throw Error('M4_ONE_SHOT_UNAVAILABLE');
    lastObservedMonoMs=mono;
  };
  // A hung OS permission, native GPS or HTTPS response must not hold the
  // panel's busy/revoke controls indefinitely. This foreground JS watchdog
  // does NOT assert execution while the operating system suspends the app.
  const work=async():Promise<'enter'|'exit'|null>=>{
    // A native one-shot GPS API may return a cached location predating the tap.
    // Consent is captured BEFORE any asynchronous permission or GPS work.
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
       fix.capturedAtMs<consentStartedAtMs||
       fix.capturedAtMs>=consentStartedAtMs+60_000)
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
  };
  let timer:ReturnType<typeof setTimeout>|null=null;
  const deadline=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
      expired=true;
      reject(Error('M4_ONE_SHOT_UNAVAILABLE'));
    },deadlineMs);
  });
  try{return await Promise.race([work(),deadline]);}
  finally{
    expired=true;
    if(timer!==null)clearTimeout(timer);
  }
}
