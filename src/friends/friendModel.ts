export type FriendRequestStatus = 'pending'|'accepted'|'declined'|'cancelled'|'removed';
export type FriendRequest = Readonly<{
  id:string; senderUid:string; recipientUid:string; senderDisplayName:string;
  recipientDisplayName:string; status:FriendRequestStatus;
  senderConsent:boolean; recipientConsent:boolean;
}>;
export function checkInviteCode(value:string):string {
  const uid=value.trim();
  if(!/^[A-Za-z0-9_-]{12,128}$/.test(uid))throw new Error('INVALID_INVITE_CODE');
  return uid;
}
export function friendRequestId(senderUid:string,recipientUid:string):string {
  if(senderUid===recipientUid)throw new Error('CANNOT_FRIEND_SELF');
  return checkInviteCode(senderUid)+'__'+checkInviteCode(recipientUid);
}
export function relationView(request:FriendRequest,uid:string):'incoming'|'outgoing'|'friend'|'closed' {
  if(request.senderUid!==uid && request.recipientUid!==uid)throw new Error('NOT_PARTICIPANT');
  if(request.status==='accepted')return 'friend';
  if(request.status==='pending')return request.senderUid===uid?'outgoing':'incoming';
  return 'closed';
}
export function otherParticipant(request:FriendRequest,uid:string):{uid:string;displayName:string} {
  if(uid===request.senderUid)return {uid:request.recipientUid,displayName:request.recipientDisplayName || request.recipientUid.slice(0,8)};
  if(uid===request.recipientUid)return {uid:request.senderUid,displayName:request.senderDisplayName};
  throw new Error('NOT_PARTICIPANT');
}
