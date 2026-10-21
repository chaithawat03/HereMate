/**
 * Staging-only Firebase Google identity bridge. The native Google OAuth SDK
 * and its EAS SHA-1/client-ID configuration are deliberately NOT wired yet.
 * No caller may pass an ID token from a text field, URL or arbitrary backend.
 * Provider integration must supply a token via a user-initiated native picker.
 */
import { GoogleAuthProvider, linkWithCredential, signInWithCredential, type User } from 'firebase/auth';
import { getStagingGuestAuth } from './firebaseGuest';
import { runGoogleIdentityFlow, type Identity, type Result } from './googleAccountFlow';

const toIdentity=(user:User):Identity=>({
  uid:user.uid, isAnonymous:user.isAnonymous,
  providerIds:user.providerData.map(p=>p.providerId),
});

export async function continueStagingGoogleWithNativeToken(
  obtainNativeGoogleIdToken: () => Promise<string | null>,
): Promise<Result> {
  const auth=getStagingGuestAuth(); // Auth singleton checks the exact staging Firebase project.
  return runGoogleIdentityFlow({
    current:()=>auth.currentUser ? toIdentity(auth.currentUser) : null,
    linkAnonymous:async(expectedUid,idToken)=>{
      const user=auth.currentUser;
      if (!user || !user.isAnonymous || user.uid !== expectedUid) {
        throw {code:'identity/session-changed'};
      }
      const result=await linkWithCredential(user,GoogleAuthProvider.credential(idToken));
      return toIdentity(result.user);
    },
    signIn:async idToken=>{
      if (auth.currentUser) throw {code:'identity/session-changed'};
      const result=await signInWithCredential(auth,GoogleAuthProvider.credential(idToken));
      return toIdentity(result.user);
    },
  }, obtainNativeGoogleIdToken);
}
