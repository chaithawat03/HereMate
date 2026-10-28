/** A Firebase UID alone is not a viewer session.
 * Sign-out and sign-in to the same account must retire old private map reads
 * and pending external Maps handoffs. No token or GPS is stored here.
 */
const UID=/^[A-Za-z0-9_-]{12,128}$/;
export type ViewerSessionUser=Readonly<{uid:string}>;
export function sameViewerSession(
 expected:ViewerSessionUser|null,current:ViewerSessionUser|null
):boolean {
 return expected!==null&&current===expected&&UID.test(expected.uid);
}
