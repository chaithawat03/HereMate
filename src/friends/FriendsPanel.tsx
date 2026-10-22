import React, {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {usePreferences} from '../ui/PreferencesProvider';
import type {Palette} from '../ui/preferencesModel';
import {
  ownInviteCode,listOwnRequests,sendFriendRequest,actOnRequest,setOwnFriendConsent,
} from './firestoreFriends';
import {otherParticipant,relationView,type FriendRequest} from './friendModel';

/** Staging-only M1 invite-code friends. Never accesses phone contacts or live GPS. */
export function FriendsPanel() {
  const {t,colors:c}=usePreferences();
  const s=useMemo(()=>styles(c),[c]);
  const alive=useRef(true);
  const [code,setCode]=useState('');
  const [invite,setInvite]=useState('');
  const [requests,setRequests]=useState<FriendRequest[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<'friendDone'|'friendError'|'friendProfileRequired'|null>(null);
  const refresh=useCallback(async()=>{
    try {
      const entries=await listOwnRequests();
      if(alive.current)setRequests(entries);
    } catch {
      if(alive.current)setMessage('friendError');
    }
  },[]);
  useEffect(()=>{
    alive.current=true;
    try {setCode(ownInviteCode());} catch {setMessage('friendError');}
    void refresh();
    return()=>{alive.current=false;};
  },[refresh]);
  async function execute(job:()=>Promise<void>) {
    if(busy||!alive.current)return;
    setBusy(true);
    setMessage(null);
    try {
      await job();
      if(alive.current){
        setInvite('');
        await refresh();
        if(alive.current)setMessage('friendDone');
      }
    } catch (error) {
      if(alive.current)setMessage((error as Error)?.message==='PROFILE_REQUIRED'
        ? 'friendProfileRequired':'friendError');
    } finally {
      if(alive.current)setBusy(false);
    }
  }
  const visible=requests.filter(r=>r.status==='pending'||r.status==='accepted');
  return <View style={s.panel}>
    <Text style={s.title}>{t('friendTitle')}</Text>
    <Text style={s.note}>{t('friendInviteNote')}</Text>
    <Text style={s.label}>{t('friendYourCode')}</Text>
    <Text style={s.code} selectable accessibilityLabel={t('friendYourCode')}>{code}</Text>
    <Text style={s.note}>{t('friendCodeHelp')}</Text>
    <TextInput accessibilityLabel={t('friendInviteInput')} autoCapitalize="none"
      value={invite} onChangeText={setInvite} maxLength={128}
      placeholder={t('friendInviteInput')} placeholderTextColor={c.placeholder}
      style={s.input} editable={!busy}/>
    <View style={s.row}>
      <Pressable accessibilityRole="button" onPress={()=>void execute(()=>sendFriendRequest(invite))}
        disabled={busy||!invite.trim()} style={s.button}>
        <Text style={s.buttonText}>{t('friendSend')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={()=>void refresh()} style={s.secondary}>
        <Text style={s.secondaryText}>{t('friendRefresh')}</Text>
      </Pressable>
    </View>
    {message?<Text accessibilityRole="alert" style={s.note}>{t(message)}</Text>:null}
    {visible.length===0?<Text style={s.note}>{t('friendEmpty')}</Text>:null}
    {visible.map(r=>{
      const type=relationView(r,code);
      const other=otherParticipant(r,code);
      const ownConsent=code===r.senderUid?r.senderConsent:r.recipientConsent;
      const otherConsent=code===r.senderUid?r.recipientConsent:r.senderConsent;
      return <View key={r.id} style={s.item}>
        <Text style={s.name}>{other.displayName}</Text>
        <Text style={s.note}>{type==='friend'?t('friendAccepted')
          :type==='incoming'?t('friendIncoming'):t('friendOutgoing')}</Text>
        {type==='friend'?<>
          <Text style={s.note}>{t('friendConsentExplanation')}</Text>
          <Text style={s.note}>{t('friendOtherConsent')}: {t(otherConsent?'on':'off')}</Text>
          <View style={s.row}>
            <Pressable accessibilityRole="button" disabled={busy}
              onPress={()=>void execute(()=>setOwnFriendConsent(r,!ownConsent))}
              style={s.secondary}><Text style={s.secondaryText}>
                {t('friendOwnConsent')}: {t(ownConsent?'on':'off')}
              </Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy}
              onPress={()=>void execute(()=>actOnRequest(r,'removed'))}
              style={s.secondary}><Text style={s.secondaryText}>{t('friendRemove')}</Text></Pressable>
          </View>
        </>:type==='incoming'?<View style={s.row}>
          <Pressable accessibilityRole="button" disabled={busy}
            onPress={()=>void execute(()=>actOnRequest(r,'accepted'))}
            style={s.button}><Text style={s.buttonText}>{t('friendAccept')}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy}
            onPress={()=>void execute(()=>actOnRequest(r,'declined'))}
            style={s.secondary}><Text style={s.secondaryText}>{t('friendDecline')}</Text></Pressable>
        </View>:<Pressable accessibilityRole="button" disabled={busy}
          onPress={()=>void execute(()=>actOnRequest(r,'cancelled'))}
          style={s.secondary}><Text style={s.secondaryText}>{t('friendCancel')}</Text></Pressable>}
      </View>;
    })}
    <Text style={s.note}>{t('friendNeverGps')}</Text>
  </View>;
}
const styles=(c:Palette)=>StyleSheet.create({
  panel:{backgroundColor:c.surface,borderColor:c.line,borderWidth:1,borderRadius:15,padding:16,gap:10},
  title:{color:c.accent,fontSize:16,fontWeight:'800'},
  note:{color:c.muted,fontSize:12,lineHeight:18},
  label:{color:c.text,fontSize:13,fontWeight:'700'},
  code:{color:c.text,fontSize:13,fontWeight:'700',backgroundColor:c.surfaceAlt,padding:12,borderRadius:10},
  input:{backgroundColor:c.field,borderColor:c.line,borderWidth:1,borderRadius:12,color:c.text,padding:12,fontSize:14},
  row:{flexDirection:'row',flexWrap:'wrap',gap:9,alignItems:'center'},
  button:{padding:11,backgroundColor:c.accent,borderRadius:10},
  buttonText:{color:c.accentOn,fontWeight:'700',fontSize:12},
  secondary:{padding:10,backgroundColor:c.surfaceAlt,borderRadius:10,borderColor:c.line,borderWidth:1},
  secondaryText:{color:c.text,fontWeight:'700',fontSize:12},
  item:{backgroundColor:c.surfaceAlt,borderColor:c.line,borderWidth:1,borderRadius:10,padding:12,gap:7},
  name:{color:c.text,fontSize:14,fontWeight:'700'},
});
