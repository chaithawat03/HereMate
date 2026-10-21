import { getApp } from 'firebase/app';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getStagingGuestAuth } from '../auth/firebaseGuest';
import { firebaseStagingIdentity } from '../config/firebaseStaging';
import { normalizeDisplayName, type PrivateProfile } from './profileModel';

/** No arbitrary UID input: every Firestore document path comes from Firebase Auth. */
function ownProfileRef() {
  const auth = getStagingGuestAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('NOT_SIGNED_IN');
  const app = getApp();
  if (app.options.projectId !== firebaseStagingIdentity.projectId)
    throw new Error('WRONG_STAGING_PROJECT');
  return doc(getFirestore(app), 'users', uid);
}
export async function loadOwnProfile(): Promise<PrivateProfile | null> {
  const snap = await getDoc(ownProfileRef());
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.schemaVersion !== 1 || data.shareLocation !== false ||
      typeof data.displayName !== 'string')
    throw new Error('INVALID_PROFILE');
  return { displayName: normalizeDisplayName(data.displayName), shareLocation: false, schemaVersion: 1 };
}
export async function createOwnProfile(input: string): Promise<PrivateProfile> {
  const displayName = normalizeDisplayName(input);
  await setDoc(ownProfileRef(), {
    displayName, schemaVersion: 1, shareLocation: false,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  return { displayName, schemaVersion: 1, shareLocation: false };
}
export async function renameOwnProfile(input: string): Promise<PrivateProfile> {
  const displayName = normalizeDisplayName(input);
  await updateDoc(ownProfileRef(), { displayName, updatedAt: serverTimestamp() });
  return { displayName, schemaVersion: 1, shareLocation: false };
}
