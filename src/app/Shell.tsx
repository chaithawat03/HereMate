import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { StatusBar, View } from 'react-native';
import { useHereMate } from '../data/ModeProvider';
import type { LatLng, Mode } from '../data/types';
import { useV2 } from './i18n';
import { initialNav, navReducer, type Route } from './nav';
import { useCaps, useFriends, useMyPosition, useNow, usePlaces, usePoints, useSession, useSharing } from './useData';
import { MapScreen, FriendsSheet } from './screens/Home';
import { FriendDetail } from './screens/FriendDetail';
import { SignIn } from './screens/SignIn';
import { ComingSoon, TabBar, Toast } from './components/Controls';
import type { Snap } from './components/BottomSheet';

const TAB_BAR_HEIGHT = 64;

export function Shell() {
  const { t, c } = useV2();
  const { source, mode, switchTo } = useHereMate();
  const { session, refresh } = useSession();
  const [nav, dispatch] = useReducer(navReducer, initialNav);
  const [snap, setSnap] = useState<Snap>('half');
  const [toast, setToast] = useState<string | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const caps = useCaps();
  const { friends, requests } = useFriends();
  const { points, connected } = usePoints();
  const sharing = useSharing();
  const { zones } = usePlaces();
  const { at: me } = useMyPosition();
  const now = useNow();

  useEffect(() => { dispatch({ type: 'reset' }); setSnap('half'); }, [source]);

  const top: Route | undefined = nav.stack[nav.stack.length - 1];
  const selected = top?.screen === 'friend' ? friends.find(f => f.id === top.id) ?? null : null;
  const selectedPoint = selected ? points.find(p => p.friendId === selected.id) : undefined;
  const focus: LatLng | null = selectedPoint?.at ?? null;

  const safely = useCallback(async (action: () => Promise<unknown>, ok?: string) => {
    try { await action(); if (ok) setToast(ok); } catch { setToast(t('errorGeneric')); }
  }, [t]);

  const onMode = useCallback(async (m: Mode) => {
    setModeBusy(true);
    try {
      const r = await switchTo(m);
      if (r.stopTimedOut) setToast(t('stopTimedOut'));
    } finally { setModeBusy(false); }
  }, [switchTo, t]);

  const sheet = useMemo(() => {
    if (nav.tab === 'friends' && selected) {
      return (
        <FriendDetail
          friend={selected} point={selectedPoint} me={me} now={now} caps={caps} sharing={sharing}
          onClose={() => dispatch({ type: 'pop' })}
          onShare={() => safely(() => source.location.startForeground(selected.id), t('sharingOn'))}
          onStopSharing={() => safely(async () => {
            if (sharing.background?.withId === selected.id) await source.location.stopBackground();
            if (sharing.foregroundWith === selected.id) await source.location.stop();
          })}
          onAlerts={() => dispatch({ type: 'tab', tab: 'places', then: { screen: 'newPlace', friendId: selected.id } })}
          onWave={() => safely(() => source.wave(selected.id), t('waved', { name: selected.name }))}
          onConsent={on => safely(() => source.friends.setConsent(selected.id, on))}
          onRemove={() => safely(async () => { await source.friends.remove(selected.id); dispatch({ type: 'pop' }); })}
        />
      );
    }
    if (nav.tab === 'friends') {
      return (
        <FriendsSheet
          friends={friends} points={points} me={me} now={now}
          sharingWith={sharing.foregroundWith ?? sharing.background?.withId ?? null}
          incomingCount={requests.filter(r => r.direction === 'incoming').length}
          onSelect={id => { dispatch({ type: 'push', route: { screen: 'friend', id } }); setSnap('half'); }}
          onAddFriend={() => dispatch({ type: 'push', route: { screen: 'addFriend' } })}
        />
      );
    }
    return <View style={{ padding: 18 }}><ComingSoon /></View>;
  }, [nav, selected, selectedPoint, me, now, caps, sharing, friends, points, requests, source, safely, t]);

  if (!session) {
    return <SignIn onSignedIn={refresh} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <StatusBar barStyle={c.statusBar} translucent backgroundColor="transparent" />
      {nav.tab === 'me' ? (
        <View style={{ flex: 1, padding: 18, paddingTop: 64 }}><ComingSoon /></View>
      ) : (
        <MapScreen
          points={points} friends={friends} connected={connected} me={me}
          zones={nav.tab === 'places' ? zones : null}
          selectedId={selected?.id ?? null} focus={focus}
          onSelectFriend={id => { dispatch({ type: 'tab', tab: 'friends', then: { screen: 'friend', id } }); setSnap('half'); }}
          onRetry={() => { /* polling retries on its own; re-render keeps the banner honest */ }}
          modeBusy={modeBusy} onMode={onMode}
          snap={snap} onSnap={setSnap} sheet={sheet} bottomInset={TAB_BAR_HEIGHT}
        />
      )}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <TabBar tab={nav.tab} onTab={tab => dispatch({ type: 'tab', tab })} />
      </View>
      <Toast message={toast} onDone={() => setToast(null)} />
    </View>
  );
}
