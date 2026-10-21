/**
 * M1.1 Google identity transition policy. This file has no Firebase or native
 * SDK imports so collision/UID invariants can be tested entirely offline.
 * ID tokens MUST be obtained by a trusted, user-initiated native Google provider.
 */
export type Identity = Readonly<{uid: string; isAnonymous: boolean; providerIds: readonly string[]}>;
export type Result =
  | {kind: 'linked'; uid: string}
  | {kind: 'signed-in'; uid: string}
  | {kind: 'already-google'; uid: string}
  | {kind: 'different-provider'}
  | {kind: 'collision'}
  | {kind: 'cancelled'}
  | {kind: 'session-changed'}
  | {kind: 'unavailable'};

export type GooglePorts = {
  current(): Identity | null;
  linkAnonymous(expectedUid: string, idToken: string): Promise<Identity>;
  signIn(idToken: string): Promise<Identity>;
};

export function decideGoogleAction(account: Identity | null): 'link' | 'sign-in' | 'already' | 'block' {
  if (account === null) return 'sign-in';
  if (!account.uid) return 'block';
  if (account.isAnonymous) return 'link';
  if (account.providerIds.includes('google.com')) return 'already';
  return 'block'; // No implicit switch/merge of accounts with other providers.
}

export function safeGoogleFailure(error: unknown): Result {
  const code=(error as {code?:unknown} | null)?.code;
  if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use' ||
      code === 'auth/account-exists-with-different-credential') return {kind:'collision'};
  if (code === 'SIGN_IN_CANCELLED' || code === '12501' ||
      code === 'auth/popup-closed-by-user') return {kind:'cancelled'};
  return {kind:'unavailable'};
}

export async function runGoogleIdentityFlow(
  ports: GooglePorts,
  obtainNativeGoogleIdToken: () => Promise<string | null>,
): Promise<Result> {
  const before=ports.current();
  const action=decideGoogleAction(before);
  if (action === 'already') return {kind:'already-google',uid:before!.uid};
  if (action === 'block') return {kind:'different-provider'};
  let idToken: string | null;
  try { idToken=await obtainNativeGoogleIdToken(); }
  catch (error) { return safeGoogleFailure(error); }
  if (idToken === null) return {kind:'cancelled'};
  if (typeof idToken !== 'string' || idToken.length < 16 || idToken.length > 16384)
    return {kind:'unavailable'};
  const now=ports.current();
  if (before?.uid !== now?.uid || before?.isAnonymous !== now?.isAnonymous ||
      (before === null) !== (now === null)) return {kind:'session-changed'};
  try {
    if (action === 'link') {
      // Never call signIn() on an anonymous account, especially on a collision:
      // that would abandon the previous Guest UID and its Firestore profile.
      const result=await ports.linkAnonymous(before!.uid,idToken);
      return result.uid === before!.uid && !result.isAnonymous
        ? {kind:'linked',uid:before!.uid} : {kind:'session-changed'};
    }
    const result=await ports.signIn(idToken);
    return result.uid && !result.isAnonymous
      ? {kind:'signed-in',uid:result.uid} : {kind:'unavailable'};
  } catch(error) { return safeGoogleFailure(error); }
}
