/**
 * Account/foreground-scoped Android friend-map read transaction.
 * No cache, persistence, device GPS or client-side ACL grant is created.
 * The server still checks the viewer's authorization on EVERY peer read.
 */
import type {FriendRequest} from '../friends/friendModel';
import {
  authorizedPeers,MAX_MAP_FRIEND_READS,type ServerRead
} from './m2FriendLocationView';

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
  readPeer:(peerUid:string)=>Promise<ServerRead>;
}>;

/**
 * Return null, with no position/name snapshot, when the viewer changes or
 * leaves the foreground while either friendship or HTTP reads are pending.
 * An invalid/denied individual read never exposes a cached prior position.
 */
export async function loadAuthorizedFriendMap(
  p:AuthorizedMapReadPorts
):Promise<AuthorizedMapSnapshot|null>{
  const current=()=>UID.test(p.viewerUid)&&p.isCurrent();
  if(!current())return null;
  const rows=await p.loadRelations();
  if(!current())return null;
  // Do not even retain unrelated users' names if a malformed adapter returns
  // rows outside this account. Mutual consent is independently required below.
  const relations=rows.filter(row=>
    row.senderUid===p.viewerUid||row.recipientUid===p.viewerUid);
  const eligible=[...authorizedPeers(p.viewerUid,relations)]
    .sort((a,b)=>a.uid.localeCompare(b.uid)).slice(0,MAX_MAP_FRIEND_READS);
  const outcomes=await Promise.allSettled(eligible.map(async peer=>{
    if(!current())throw Error('map_read_cancelled');
    return {uid:peer.uid,response:await p.readPeer(peer.uid)};
  }));
  if(!current())return null;
  const reads:Record<string,ServerRead>={};
  let partialFailure=false;
  for(const outcome of outcomes){
    if(outcome.status==='rejected'){partialFailure=true;continue;}
    reads[outcome.value.uid]=outcome.value.response;
  }
  return {relations,reads,partialFailure};
}
