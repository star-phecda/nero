function patchNeroVoice(source) {
  const start = source.indexOf("const NERO_VOICE_ENABLED =");
  const endMarker = "\nconst neroPresence = new NeroPresence();";
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error("[NERO VOICE] TTS block not found.");

  const voiceBlock =
"const NERO_VOICE_ENABLED = process.env.NERO_VOICE_ENABLED === 'true';\n" +
"const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';\n" +
"const NERO_VOICE_ID = process.env.NERO_VOICE_ID || '';\n" +
"const NERO_TTS_MODEL = process.env.NERO_TTS_MODEL || 'eleven_flash_v2_5';\n" +
"const NERO_TTS_TIMEOUT_MS = Number(process.env.NERO_TTS_TIMEOUT_MS || 30000);\n" +
"const NERO_VOICE_SETTINGS_FILE = process.cwd() + '/nero_voice_settings.json';\n" +
"const NERO_VOICE_MODEL_CATALOG = [{key:'flash',label:'Eleven Flash v2.5',model:'eleven_flash_v2_5'},{key:'multilingual',label:'Eleven Multilingual v2',model:'eleven_multilingual_v2'},{key:'v3',label:'Eleven v3',model:'eleven_v3'}];\n" +
"let neroVoiceSettings = {};\n" +
"function getNeroVoiceSettingKey(jid){return normalizeJid(jid)||String(jid||'');}\n" +
"function getNeroVoiceModelInfo(key){return NERO_VOICE_MODEL_CATALOG.find(m=>m.key===key)||NERO_VOICE_MODEL_CATALOG.find(m=>m.model===NERO_TTS_MODEL)||NERO_VOICE_MODEL_CATALOG[0];}\n" +
"function loadNeroVoiceSettings(){try{if(fs.existsSync(NERO_VOICE_SETTINGS_FILE)){const s=JSON.parse(fs.readFileSync(NERO_VOICE_SETTINGS_FILE,'utf8'));if(s&&typeof s==='object')neroVoiceSettings=s;}}catch(e){console.log('[VOICE] Load error:',e.message);}}\n" +
"function saveNeroVoiceSettings(){try{fs.writeFileSync(NERO_VOICE_SETTINGS_FILE,JSON.stringify(neroVoiceSettings,null,2),'utf8');}catch(e){console.log('[VOICE] Save error:',e.message);}}\n" +
"function getNeroVoiceConfig(jid){const k=getNeroVoiceSettingKey(jid),s=neroVoiceSettings[k]||{};return{enabled:s.enabled===true,model:NERO_VOICE_MODEL_CATALOG.some(m=>m.key===s.model)?s.model:getNeroVoiceModelInfo().key};}\nfunction getNeroVoiceEnabled(jid){return getNeroVoiceConfig(jid).enabled;}\n" +
"function setNeroVoiceEnabled(jid,enabled){const k=getNeroVoiceSettingKey(jid),c=getNeroVoiceConfig(jid);neroVoiceSettings[k]={enabled:Boolean(enabled),model:c.model};saveNeroVoiceSettings();}\n" +
"function setNeroVoiceModel(jid,key){const k=getNeroVoiceSettingKey(jid),c=getNeroVoiceConfig(jid);neroVoiceSettings[k]={enabled:c.enabled,model:getNeroVoiceModelInfo(key).key};saveNeroVoiceSettings();}\n" +
"function neroVoiceModelMenuText(jid){const c=getNeroVoiceConfig(jid),m=getNeroVoiceModelInfo(c.model);return['NERO VOICE','', 'Status: '+(c.enabled?'ON':'OFF'),'Voice: Rising Blade','TTS model: '+m.label,'','flash - Eleven Flash v2.5','multilingual - Eleven Multilingual v2','v3 - Eleven v3','','Commands:','!nero voice on','!nero voice off','!nero voice model <key>'].join('\\n');}\n" +
"async function generateNeroVoiceAudio(text,jid){const c=getNeroVoiceConfig(jid);if(!NERO_VOICE_ENABLED||!ELEVENLABS_API_KEY||!NERO_VOICE_ID||!c.enabled||!String(text||'').trim())return null;const m=getNeroVoiceModelInfo(c.model),ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),NERO_TTS_TIMEOUT_MS);try{const r=await fetch('https://api.elevenlabs.io/v1/text-to-speech/'+encodeURIComponent(NERO_VOICE_ID),{method:'POST',headers:{'xi-api-key':ELEVENLABS_API_KEY,'Content-Type':'application/json','Accept':'audio/mpeg'},body:JSON.stringify({text:String(text).trim(),model_id:m.model,output_format:'mp3_44100_128',voice_settings:{stability:.35,similarity_boost:.85,style:.25,use_speaker_boost:true,speed:1.05}}),signal:ctl.signal});if(!r.ok)throw new Error('ElevenLabs HTTP '+r.status);return Buffer.from(await r.arrayBuffer());}finally{clearTimeout(to);}}\n" +
"async function sendNeroVoice(sock,jid,text){if(!NERO_VOICE_ENABLED||!getNeroVoiceConfig(jid).enabled)return null;try{const audio=await generateNeroVoiceAudio(text,jid);if(!audio?.length)return null;const sent=await sock.sendMessage(jid,{audio,mimetype:'audio/mpeg',ptt:true});if(sent?.key?.id){botSentMessageIds.add(sent.key.id);setTimeout(()=>botSentMessageIds.delete(sent.key.id),300000);}return sent;}catch(e){console.error('[NERO TTS] Failed:',e?.message||e);return null;}}\nloadNeroVoiceSettings();";

  source = source.slice(0, start) + voiceBlock + source.slice(end);

  const marker = "    /* NERO MODEL SELECTOR */";
  const insertAt = source.indexOf(marker);
  if (insertAt === -1) throw new Error("[NERO VOICE] Model selector marker not found.");

  const commandBlock =
"    /* NERO VOICE SELECTOR */\n" +
"    if(isNeroPrivilegedMessage && (neroCommand==='!nero voice'||neroCommand==='!nero voice status')){await sendNeroControlMessage(sock,jid,neroVoiceModelMenuText(jid));continue;}\n" +
"    if(isNeroPrivilegedMessage && (neroCommand==='!nero voice on'||neroCommand==='!nero vn on')){setNeroVoiceEnabled(jid,true);await sendNeroControlMessage(sock,jid,'Voice mode ON. I will add a VN after my normal text replies.\\n\\nModel: '+getNeroVoiceModelInfo(getNeroVoiceConfig(jid).model).label);continue;}\n" +
"    if(isNeroPrivilegedMessage && (neroCommand==='!nero voice off'||neroCommand==='!nero vn off')){setNeroVoiceEnabled(jid,false);await sendNeroControlMessage(sock,jid,'Voice mode OFF. Text only again.');continue;}\n" +
"    if(isNeroPrivilegedMessage && /^!nero voice model\\s+/.test(neroCommand)){const k=neroCommand.slice('!nero voice model'.length).trim(),m=NERO_VOICE_MODEL_CATALOG.find(x=>x.key===k);if(!m){await sendNeroControlMessage(sock,jid,'That voice model is not available.\\n\\n'+neroVoiceModelMenuText(jid));continue;}setNeroVoiceModel(jid,m.key);await sendNeroControlMessage(sock,jid,'VOICE MODEL SWITCHED\\n\\nModel: '+m.label+'\\nVoice: Rising Blade\\nVoice mode: '+(getNeroVoiceConfig(jid).enabled?'ON':'OFF'));continue;}\n";

  source = source.slice(0, insertAt) + commandBlock + source.slice(insertAt);
  return source;
}

export async function load(url, context, defaultLoad) {
  const result = await defaultLoad(url, context, defaultLoad);
  if (url.endsWith('/app.js') && result.format === 'module') {
    const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    return {format:result.format,source:patchNeroVoice(source),shortCircuit:true};
  }
  return result;
}
