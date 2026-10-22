/** M1 relationship ledger. Only client-owned actor UID is used in mutation decisions. */
import {getApp} from 'firebase/app';
import {collection,doc,getDocs,getFirestore,query,serverTimestamp,setDoc,updateDoc,where} from 'firebase/firestore';
import {getStagingGuestAuth} from '../auth/firebaseGuest';
import {firebaseStagingIdentity} from '../config/firebaseStaging';
import {loadOwnProfile} from '../profile/firestoreProfile';
import {checkInviteCode,friendRequestId,type FriendRequest, type FriendRequestStatus} from './friendModel';

function own() {
  const auth=getStagingGuestAuth();
  const uid=auth.currentUser?.uid;
  if(!uid)throw new Error('NOT_SIGNED_IN');
  const app=getApp();
  if(app.options.projectId!==firebaseStagingIdentity.projectId)throw new Error('WRONG_STAGING_PROJECT');
  return {uid,db:getFirestore(app)};
}
function ref(id:string) { const {db}=own();return doc(db,'friendRequests',id); }
export function ownInviteCode():string {return checkInviteCode(own().uid);}

export async function listOwnRequests():Promise<FriendRequest[]> {
  const {uid,db}=own(), base=collection(db,'friendRequests');
  // Firestore rules permit ONLY queries constrained by the caller's UID.
  const [sent,received]=await Promise.all([
    getDocs(query(base,where('senderUid','==',uid))),
    getDocs(query(base,where('recipientUid','==',uid))),
  ]);
  const results=new Map<string,FriendRequest>();
  for(const snap of [...sent.docs,...received.docs]) {
    const data=snap.data();
    if(data.senderUid!==uid && data.recipientUid!==uid)continue;
    if(!['pending','accepted','declined','cancelled','removed'].includes(data.status))continue;
    results.set(snap.id,{
      id:snap.id,senderUid:data.senderUid,recipientUid:data.recipientUid,
      senderDisplayName:data.senderDisplayName,recipientDisplayName:data.recipientDisplayName,
      status:data.status as FriendRequestStatus,
      senderConsent:data.senderConsent===true,recipientConsent:data.recipientConsent===true,
    });
  }
  return [...results.values()];
}
export async function sendFriendRequest(invite:string):Promise<void> {
  const {uid}=own();
  const recipientUid=checkInviteCode(invite);
  const id=friendRequestId(uid,recipientUid);
  const profile=await loadOwnProfile();
  if(!profile)throw new Error('PROFILE_REQUIRED');
  if(own().uid!==uid)throw new Error('SESSION_CHANGED');
  await setDoc(ref(id),{
    schemaVersion:1,senderUid:uid,recipientUid,
    senderDisplayName:profile.displayName,recipientDisplayName:'',
    status:'pending',senderConsent:false,recipientConsent:false,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
  });
}
export async function actOnRequest(request:FriendRequest,action:'accepted'|'declined'|'cancelled'|'removed'):Promise<void> {
  const {uid}=own();
  if(uid!==request.senderUid && uid!==request.recipientUid)throw new Error('NOT_PARTICIPANT');
  const isReceiver=uid===request.recipientUid;
  if(action==='accepted'||action==='declined') {
    if(!isReceiver||request.status!=='pending')throw new Error('INVALID_TRANSITION');
    const profile=await loadOwnProfile();
    if(!profile)throw new Error('PROFILE_REQUIRED');
    if(own().uid!==uid)throw new Error('SESSION_CHANGED');
    await updateDoc(ref(request.id),{
      status:action,
      ...(action==='accepted'?{recipientDisplayName:profile.displayName}:{}),
      updatedAt:serverTimestamp(),
    });
    return;
  }
  if(action==='cancelled') {
    if(isReceiver||request.status!=='pending')throw new Error('INVALID_TRANSITION');
    await updateDoc(ref(request.id),{status:'cancelled',updatedAt:serverTimestamp()});
    return;
  }
  if(request.status!=='accepted')throw new Error('INVALID_TRANSITION');
  await updateDoc(ref(request.id),{
    status:'removed',senderConsent:false,recipientConsent:false,
    updatedAt:serverTimestamp(),
  });
}
export async function setOwnFriendConsent(request:FriendRequest,enabled:boolean):Promise<void> {
  const {uid}=own();
  if(request.status!=='accepted')throw new Error('INVALID_TRANSITION');
  const field=uid===request.senderUid?'senderConsent':uid===request.recipientUid?'recipientConsent':null;
  if(!field)throw new Error('NOT_PARTICIPANT');
  // A consent flag does not activate location sharing; GPS remains device-local until M2.
  await updateDoc(ref(request.id),{[field]:enabled,updatedAt:serverTimestamp()});
}
