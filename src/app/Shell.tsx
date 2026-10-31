import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BackHandler, StatusBar, View } from 'react-native';
import { useHereMate } from '../data/ModeProvider';
import type { LatLng, Mode, Zone } from '../data/types';
import { useV2 } from './i18n';
import { initialNav, navReducer, type Route } from './nav';
import { useCaps, useFriends, useMyPosition, useNow, usePlaces, usePoints, useSession, useSharing } from './useData';
import { MapScreen, FriendsSheet } from './screens/Home';
import { FriendDetail } from './screens/FriendDetail';
import { SignIn } from './screens/SignIn';
import { PlacesSheet, NewPlace } from './screens/Places';
import { MeScreen } from './screens/Me';
import { AddFriend } from './screens/AddFriend';
import { PermissionPrimer } from './screens/PermissionPrimer';
import { BackgroundConsent } from './screens/BackgroundConsent';
import { TabBar, Toast } from './components/Controls';
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
  const [preview, setPreview] = useState<Zone | null>(null);
  const primedForeground = useRef(false);
  const caps = useCaps();
  const { friends, requests } = useFriends();
  const { points, connected } = usePoints();
  const sharing = useSharing();
  const { zones, alerts } = usePlaces();
  const { at: me } = useMyPosition();
  const now = useNow();

  useEffect(() => { dispatch({ type: 'reset' }); setSnap('half'); primedForeground.current = false; }, [source]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nav.stack.length) { dispatch({ type: 'pop' }); return true; }
      return false;
    });
    return () => sub.remove();
  }, [nav.stack.length]);

  const top: Route | undefined = nav.stack[nav.stack.length - 1];
  const selected = top?.screen === 'friend' ? friends.find(f => f.id === top.id) ?? null : null;
  const selectedPoint = selected ? points.find(p => p.friendId === selected.id) : undefined;
  const focus: LatLng | null = selectedPoint?.at ?? preview?.center ?? null;

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

  const startForeground = useCallback((friendId: string) => {
    // Live: explain once per session before Android asks for location.
    if (mode === 'live' && !primedForeground.current) {
      dispatch({ type: 'push', route: { screen: 'primer', kind: 'foreground', friendId } });
      return;
    }
    void safely(() => source.location.startForeground(friendId), t('sharingOn'));
  }, [mode, safely, source, t]);

  const startBackgroundFlow = useCallback((friendId: string) => {
    dispatch({ type: 'push', route: { screen: 'primer', kind: 'background', friendId } });
  }, []);

  const sheet = useMemo(() => {
    if (nav.tab === 'places') {
      if (top?.screen === 'newPlace') {
        return (
          <NewPlace friends={friends} points={points} me={me} initialFriendId={top.friendId} onPreview={setPreview}
            onCancel={() => dispatch({ type: 'pop' })}
            onDone={m => { setToast(m); dispatch({ type: 'pop' }); }} />
        );
      }
      return (
        <PlacesSheet caps={caps} zones={zones} alerts={alerts} friends={friends} now={now} onToast={setToast}
          onAdd={() => { dispatch({ type: 'push', route: { screen: 'newPlace' } }); setSnap('half'); }} />
      );
    }
    if (selected) {
      return (
        <FriendDetail
          friend={selected} point={selectedPoint} me={me} now={now} caps={caps} sharing={sharing}
          onClose={() => dispatch({ type: 'pop' })}
          onShare={() => startForeground(selected.id)}
          onStopSharing={() => safely(async () => {
            if (sharing.background?.withId === selected.id) await source.location.stopBackground();
            if (sharing.foregroundWith === selected.id) await source.location.stop();
          })}
          onAlerts={() => dispatch(caps.geofences
            ? { type: 'tab', tab: 'places', then: { screen: 'newPlace', friendId: selected.id } }
            : { type: 'tab', tab: 'places' })}
          onWave={() => safely(() => source.wave(selected.id), t('waved', { name: selected.name }))}
          onConsent={on => safely(() => source.friends.setConsent(selected.id, on))}
          onRemove={() => safely(async () => { await source.friends.remove(selected.id); dispatch({ type: 'pop' }); })}
        />
      );
    }
    return (
      <FriendsSheet
        friends={friends} points={points} me={me} now={now}
        sharingWith={sharing.foregroundWith ?? sharing.background?.withId ?? null}
        incomingCount={requests.filter(r => r.direction === 'incoming').length}
        onSelect={id => { dispatch({ type: 'push', route: { screen: 'friend', id } }); setSnap('half'); }}
        onAddFriend={() => dispatch({ type: 'push', route: { screen: 'addFriend' } })}
      />
    );
  }, [nav.tab, top, selected, selectedPoint, me, now, caps, sharing, friends, points, requests, zones, alerts, source, safely, startForeground, t]);

  if (!session) return <SignIn onSignedIn={refresh} />;

  // Full-screen overlays.
  if (top?.screen === 'addFriend') {
    return <AddFriend requests={requests} onClose={() => dispatch({ type: 'pop' })} onToast={setToast} />;
  }
  if (top?.screen === 'primer') {
    const friendId = top.friendId;
    return (
      <PermissionPrimer kind={top.kind} denied={top.denied}
        onCancel={() => dispatch({ type: 'pop' })}
        onContinue={() => {
          dispatch({ type: 'pop' });
          if (top.kind === 'foreground' && friendId) {
            primedForeground.current = true;
            void safely(() => source.location.startForeground(friendId), t('sharingOn'));
          } else if (top.kind === 'background' && friendId) {
            dispatch({ type: 'push', route: { screen: 'backgroundConsent', friendId } });
          }
        }} />
    );
  }
  if (top?.screen === 'backgroundConsent') {
    const friend = friends.find(f => f.id === top.friendId);
    if (friend) {
      return (
        <BackgroundConsent friend={friend}
          onCancel={() => dispatch({ type: 'pop' })}
          onDone={m => { setToast(m); dispatch({ type: 'pop' }); }}
          onPermissionDenied={() => {
            dispatch({ type: 'pop' });
            dispatch({ type: 'push', route: { screen: 'primer', kind: 'background', friendId: friend.id, denied: true } });
          }} />
      );
    }
  }

  const zonesOnMap = nav.tab === 'places' ? (preview ? [...zones, preview] : zones) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <StatusBar barStyle={c.statusBar} translucent backgroundColor="transparent" />
      {nav.tab === 'me' ? (
        <MeScreen caps={caps} sharing={sharing} friends={friends} onMode={onMode} onToast={setToast}
          onPickFriendToShare={() => dispatch({ type: 'tab', tab: 'friends' })}
          onStartBackground={startBackgroundFlow} />
      ) : (
        <MapScreen
          points={points} friends={friends} connected={connected} me={me}
          zones={zonesOnMap}
          selectedId={selected?.id ?? null} focus={focus}
          onSelectFriend={id => { dispatch({ type: 'tab', tab: 'friends', then: { screen: 'friend', id } }); setSnap('half'); }}
          onRetry={() => { /* the poller retries on its own schedule */ }}
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
