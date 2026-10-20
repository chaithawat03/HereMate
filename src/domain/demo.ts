/** Synthetic UX data only. No physical GPS and no network operations. */
export type FriendStatus = 'LIVE' | 'STALE' | 'OFFLINE' | 'SHARING_OFF';
export type DemoFriend = { id: string; name: string; username: string; status: FriendStatus; lastGpsSeconds: number | null; x: number; y: number };
const names = ['Ton', 'Fon', 'Boy', 'Nan', 'May', 'Somchai', 'Aom', 'Bee', 'Mint', 'Ploy'];
const statuses: FriendStatus[] = ['LIVE', 'LIVE', 'STALE', 'OFFLINE', 'SHARING_OFF'];
export function makeDemoFriends(requested: number): DemoFriend[] {
  const count = Math.max(0, Math.min(1000, Math.floor(Number.isFinite(requested) ? requested : 0)));
  return Array.from({ length: count }, (_, i) => {
    const status = statuses[i % statuses.length];
    return {
      id: 'demo-' + (i + 1), name: names[i % names.length] + ' ' + (i + 1),
      username: '@friend' + String(i + 1).padStart(4, '0'), status,
      lastGpsSeconds: status === 'LIVE' ? 4 + (i % 15) : status === 'STALE' ? 75 + (i % 100) : null,
      x: 10 + ((i * 37) % 80), y: 12 + ((i * 53) % 76),
    };
  });
}
export function searchableFriends(friends: DemoFriend[], text: string, filter: 'ALL' | FriendStatus = 'ALL'): DemoFriend[] {
  const q = text.trim().toLowerCase();
  return friends.filter(f => (filter === 'ALL' || f.status === filter) &&
    (!q || f.name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q)));
}
export function visibleMapFriends(friends: DemoFriend[], sharingEnabled: boolean): DemoFriend[] {
  // Prototype-only visibility; real authorization belongs to the backend.
  if (!sharingEnabled) return [];
  return friends.filter(f => (f.status === 'LIVE' || f.status === 'STALE') &&
    f.lastGpsSeconds !== null && f.lastGpsSeconds <= 900);
}
