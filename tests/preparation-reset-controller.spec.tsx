// Synthetic source and intercepted inference; real encrypted persistence and media preparation.
import {afterEach,expect,it,vi} from 'vitest';
import {File as NodeFile} from 'node:buffer';
import {IDBFactory} from 'fake-indexeddb';
import {createMeetingController,type MeetingController} from '../src/react-app/controller';
import {createVaultSession,type VaultSession} from '../src/react-app/vault/session';
import {createModelPreset} from '../src/react-app/providers/model-profiles';
import {createJobContext,cancelJobs} from '../src/react-app/domain/jobs';
import {createLocalMediaWorker} from '../src/react-app/media/worker';
import {sttActionToken} from '../src/react-app/transcript/batches';
const cores:MeetingController[]=[];
afterEach(async()=>{for(const c of cores.splice(0))await c.dispose();cancelJobs();});
function wav(){const bytes=new Uint8Array(32044),v=new DataView(bytes.buffer),str=(offset:number,s:string)=>[...s].forEach((c,i)=>{bytes[offset+i]=c.charCodeAt(0);});str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,32000,true);return new NodeFile([bytes],'SYNTHETIC_RESET_SOURCE.wav',{type:'audio/wav'}) as unknown as File;}
async function fixture(wrapSession:(session:VaultSession)=>VaultSession=session=>session,beforeFetch?:(url:string)=>Promise<void>){let session!:VaultSession;const calls:string[]=[];const core=createMeetingController({mediaWorkerFactory:createLocalMediaWorker,indexedDB:new IDBFactory(),databaseName:crypto.randomUUID(),sessionFactory:options=>wrapSession(session=createVaultSession({...options,testOnlyOwnership:{acquire:async()=>()=>{}}})),fetch:async url=>{calls.push(String(url));await beforeFetch?.(String(url));return new Response(JSON.stringify(String(url).endsWith('transcriptions')?{text:'SYNTHETIC_OLD_TRANSCRIPT',usage:{seconds:1,cost:0.01}}:{choices:[{message:{content:'# SYNTHETIC_OLD_NOTES'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:5,cost:0.02}}));}});cores.push(core);await core.initialize();await core.createVault('synthetic reset controller phrase');
 const stt={...createModelPreset('compatible-stt'),enabled:true},llm={...createModelPreset('compatible-text'),enabled:true,llm:{contextTokens:8192,maxTokens:512,tokenField:'max_tokens' as const}};
 for(const model of [stt,llm])await core.getSnapshot().onSaveRegistration!(model,{action:'keep'});
 await core.getSnapshot().onSetRegistrationDefault!('stt',stt.id);await core.getSnapshot().onSetRegistrationDefault!('llm',llm.id);
 const id=await core.createMeeting();await core.importFile(id,wav());await core.prepareAudio(id);let p=core.getSnapshot().projects.find(p=>p.id===id)!;
 await core.startSTT(id,{acknowledged:true,modelId:stt.id,consentToken:sttActionToken(core.getSnapshot().sttConsentToken,p,{purpose:'initial',chunkIds:p.preparedChunks.map(c=>c.id),modelId:stt.id})});
 await core.setMinutesRoute(id,llm.id);p=core.getSnapshot().projects.find(p=>p.id===id)!;await core.generateMinutes(id,{acknowledged:true,transcriptVersionId:p.selectedTranscriptVersionId!,consentToken:core.getSnapshot().minutesConsentToken!,partialAcknowledged:false});
 return{core,id,calls,get session(){return session;}};
}
it('resets only confirmed preparation, re-encodes locally, archives history and persists the empty current results',async()=>{
 const f=await fixture(),before=f.core.getSnapshot().projects.find(p=>p.id===f.id)!,oldAudio=before.preparedChunks[0].audioRecordId;
 await f.core.planPreparationReset(f.id,{...before.audioOptions,chunkMinutes:10,bitrateKbps:48});const first=f.core.getSnapshot().preparationResetPlan!;
 await expect(f.core.resetPreparation('wrong')).rejects.toMatchObject({code:'invalid-input'});expect(f.core.getSnapshot().projects[0].rawTranscripts).toEqual(before.rawTranscripts);
 f.core.getSnapshot().onCancelPreparationReset!();expect(f.core.getSnapshot().preparationResetPlan).toBeNull();await expect(f.core.resetPreparation(first.versionToken)).rejects.toMatchObject({code:'invalid-input'});
 await f.core.planPreparationReset(f.id,{...before.audioOptions,chunkMinutes:10,bitrateKbps:48});await f.core.resetPreparation(f.core.getSnapshot().preparationResetPlan!.versionToken);
 const after=f.core.getSnapshot().projects.find(p=>p.id===f.id)!;expect(after.preparedChunks).toHaveLength(1);expect(after.preparedChunks[0].audioRecordId).not.toBe(oldAudio);expect(after.rawTranscripts).toEqual([]);expect(after.minutesRevisions).toEqual([]);expect(after.processingArchives?.[0].items).toHaveLength(2);expect(f.core.getSnapshot().history).toHaveLength(2);expect(JSON.stringify(after)).not.toContain('SYNTHETIC_OLD_TRANSCRIPT');expect(JSON.stringify(after)).not.toContain('SYNTHETIC_OLD_NOTES');expect(f.calls).toHaveLength(2);
 f.core.getSnapshot().onAudioOptions!(f.id,{...after.audioOptions,chunkMinutes:15});await vi.waitFor(()=>expect(f.core.getSnapshot().error).toBeTruthy());expect(f.core.getSnapshot().projects.find(p=>p.id===f.id)?.audioOptions).toEqual(after.audioOptions);
 f.core.getSnapshot().onAudioOptions!(f.id,{...after.audioOptions,expectedLanguages:['en'],transcriptionHints:{terms:['SYNTHETIC_HINT'],context:'Synthetic context'}});await vi.waitFor(()=>expect(f.core.getSnapshot().projects.find(p=>p.id===f.id)?.audioOptions.expectedLanguages).toEqual(['en']));expect(f.core.getSnapshot().projects.find(p=>p.id===f.id)?.preparedChunks).toEqual(after.preparedChunks);expect(f.core.getSnapshot().projects.find(p=>p.id===f.id)?.processingArchives).toEqual(after.processingArchives);
 await expect(f.session.store.readAudio(oldAudio,createJobContext())).rejects.toThrow();const reader=await f.session.openRetainedSource(after.sourceAssets[0].id,createJobContext());expect((await reader.read(0,4,createJobContext())).byteLength).toBe(4);
 await f.core.lock();await f.core.unlock('synthetic reset controller phrase');expect(f.core.getSnapshot().projects.find(p=>p.id===f.id)?.processingArchives).toEqual(after.processingArchives);expect(f.calls).toHaveLength(2);
});
it('opens per-memo history separately from global history and clears sensitive editor state on lock',async()=>{
 const f=await fixture();f.core.getSnapshot().onNavigate!('history',f.id);await vi.waitFor(()=>expect(f.core.getSnapshot().historyProjectId).toBe(f.id));f.core.getSnapshot().onNavigate!('history');await vi.waitFor(()=>expect(f.core.getSnapshot().historyProjectId).toBeNull());
 f.core.getSnapshot().onEditPreparation!(f.id);await vi.waitFor(()=>expect(f.core.getSnapshot().preparationEditor?.projectId).toBe(f.id));await f.core.lock();expect(f.core.getSnapshot().preparationEditor).toBeNull();expect(f.core.getSnapshot().preparationResetPlan).toBeNull();
});
it('keeps an approved reset and local re-encoding together until screen-locked work is saved',async()=>{
 let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),held=vi.fn();
 const f=await fixture(session=>new Proxy(Object.create(session) as VaultSession,{get(target,key){
  if(key==='resetPreparation')return async(...args:Parameters<VaultSession['resetPreparation']>)=>{held();await barrier;return session.resetPreparation(...args);};
  return Reflect.get(target,key);
 }})),before=f.core.getSnapshot().projects.find(p=>p.id===f.id)!,oldAudio=before.preparedChunks[0].audioRecordId;
 await f.core.planPreparationReset(f.id,{...before.audioOptions,bitrateKbps:48});
 try{
  const operation=f.core.resetPreparation(f.core.getSnapshot().preparationResetPlan!.versionToken);void operation.catch(()=>{});
  await vi.waitFor(()=>expect(held).toHaveBeenCalledOnce());await f.core.screenLock();
  expect(f.core.getSnapshot().session).toBe('unlocked');expect(f.core.getSnapshot().screenAccess).toBe('locked');
  release();await operation;
  await vi.waitFor(()=>expect(f.core.getSnapshot().session).toBe('locked'));
  await f.core.unlockScreen('synthetic reset controller phrase');
  const after=f.core.getSnapshot().projects.find(p=>p.id===f.id)!;
  expect(after.preparedChunks).toHaveLength(1);expect(after.preparedChunks[0].audioRecordId).not.toBe(oldAudio);
  expect(after.processingArchives?.[0].items).toHaveLength(2);expect(f.calls).toHaveLength(2);
 }finally{release();}
});

it('keeps Settings open when an approved notes request finishes in the background',async()=>{
 let shouldHold=false,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),held=vi.fn();
 const f=await fixture(undefined,async url=>{if(shouldHold&&url.endsWith('chat/completions')){held();await barrier;}});
 const p=f.core.getSnapshot().projects.find(p=>p.id===f.id)!;
 shouldHold=true;
 try{
  const operation=f.core.generateMinutes(f.id,{acknowledged:true,transcriptVersionId:p.selectedTranscriptVersionId!,consentToken:f.core.getSnapshot().minutesConsentToken!,partialAcknowledged:false});void operation.catch(()=>{});
  await vi.waitFor(()=>expect(held).toHaveBeenCalledOnce());
  f.core.getSnapshot().onNavigate!('settings',f.id);
  await vi.waitFor(()=>expect(f.core.getSnapshot().screen).toBe('settings'));
  expect(f.core.getSnapshot().workReturnScreen).toBe('minutes');
  release();await operation;
  expect(f.core.getSnapshot().screen).toBe('settings');
  expect(f.core.getSnapshot().projects.find(p=>p.id===f.id)?.minutesRevisions).toHaveLength(2);
  expect(f.calls).toHaveLength(3);
 }finally{release();}
});
