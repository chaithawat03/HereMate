/**
 * A late native Android GPS watcher must not be treated as a live publisher
 * if OS permission, Firebase account or foreground status changed while
 * watchPositionAsync was binding. Never start background location or retain GPS.
 */
export type ForegroundSubscription=Readonly<{remove:()=>void}>;
export async function bindVerifiedForegroundWatch(
  bind:()=>Promise<ForegroundSubscription>,
  stillAllowed:()=>Promise<boolean>
):Promise<ForegroundSubscription>{
  const subscription=await bind();
  let approved=false;
  try {approved=await stillAllowed()===true;}
  catch{/* Android OS permission APIs can fail while Settings is changing. */}
  if(!approved){
    subscription.remove();
    throw Error('ANDROID_FOREGROUND_WATCH_REVOKED_DURING_BIND');
  }
  return subscription;
}
