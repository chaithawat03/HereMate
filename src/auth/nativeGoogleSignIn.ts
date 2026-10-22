/** TypeScript + unsupported-platform fallback. Metro Android resolves *.android.ts. */
export async function obtainNativeGoogleIdToken(): Promise<string | null> {
  throw new Error('GOOGLE_SIGNIN_ANDROID_ONLY');
}
