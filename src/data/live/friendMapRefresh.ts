// One authorized friend-map refresh. A friend who is not sharing makes the server deny
// that single read (partialFailure) — that is normal, not a connection problem, so the
// successful reads are always delivered. Only a failed load is reported as an error.
import type { LiveSnapshot } from './liveDataSource.ts';
import type { FriendRequest } from '../../friends/friendModel.ts';

export type MapLoadResult = { relations: FriendRequest[]; reads: Record<string, unknown>; partialFailure: boolean } | null;

export async function refreshFriendMap(p: {
  load: () => Promise<MapLoadResult>;
  viewerUid: string;
  now: () => number;
  isCurrent: () => boolean;
  onSnapshot: (s: LiveSnapshot) => void;
  onError: () => void;
}): Promise<void> {
  let snap: MapLoadResult;
  try {
    snap = await p.load();
  } catch {
    if (p.isCurrent()) p.onError();
    return;
  }
  if (!snap || !p.isCurrent()) return;
  p.onSnapshot({ viewerUid: p.viewerUid, relations: snap.relations, reads: snap.reads, nowMs: p.now() });
}
