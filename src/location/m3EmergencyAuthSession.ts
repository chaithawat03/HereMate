/**
 * A server-confirmed owner STOP may update this screen only within the exact
 * Firebase User session that initiated it. Firebase UID equality is NOT enough:
 * sign-out followed by sign-in to the same account creates a new session.
 * This is a local UI/acknowledgement fence, never proof of remote revocation.
 */
export type EmergencyAuthSession=Readonly<{uid:string}>;
export function sameEmergencyAuthSession(
  expected:EmergencyAuthSession|null,
  current:EmergencyAuthSession|null,
  registered:EmergencyAuthSession|null,
  ownerUid:string|null,
  isForeground:boolean
):boolean{
  return expected!==null&&expected===current&&expected===registered&&
    expected.uid===ownerUid&&isForeground===true;
}
