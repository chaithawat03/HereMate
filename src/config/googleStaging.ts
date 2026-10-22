/** Public OAuth Web Client ID, extracted from owner Firebase Android JSON.
 * This is an OAuth CLIENT ID, not a secret, token, or service-account key.
 */
export const googleStagingWebClientId =
  '976775896533-9omdv4lmvpamn6djp37jepm0f7i47srr.apps.googleusercontent.com' as const;
export const googleStagingAndroidSha1 =
  '203f89bb96a20c39a157341611dacb5dead88d15' as const;
export function assertAndroidGoogleStagingConfig(data: {
  project_info?: { project_number?: string; project_id?: string };
  client?: Array<{ client_info?: { mobilesdk_app_id?: string; android_client_info?: { package_name?: string } };
    oauth_client?: Array<{ client_type: number; client_id: string; android_info?: {package_name: string; certificate_hash: string} }> }>;
}): void {
  const app = data.client?.find(c => c.client_info?.android_client_info?.package_name === 'com.chaithawat03.heremate');
  const android = app?.oauth_client?.find(c => c.client_type === 1);
  const web = app?.oauth_client?.find(c => c.client_type === 3);
  if (data.project_info?.project_id !== 'heremate' ||
    data.project_info.project_number !== '976775896533' ||
    app?.client_info?.mobilesdk_app_id !== '1:976775896533:android:a34f7f3aa147c2bcaa315c' ||
    android?.android_info?.package_name !== 'com.chaithawat03.heremate' ||
    android?.android_info?.certificate_hash.toLowerCase() !== googleStagingAndroidSha1 ||
    web?.client_id !== googleStagingWebClientId) {
    throw new Error('GOOGLE_ANDROID_STAGING_CONFIGURATION_MISMATCH');
  }
}
