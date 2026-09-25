const $ = id => document.getElementById(id);
const ui = {start:$('start'),stop:$('stop'),save:$('save'),mode:$('mode'),summary:$('summary'),status:$('status'),messages:$('messages'),
  form:$('text-form'),typed:$('typed'),send:$('send'),audio:$('audio')};
let peer, microphone, channel, sessionId, closeTimer;
let ready = false, closing = false;
const transcript = [];
const pending = new Set();
const seen = new Set();
const noSaveRequest=/(?:не\s+(?:сохраняй|запоминай|записывай|фиксируй)|don't\s+(?:save|remember|record)|do\s+not\s+(?:save|remember|record))/i;

function status(message) { ui.status.textContent = message; }
function addMessage(speaker,text) {
  const entry = document.createElement('div'); entry.className='message';
  const label = document.createElement('strong'); label.textContent=speaker;
  const body = document.createElement('span'); body.textContent=text;
  entry.append(label,body); ui.messages.append(entry);
  ui.messages.scrollTop=ui.messages.scrollHeight;
  if(ui.messages.childElementCount>160) ui.messages.firstElementChild.remove();
  return body;
}
function cleanup() {
  clearTimeout(closeTimer);
  channel?.close(); peer?.close(); microphone?.getTracks().forEach(track=>track.stop());
  ui.audio.srcObject=null; peer=undefined; microphone=undefined; channel=undefined;
  sessionId=undefined; ready=false; closing=false; pending.clear(); seen.clear();
  ui.start.disabled=false; ui.stop.disabled=true;
}
function send(event) {
  if (channel?.readyState==='open') channel.send(JSON.stringify(event));
}
async function post(path,body) {
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Запрос не удался.');
  return value;
}
function remember(speaker,text,start,end) {
  const last=transcript.at(-1);
  let current;
  if(start>0&&last?.speaker===speaker&&last.end<=start&&start-last.end<1500) {
    last.text+=text;last.end=end;last.body.textContent=last.text;
    current=last;
  } else {
    const body=addMessage(speaker==='user'?'Вы':'Type',text);
    current={speaker,text,start,end,body};transcript.push(current);
  }
  if(speaker==='user'&&noSaveRequest.test(current.text)) ui.save.checked=false;
  if (transcript.length>128) transcript.splice(0,transcript.length-128);
}
function history() {
  return transcript.slice(-32).map(({speaker,text})=>({speaker,text:text.slice(0,4000)}));
}
function latestRequest(offset) {
  const recent=transcript.filter(item=>item.speaker==='user'&&item.start<=offset+600&&item.end>=offset-30_000);
  return recent.map(item=>item.text).join('').trim().slice(-20_000);
}
function finishIfReady() {
  if (!closing||pending.size||!ready) return;
  status('Завершаю разговор…');
  send({type:'session.close',event_id:`close_${crypto.randomUUID()}`});
  closeTimer=setTimeout(()=>{status('Соединение закрыто без подтверждения завершения.');cleanup();},15_000);
}
async function handleDelegation(event) {
  const id=event.delegation?.id;
  if (event.delegation?.target!=='client'||!id||seen.has(id)) return;
  seen.add(id); pending.add(id);
  status('Агент изучает контекст…');
  // Transcript fragments can arrive just after the delegation metadata.
  await new Promise(resolve=>setTimeout(resolve,500));
  try {
    const request=latestRequest(event.offset_ms ?? Number.POSITIVE_INFINITY);
    const result=request ? await post('/api/delegation',{
      sessionId,delegationId:id,
      task:{mode:ui.mode.value,request,history:history(),summarySize:ui.summary.value,allowWrites:ui.save.checked},
    }) : {text:'Я не разобрал последний запрос. Попроси человека повторить его.'};
    addMessage('Агент',result.text);
    const spoken=result.text.length>440?result.text.slice(0,440).trimEnd()+' Подробности на экране.':result.text;
    send({type:'session.commentary.append',event_id:`result_${crypto.randomUUID()}`,
      delegation_id:id,content:spoken});
    status('Слушаю');
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    addMessage('Ошибка',message);
    send({type:'session.commentary.append',event_id:`error_${crypto.randomUUID()}`,
      delegation_id:id,content:'Агент не смог завершить запрос. Попроси человека повторить его позже.'});
    status(message);
  } finally {pending.delete(id);finishIfReady();}
}
ui.start.addEventListener('click',async()=>{
  ui.start.disabled=true;status('Подключаю микрофон…');
  try {
    peer=new RTCPeerConnection();
    peer.addEventListener('track',event=>{ui.audio.srcObject=new MediaStream([event.track]);ui.audio.play().catch(()=>{status('Нажмите Play на аудиоплеере.');ui.audio.style.display='block';});});
    microphone=await navigator.mediaDevices.getUserMedia({audio:true});
    for(const track of microphone.getAudioTracks()) peer.addTrack(track,microphone);
    channel=peer.createDataChannel('oai-events');
    channel.addEventListener('message',({data})=>{
      let event;try{event=JSON.parse(data);}catch{return;}
      if(event.type==='session.started') {ready=true;sessionId=event.session?.id??sessionId;ui.stop.disabled=false;status('Слушаю');}
      else if(event.type==='session.closed') {status('Разговор завершён.');cleanup();}
      else if(event.type==='session.delegation.created') void handleDelegation(event);
      else if(event.type==='session.input_transcript.delta'||event.type==='session.output_transcript.delta') {
        remember(event.type==='session.input_transcript.delta'?'user':'assistant',event.delta??'',event.start_ms??0,event.end_ms??0);
      } else if(event.type==='error') status(event.error?.message??'Ошибка голосовой сессии.');
    });
    channel.addEventListener('close',()=>{if(ready){status('Соединение прервано.');cleanup();}});
    const offer=await peer.createOffer();await peer.setLocalDescription(offer);
    if(peer.iceGatheringState!=='complete') await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{peer.removeEventListener('icegatheringstatechange',check);reject(new Error('Не удалось собрать WebRTC соединение.'));},10_000);
      function check(){if(peer.iceGatheringState==='complete'){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',check);resolve();}}
      peer.addEventListener('icegatheringstatechange',check);check();
    });
    const result=await post('/api/session',{sdp:peer.localDescription?.sdp});
    sessionId=result.session.id;
    await peer.setRemoteDescription({type:'answer',sdp:result.transport.sdp});
    status('Соединяюсь…');
  } catch(error) {status(error instanceof Error?error.message:String(error));cleanup();}
});
ui.stop.addEventListener('click',()=>{closing=true;ui.stop.disabled=true;finishIfReady();});
ui.form.addEventListener('submit',async event=>{
  event.preventDefault();const request=ui.typed.value.trim();if(!request)return;
  ui.typed.value='';ui.send.disabled=true;remember('user',request,0,0);status('Агент изучает контекст…');
  try {const result=await post('/api/run',{mode:ui.mode.value,request,history:history(),summarySize:ui.summary.value,allowWrites:ui.save.checked});
    remember('assistant',result.text,0,0);status(ready?'Слушаю':'Готово к разговору');
  } catch(error) {status(error instanceof Error?error.message:String(error));}
  finally {ui.send.disabled=false;}
});
