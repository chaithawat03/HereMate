/**
 * Privacy boundary for asynchronous authenticated friend-list reads.
 * Stale reads must never repopulate account-specific names after sign-out,
 * account switching, backgrounding or component unmount.
 * No storage, coordinates, network or permission ownership here.
 */
const UID=/^[A-Za-z0-9_-]{12,128}$/;
export type AccountRefreshPorts=Readonly<{
  currentUid:()=>string|null;
  isForeground:()=>boolean;
}>;
export function createAccountScopedFriendRefresh(p:AccountRefreshPorts){
  let epoch=0,disposed=false;
  const current=(run:number,uid:string)=>
    !disposed&&epoch===run&&p.isForeground()&&p.currentUid()===uid;
  async function run<T>(
    load:()=>Promise<T>,commit:(value:T,uid:string)=>void,
    failed:()=>void
  ):Promise<boolean>{
    const uid=p.currentUid();
    if(disposed||!p.isForeground()||!uid||!UID.test(uid))return false;
    const runId=++epoch;
    try{
      const value=await load();
      if(!current(runId,uid))return false;
      commit(value,uid);
      return true;
    }catch{
      if(current(runId,uid))failed();
      return false;
    }
  }
  function invalidate(){++epoch;}
  function dispose(){invalidate();disposed=true;}
  return Object.freeze({run,invalidate,dispose});
}
