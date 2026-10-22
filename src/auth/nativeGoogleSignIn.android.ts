/** Google picker is Android-only and can run only after an explicit user action.
 * Never store or log the Google ID token or request offline refresh tokens.
 */
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { googleStagingWebClientId } from '../config/googleStaging';

export async function obtainNativeGoogleIdToken(): Promise<string | null> {
  GoogleSignin.configure({webClientId:googleStagingWebClientId,offlineAccess:false});
  await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog:true});
  const response=await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return null;
  if (!response.data.idToken) throw new Error('GOOGLE_ID_TOKEN_MISSING');
  return response.data.idToken;
}
