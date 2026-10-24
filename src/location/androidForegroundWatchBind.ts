/**
 * A late native Android GPS watcher must not be treated as a live publisher
 * if OS permission, Firebase account or foreground status changed while
 * watchPositionAsync was binding. Never start background location or retain GPS.
 *
 * Android's native bridge can also stall indefinitely while a permission or
 * Settings activity is changing. A remote START grant is short-lived, but an
 * unresolved native bind must not strand the UI in 'starting' or postpone STOP.
 */
export type ForegroundSubscription=Readonly<{remove:()=>void}>;
export const ANDROID_FOREGROUND_WATCH_BIND_TIMEOUT_MS=15_000;
export async function bindVerifiedForegroundWatch(
  bind:()=>Promise<ForegroundSubscription>,
  stillAllowed:()=>Promise<boolean>,
  timeoutMs=ANDROID_FOREGROUND_WATCH_BIND_TIMEOUT_MS
):Promise<ForegroundSubscription>{
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||
     timeoutMs>ANDROID_FOREGROUND_WATCH_BIND_TIMEOUT_MS)
    throw Error('ANDROID_FOREGROUND_WATCH_INVALID_TIMEOUT');
  let expired=false,subscription:ForegroundSubscription|null=null,removed=false;
  const removeOnce=()=>{
    if(subscription&&!removed){
      removed=true;
      try{subscription.remove();}catch{/* Native teardown can throw during OS revoke. */}
    }
  };
  let timer:ReturnType<typeof setTimeout>|null=null;
  const deadline=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{
      expired=true;
      // A watcher can already be active while the final OS permission check
      // hangs. Remove it immediately, even if that check never resolves.
      removeOnce();
      reject(Error('ANDROID_FOREGROUND_WATCH_BIND_TIMED_OUT'));
    },timeoutMs);
  });
  const attempt=(async()=>{
    const sub=await bind();
    subscription=sub;
    // If watchPositionAsync settles AFTER the deadline, its late native
    // subscription must be removed without reopening sharing.
    if(expired){removeOnce();throw Error('ANDROID_FOREGROUND_WATCH_BIND_TIMED_OUT');}
    let approved=false;
    try{approved=await stillAllowed()===true;}
    catch{/* Android OS permission APIs can fail while Settings is changing. */}
    if(expired||!approved){
      removeOnce();
      throw Error(expired?'ANDROID_FOREGROUND_WATCH_BIND_TIMED_OUT':
        'ANDROID_FOREGROUND_WATCH_REVOKED_DURING_BIND');
    }
    return sub;
  })();
  try{return await Promise.race([attempt,deadline]);}
  finally{if(timer!==null)clearTimeout(timer);}
}
