/**
 * M2.3 real-location schematic (NOT mounted in App; backend not deployed).
 * Privacy boundary: read through a future verified per-friend Cloud Run
 * transport only, never directly from Firestore or a public location feed.
 */
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AppState,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import {onAuthStateChanged} from 'firebase/auth';
import {getStagingGuestAuth} from '../auth/firebaseGuest';
import {listOwnRequests} from '../friends/firestoreFriends';
import type {FriendRequest} from '../friends/friendModel';
import {usePreferences} from '../ui/PreferencesProvider';
import type {Palette} from '../ui/preferencesModel';
import {createAndroidFriendMapPoller} from './androidFriendMapPoller';
import {
  authorizedPeers,friendMapStates,plotLiveFriends,visibleFriendLocations,MAX_MAP_FRIEND_READS,
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
  const poller=useRef<ReturnType<typeof createAndroidFriendMapPoller>|null>(null);

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
    if(!uid)return;
    busy.current=true;
    const run=++epoch.current;
    setLoading(true);setFailed(false);setPositions({});setFriends([]);
    const current=()=>alive.current&&run===epoch.current&&
      session.current===uid&&AppState.currentState==='active';
    try{
      const relationRows=await listOwnRequests();
      if(!current())return;
      const eligible=[...authorizedPeers(uid,relationRows)]
        .sort((a,b)=>a.uid.localeCompare(b.uid)).slice(0,MAX_MAP_FRIEND_READS);
      // Every selected friend's location comes from a separate authenticated
      // backend read, not a broad Firestore query. Failure never shows a
      // cached coordinate from a previous account or refresh.
      const outcomes=await Promise.allSettled(eligible.map(async peer=>({
        uid:peer.uid,response:await transport.read(peer.uid)
      })));
      if(!current())return;
      const live:Record<string,ServerRead>={};
      let unavailable=false;
      for(const row of outcomes){
        if(row.status==='rejected'){unavailable=true;continue;}
        live[row.value.uid]=row.value.response;
      }
      setFriends(relationRows);
      setPositions(live);
      setNow(Date.now());
      setFailed(unavailable);
    }catch{
      if(current()){setPositions({});setFriends([]);setFailed(true);}
    }finally{
      if(current()){busy.current=false;setLoading(false);}
    }
  },[backendReviewedAndEnabled,transport]);

  // Android map updates are explicitly started by the viewer. This is
  // read-only, at most eight server-authorized friend reads every 30 seconds,
  // and stops on account switch, background, unmount or user Stop.
  useEffect(()=>{
    if(!backendReviewedAndEnabled||Platform.OS!=='android')return;
    const controller=createAndroidFriendMapPoller({
      isAndroid:()=>Platform.OS==='android',
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

  const activeUid=session.current;
  const liveLocations:LiveFriend[]=useMemo(()=>
    activeUid?visibleFriendLocations({
      viewerUid:activeUid,relations:friends,reads:positions,nowMs:now
    }):[],[activeUid,friends,positions,now]);
  const pins=useMemo(()=>plotLiveFriends(liveLocations),[liveLocations]);
  const states=useMemo(()=>activeUid?friendMapStates({viewerUid:activeUid,
    relations:friends,reads:positions,nowMs:now}):[],[activeUid,friends,positions,now]);

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
    {Platform.OS==='android'?<View style={s.pollArea}>
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
