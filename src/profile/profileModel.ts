/** M1.0 private owner profile: deliberately no phone, email or GPS fields. */
export type PrivateProfile = Readonly<{ displayName: string; shareLocation: false; schemaVersion: 1 }>;

export function normalizeDisplayName(input: string): string {
  const name = input.trim();
  if (name.length < 2 || name.length > 32 || /[\r\n]/.test(name))
    throw new Error('ชื่อที่แสดงต้องมี 2–32 ตัวอักษร และไม่ขึ้นบรรทัดใหม่');
  return name;
}
