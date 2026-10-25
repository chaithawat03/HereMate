/**
 * Account/foreground-scoped Android friend-map read transaction.
 * No cache, persistence, device GPS or client-side ACL grant is created.
 * The server still checks the viewer's authorization on EVERY peer read.
 */
import type {FriendRequest} from '../friends/friendModel';
import type {ServerRead} from './m2FriendLocationView';

const MAX_MAP_FRIEND_READS=8;
// One foreground batch, including the Firestore relation load and all peer
// HTTPS reads, must settle before the next opt-in 30s polling interval.
export const ANDROID_FRIEND_MAP_BATCH_DEADLINE_MS=12_000;
const TIMED_OUT=Symbol('friend-map-deadline');

const UID=/^[A-Za-z0-9_-]{12,128}$/;
export type AuthorizedMapSnapshot=Readonly<{
  relations:FriendRequest[];
  reads:Record<string,ServerRead>;
  partialFailure:boolean;
}>;
export type AuthorizedMapReadPorts=Readonly<{
  viewerUid:string;
  /** Must inspect the live Firebase UID, foreground state and UI generation. */
  isCurrent:()=>boolean;
  loadRelations:()=>Promise<FriendRequest[]>;
  /** Inject the existing mutual-consent, duplicate-denying M2 projection. */
  selectPeers:(viewerUid:string,relations:readonly FriendRequest[])=>ReadonlyArray<{uid:string}>;
  readPeer:(peerUid:string)=>Promise<ServerRead>;
  /** Optional deterministic timer ports for offline tests; runtime uses JS timers. */
  scheduleDeadline?:(fn:()=>void,ms:number)=>unknown;
  cancelDeadline?:(handle:unknown)=>void;
}>;

/**
 * Return null, with no position/name snapshot, when the viewer changes or
 * leaves the foreground while either friendship or HTTP reads are pending.
 * An invalid/denied individual read never exposes a cached prior position.
 */
export async function loadAuthorizedFriendMap(
  p:AuthorizedMapReadPorts
):Promise<AuthorizedMapSnapshot|null>{
  const stillAuthorized=()=>UID.test(p.viewerUid)&&p.isCurrent();
  if(!stillAuthorized())return null;
  // A single stalled Firebase relation read or peer HTTPS promise must not
  // pin the UI refresh mutex forever or suppress seven successful peer reads.
  // Timeout is measured from entry, not restarted after the relation load.
  // We cannot cancel arbitrary adapter promises, so ignore all late results
  // and NEVER start new private peer reads after the deadline has elapsed.
  let expired=false,closed=false;
  const canRead=()=>!expired&&!closed&&stillAuthorized();
  let expire!:()=>void;
  const deadline=new Promise<typeof TIMED_OUT>(resolve=>{
    expire=()=>{expired=true;resolve(TIMED_OUT);};
  });
  const schedule=p.scheduleDeadline??((fn:()=>void,ms:number)=>setTimeout(fn,ms));
  const cancel=p.cancelDeadline??(handle=>
    clearTimeout(handle as ReturnType<typeof setTimeout>));
  let handle:unknown=null;
  try{
    handle=schedule(expire,ANDROID_FRIEND_MAP_BATCH_DEADLINE_MS);
    const rows=await Promise.race([p.loadRelations(),deadline]);
    if(rows===TIMED_OUT){
      // A still-current user sees a bounded, explicit partial-failure state,
      // never a stale list or a silently spinning loading indicator.
      return stillAuthorized()?{relations:[],reads:{},partialFailure:true}:null;
    }
    if(!canRead())return null;
    // Do not even retain unrelated users' names if a malformed adapter returns
    // rows outside this account. Mutual consent is independently required.
    const relations=rows.filter(row=>
      row.senderUid===p.viewerUid||row.recipientUid===p.viewerUid);
    const eligible=[...p.selectPeers(p.viewerUid,relations)]
      .sort((a,b)=>a.uid.localeCompare(b.uid)).slice(0,MAX_MAP_FRIEND_READS);
    const outcomes=await Promise.allSettled(eligible.map(async peer=>{
      if(!canRead())throw Error('map_read_cancelled');
      const response=await Promise.race([p.readPeer(peer.uid),deadline]);
      if(response===TIMED_OUT)throw Error('map_read_deadline');
      return {uid:peer.uid,response};
    }));
    if(!stillAuthorized())return null;
    const reads:Record<string,ServerRead>={};
    let partialFailure=expired;
    for(const outcome of outcomes){
      if(outcome.status==='rejected'){partialFailure=true;continue;}
      reads[outcome.value.uid]=outcome.value.response;
    }
    return {relations,reads,partialFailure};
  }finally{
    closed=true;
    if(handle!==null)cancel(handle);
  }
}
