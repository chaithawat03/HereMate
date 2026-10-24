/**
 * M2.3 real-location schematic (NOT mounted in App; backend not deployed).
 * Privacy boundary: read through a future verified per-friend Cloud Run
 * transport only, never directly from Firestore or a public location feed.
 */
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,AppState,Linking,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import {onAuthStateChanged} from 'firebase/auth';
import {getStagingGuestAuth} from '../auth/firebaseGuest';
import {listOwnRequests} from '../friends/firestoreFriends';
import type {FriendRequest} from '../friends/friendModel';
import {usePreferences} from '../ui/PreferencesProvider';
import type {Palette} from '../ui/preferencesModel';
import {createForegroundFriendMapPoller} from './androidFriendMapPoller';
import {loadAuthorizedFriendMap} from './accountScopedFriendMapRead';
import {androidGeoUri} from './androidGeoHandoff';
import {
  authorizedPeers,friendMapStates,plotLiveFriends,visibleFriendLocations,
  validatedRemoteFix,
  type ServerRead,type LiveFriend
} from './m2FriendLocationView';

export type M2FriendLocationTransport={
  /** MUST use viewer's verified token, server checks ACL on EVERY read. */
  read:(ownerUid:string)=>Promise<ServerRead>;
};
type Props={transport:M2FriendLocationTransport;backendReviewedAndEnabled:boolean};

export function M2FriendLocationPanel({transport,backendReviewedAndEnabled}:Props){
  const {colors:c,t,language}=usePreferences();
  const s=useMemo(()=>styles(c),[c]);
  const [friends,setFriends]=useState<FriendRequest[]>([]);
  const [positions,setPositions]=useState<Record<string,ServerRead>>({});
  const [loading,setLoading]=useState(false);
  const [failed,setFailed]=useState(false);
  const [autoRefreshing,setAutoRefreshing]=useState(false);
  const [now,setNow]=useState(Date.now());
  const session=useRef<string|null>(null);
  const epoch=useRef(0),alive=useRef(true),busy=useRef(false);
  const poller=useRef<ReturnType<typeof createForegroundFriendMapPoller>|null>(null);

  const clear=useCallback(()=>{
    poller.current?.stop();
    ++epoch.current;
    // Clear sensitive in-memory points on logout/background/unmount,
    // not only when the next UI rerender happens.
    if(alive.current){setPositions({});setFriends([]);setFailed(false);setLoading(false);}
    busy.current=false;
  },[]);
  useEffect(()=>{
    if(!backendReviewedAndEnabled)return;
    alive.current=true;
    const auth=getStagingGuestAuth();
    session.current=auth.currentUser?.uid??null;
    const sub=onAuthStateChanged(auth,u=>{
      const next=u?.uid??null;
      if(session.current!==next){session.current=next;clear();}
    },()=>{session.current=null;clear();});
    const app=AppState.addEventListener('change',state=>{
      if(state!=='active')clear();
    });
    return()=>{
      alive.current=false;
      ++epoch.current;
      sub();app.remove();
      session.current=null;
      clear();
    };
  },[backendReviewedAndEnabled,clear]);

  const refresh=useCallback(async()=>{
    if(!backendReviewedAndEnabled||busy.current||AppState.currentState!=='active')return;
    const uid=session.current;
    if(!uid||getStagingGuestAuth().currentUser?.uid!==uid)return;
    busy.current=true;
    const run=++epoch.current;
    setLoading(true);setFailed(false);setPositions({});setFriends([]);
    const current=()=>alive.current&&run===epoch.current&&
      session.current===uid&&getStagingGuestAuth().currentUser?.uid===uid&&
      AppState.currentState==='active';
    try{
      // One account-scoped read transaction. A direct Firebase account
      // change invalidates it even before the auth-state callback runs.
      // Every peer HTTP request still receives its own server-side ACL check.
      const snapshot=await loadAuthorizedFriendMap({
        viewerUid:uid,isCurrent:current,
        loadRelations:listOwnRequests,
        selectPeers:authorizedPeers,
        readPeer:peerUid=>transport.read(peerUid)
      });
      if(!snapshot||!current())return;
      setFriends(snapshot.relations);
      setPositions(snapshot.reads);
      setNow(Date.now());
      setFailed(snapshot.partialFailure);
    }catch{
      if(current()){setPositions({});setFriends([]);setFailed(true);}
    }finally{
      if(current()){busy.current=false;setLoading(false);}
    }
  },[backendReviewedAndEnabled,transport]);

  // Android/iOS friend-map updates require an explicit viewer opt-in.
  // Each read is server-authorized; stop on account switch, background,
  // unmount or user Stop. Never publish this viewer's GPS.
  useEffect(()=>{
    if(!backendReviewedAndEnabled||
       !['android','ios'].includes(Platform.OS))return;
    const controller=createForegroundFriendMapPoller({
      isSupportedPlatform:()=>Platform.OS==='android'||Platform.OS==='ios',
      isForeground:()=>AppState.currentState==='active',
      currentUid:()=>getStagingGuestAuth().currentUser?.uid??null,
      now:Date.now,
      scheduleInterval:(tick,ms)=>setInterval(tick,ms),
      cancelInterval:handle=>clearInterval(handle as ReturnType<typeof setInterval>),
      refresh,
      onActive:value=>{if(alive.current)setAutoRefreshing(value);}
    });
    poller.current=controller;
    return()=>{
      controller.dispose();
      if(poller.current===controller)poller.current=null;
    };
  },[backendReviewedAndEnabled,refresh]);

  // Ensure expired fixes vanish automatically; no background GPS polling.
  useEffect(()=>{
    if(!backendReviewedAndEnabled)return;
    const interval=setInterval(()=>{
      const time=Date.now();
      setNow(time);
      setPositions(previous=>{
        let changed=false;
        const fresh:Record<string,ServerRead>={};
        for(const [uid,data] of Object.entries(previous)){
          // Hold only a bounded 30s stale window for non-geographic status;
          // remove raw coordinates after it elapses (no persistence/history).
          if(data.expiresAtMs+30_000>time && data.point.capturedAtMs+60_000>time)
            fresh[uid]=data;
          else changed=true;
        }
        return changed?fresh:previous;
      });
    },1000);
    return()=>clearInterval(interval);
  },[backendReviewedAndEnabled]);

  const activeUid=backendReviewedAndEnabled&&AppState.currentState==='active'&&
    session.current===getStagingGuestAuth().currentUser?.uid?
    session.current:null;
  const liveLocations:LiveFriend[]=useMemo(()=>
    activeUid?visibleFriendLocations({
      viewerUid:activeUid,relations:friends,reads:positions,nowMs:now
    }):[],[activeUid,friends,positions,now]);
  const pins=useMemo(()=>plotLiveFriends(liveLocations),[liveLocations]);
  const states=useMemo(()=>activeUid?friendMapStates({viewerUid:activeUid,
    relations:friends,reads:positions,nowMs:now}):[],[activeUid,friends,positions,now]);

  function requestExternalMap(peerUid:string){
    const viewerUid=session.current;
    if(Platform.OS!=='android'||!backendReviewedAndEnabled||
       !viewerUid||getStagingGuestAuth().currentUser?.uid!==viewerUid||
       AppState.currentState!=='active'||
       !liveLocations.some(peer=>peer.peerUid===peerUid))return;
    // A native confirmation is required BEFORE revealing a private coordinate
    // to whichever external mapping app handles this Android geo intent.
    Alert.alert(
      language==='th'?'เปิดแอปแผนที่ภายนอก?':'Open an external Maps app?',
      language==='th'
        ?'พิกัดล่าสุดของเพื่อนจะถูกส่งไปยังแอปแผนที่ที่คุณเลือก โปรดเปิดเฉพาะเมื่อคุณต้องการ'
        :'The selected mapping app will receive your friend\'s latest coordinates. Continue only if you agree.',
      [
        {text:language==='th'?'ยกเลิก':'Cancel',style:'cancel'},
        {text:language==='th'?'เปิดแผนที่':'Open Maps',onPress:()=>{
          void (async()=>{
            try{
              if(!alive.current||session.current!==viewerUid||
                 AppState.currentState!=='active'||
                 !authorizedPeers(viewerUid,friends).some(p=>p.uid===peerUid))return;
              // Re-read AFTER confirmation. Cloud Run checks current M1
              // friendship, both consents and the active M2 grant on each call.
              // A revoked/stale fix must never be passed to an external app.
              const response=await transport.read(peerUid);
              if(!alive.current||session.current!==viewerUid||
                 getStagingGuestAuth().currentUser?.uid!==viewerUid||
                 AppState.currentState!=='active')return;
              const current=validatedRemoteFix(response,Date.now());
              const uri=current?androidGeoUri(
                current.point.latitude,current.point.longitude):null;
              if(!uri)throw Error('location_unavailable');
              await Linking.openURL(uri);
            }catch{
              if(alive.current&&session.current===viewerUid&&
                 AppState.currentState==='active')
                Alert.alert(
                  language==='th'?'ไม่สามารถเปิดแผนที่ได้':'Maps unavailable',
                  language==='th'
                    ?'ไม่พบตำแหน่งที่ยังได้รับอนุญาตหรือไม่มีแอปแผนที่ที่รองรับ'
                    :'No fresh authorized location or compatible Maps app is available.'
                );
            }
          })();
        }}
      ]
    );
  }

  if(!backendReviewedAndEnabled)return <View style={s.panel}>
    <Text style={s.title}>{t('m2MapTitle')}</Text>
    <Text style={s.note}>{t('m2Unavailable')}</Text>
  </View>;

  return <View style={s.panel}>
    <Text style={s.title}>{t('m2MapTitle')}</Text>
    <Text style={s.note}>{t('m2MapPrivacy')}</Text>
    <Pressable accessibilityRole="button" disabled={loading||autoRefreshing} style={s.refresh}
      onPress={()=>void refresh()}>
      <Text style={s.refreshText}>{loading?t('m2MapLoading'):t('m2MapRefresh')}</Text>
    </Pressable>
    {(Platform.OS==='android'||Platform.OS==='ios')?<View style={s.pollArea}>
      <Text style={s.note}>{language==='th'
        ?'อัปเดตตำแหน่งเพื่อนเฉพาะตอนเปิดแอป เมื่อคุณกดเริ่มเท่านั้น ตรวจซ้ำทุก 30 วินาที ไม่ส่ง GPS ของคุณ'
        :'Optional foreground-only friend map updates every 30 seconds. Reads authorized friends only; does not share your GPS.'}</Text>
      <Pressable accessibilityRole="button" style={s.refresh}
        onPress={()=>{
          if(autoRefreshing)poller.current?.stop();
          else poller.current?.start();
        }}>
        <Text style={s.refreshText}>{autoRefreshing?
          (language==='th'?'หยุดอัปเดตอัตโนมัติ':'Stop live updates'):
          (language==='th'?'เริ่มอัปเดตอัตโนมัติ':'Start live updates')}</Text>
      </Pressable>
    </View>:null}
    {failed?<Text accessibilityRole="alert" style={s.error}>{t('m2MapUnavailable')}</Text>:null}
    {pins.length>0?<View style={s.plot} accessibilityLabel={t('m2MapSchematic')}>
      <View style={s.verticalLine}/>
      <View style={s.horizontalLine}/>
      <Text style={s.north}>{t('m2MapNorth')}</Text>
      {pins.map(pin=><View key={pin.peerUid} style={[s.pin,{
        left:`${pin.xPercent}%`,top:`${pin.yPercent}%`
      }]}>
        <Text style={s.pinText} numberOfLines={1}>{pin.displayName}</Text>
      </View>)}
    </View>:<Text style={s.note}>{t('m2MapNoFreshFix')}</Text>}
    {states.map(friend=><View key={friend.peerUid} style={s.card}>
      <Text style={s.name}>{friend.displayName}</Text>
      <Text style={s.note}>{t(friend.status==='LIVE'?'m2StatusLive':
        friend.status==='STALE'?'m2StatusStale':
        friend.status==='SHARING_OFF'?'m2StatusSharingOff':'m2StatusUnavailable')}</Text>
    </View>)}
    {pins.map(pin=><View key={pin.peerUid} style={s.card}>
      <Text style={s.name}>{pin.displayName}</Text>
      <Text style={s.note}>{t('m2MapAccuracy')}: ±{Math.round(pin.accuracyMeters)} {t('meter')}</Text>
      <Text style={s.note}>{t('m2MapUpdated')}: {Math.max(0,Math.floor((now-pin.capturedAtMs)/1000))} {t('secondsUnit')}</Text>
      {Platform.OS==='android'?<Pressable accessibilityRole="button"
        style={s.refresh} onPress={()=>requestExternalMap(pin.peerUid)}>
        <Text style={s.refreshText}>{language==='th'
          ?'เปิดตำแหน่งในแอปแผนที่':'Open location in Maps'}</Text>
      </Pressable>:null}
    </View>)}
    <Text style={s.note}>{t('m2MapSchematic')}</Text>
  </View>;
}
const styles=(c:Palette)=>StyleSheet.create({
  panel:{backgroundColor:c.surface,borderRadius:15,padding:16,borderColor:c.line,borderWidth:1,gap:12},
  title:{color:c.accent,fontWeight:'800',fontSize:17},
  note:{color:c.muted,fontSize:12,lineHeight:19},
  error:{color:c.error,fontSize:12},
  pollArea:{padding:11,borderRadius:11,borderColor:c.line,borderWidth:1,gap:8},
  refresh:{alignSelf:'flex-start',padding:10,borderRadius:10,backgroundColor:c.accent},
  refreshText:{fontSize:13,color:c.accentOn,fontWeight:'800'},
  plot:{height:220,borderColor:c.line,borderWidth:1,borderRadius:14,
    backgroundColor:c.map,overflow:'hidden'},
  verticalLine:{position:'absolute',height:'100%',width:1,left:'50%',backgroundColor:c.road},
  horizontalLine:{position:'absolute',width:'100%',height:1,top:'50%',backgroundColor:c.road},
  north:{position:'absolute',top:8,right:10,fontSize:12,fontWeight:'700',color:c.text},
  pin:{position:'absolute',transform:[{translateX:-25},{translateY:-8}],padding:6,
    borderRadius:9,backgroundColor:c.accent,maxWidth:110,minWidth:50},
  pinText:{fontSize:11,fontWeight:'800',color:c.accentOn},
  card:{borderWidth:1,borderColor:c.line,backgroundColor:c.surfaceAlt,borderRadius:10,padding:10,gap:3},
  name:{color:c.text,fontWeight:'800',fontSize:13},
});
