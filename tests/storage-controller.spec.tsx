import { File as NodeFile } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession } from '../src/react-app/vault/session';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import type { DeletionPlan } from '../src/react-app/domain/types';
import { inspectAudio } from '../src/react-app/media/inspect';
import { createLocalMediaWorker } from '../src/react-app/media/worker';
import { sttActionToken } from '../src/react-app/transcript/batches';
import { STT_MODELS } from '../src/react-app/providers/catalog';
import { emptyModelRegistry, observeSTTRoute, registryRouteKey, setRegistryDefault, setRegistryEnabled } from '../src/react-app/providers/model-registry';
import { addRegistryObservation } from '../src/react-app/providers/registry-consumer';
import { preparedAudioReady, retainedChunks, retainedInitialChunkIds } from '../src/react-app/ui/copy';

const controllers: MeetingController[] = [];
const releases: (()=>void)[]=[];
afterEach(async () => { for(const release of releases.splice(0))release(); for (const core of controllers.splice(0)) await core.dispose(); cancelJobs(); vi.restoreAllMocks(); });
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);releases.push(release);return{promise,release};}
function wav() {
  const bytes = new Uint8Array(32044), v = new DataView(bytes.buffer), text = (at: number, value: string) => [...value].forEach((letter, i) => { bytes[at+i]=letter.charCodeAt(0); });
  text(0,'RIFF'); v.setUint32(4,32036,true); text(8,'WAVE'); text(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,16000,true); v.setUint32(28,32000,true); v.setUint16(32,2,true); v.setUint16(34,16,true); text(36,'data'); v.setUint32(40,32000,true);
  return new NodeFile([bytes], 'TEST_ONLY_STORAGE.wav', {type:'audio/wav'}) as unknown as File;
}
async function fixture(legacy = false) {
  const indexedDB=new IDBFactory(), databaseName=crypto.randomUUID(), calls:string[]=[];
  let session!: ReturnType<typeof createVaultSession>;
  let failTeardown=false, heldInventory:{hold:ReturnType<typeof gate>;entered:ReturnType<typeof gate>}|null=null, deletionCalls=0, audioReads=0;
  const revoke=vi.fn();
  const core=createMeetingController({indexedDB,databaseName,mediaWorkerFactory:createLocalMediaWorker,sessionFactory:hooks=>{
    session=createVaultSession({...hooks,indexedDB,databaseName,testOnlyOwnership:{acquire:async()=>()=>{}},teardown:()=>{hooks.teardown?.();if(failTeardown){failTeardown=false;throw new Error('TEST_ONLY teardown failure');}}});
    // The real store is frozen. Instrument the public boundary without replacing
    // its methods or weakening its actual encrypted storage behavior.
    return new Proxy(Object.create(session) as typeof session,{get(target,key){
      if(key==='store')return new Proxy(Object.create(session.store) as typeof session.store,{get(store,key){if(key==='readAudio')return async(...args:Parameters<typeof session.store.readAudio>)=>{audioReads++;return session.store.readAudio(...args);};return Reflect.get(store,key);}});
      if(key==='getStorageInventory')return async(...args:Parameters<typeof session.getStorageInventory>)=>{const result=await session.getStorageInventory(...args),holding=heldInventory;if(holding){heldInventory=null;holding.entered.release();await holding.hold.promise;}return result;};
      if(key==='executeDeletion')return async(...args:Parameters<typeof session.executeDeletion>)=>{deletionCalls++;return session.executeDeletion(...args);};return Reflect.get(target,key);
    }});
  },fetch:async input=>{calls.push(String(input));throw new Error('TEST_ONLY network forbidden');},objectUrls:{create:()=>`blob:TEST_ONLY-${crypto.randomUUID()}`,revoke}});
  controllers.push(core); await core.initialize(); await core.createVault('TEST_ONLY_STORAGE_PASSPHRASE'); const id=await core.createMeeting();
  if (legacy) {
    // Construct a genuine legacy stored project. Import is a legitimate new
    // edit and may upgrade availability; reload/hydration itself must not.
    const p={...core.getSnapshot().projects[0]}; delete p.retainedAudio; const file=wav(), source=await inspectAudio(file,createJobContext());
    await session.store.checkpoint({project:{...p,sourceAssets:[source]},runId:null,audioRecords:[{recordId:source.id,audio:file}]},createJobContext());
  } else await core.importFile(id,wav());
  return {core,id,calls,revoke,session:()=>session,failTeardown:()=>{failTeardown=true;},holdInventory:(hold:ReturnType<typeof gate>,entered:ReturnType<typeof gate>)=>{heldInventory={hold,entered};},deletionCalls:()=>deletionCalls,audioReads:()=>audioReads};
}
it('verifies legacy retained manifests on reload without inventing a project edit', async()=>{
  const f=await fixture(true), before=await f.session().store.readProject(f.id,createJobContext()); await f.core.lock(); await f.core.unlock('TEST_ONLY_STORAGE_PASSPHRASE');
  const p=f.core.getSnapshot().projects.find(p=>p.id===f.id)!;
  expect(p.retainedAudio).toEqual({sourceIds:[p.sourceAssets[0].id],chunkIds:[]}); expect(p.updatedAt).toBe(before!.updatedAt);
  expect((await f.session().store.readProject(f.id,createJobContext()))!.retainedAudio).toBeUndefined(); expect(f.calls).toEqual([]);
});
async function prepared(){const f=await fixture();await f.core.prepareAudio(f.id);return f;}
async function withResults(){
 const f=await prepared(),p=f.core.getSnapshot().projects[0],chunk=p.preparedChunks[0],rawId=crypto.randomUUID(),runId=crypto.randomUUID(),versionId=crypto.randomUUID(),editedId=crypto.randomUUID();
 const segment={id:crypto.randomUUID(),text:'TEST_ONLY original',sourceStartMs:0,sourceEndMs:1000,rawIds:[rawId]},version={id:versionId,parentId:null,rawIds:[rawId],segments:[segment],issues:[],missingRanges:[]};
 const saved=await f.session().store.checkpoint({project:{...p,rawTranscripts:[{id:rawId,chunkId:chunk.id,runId,response:{text:segment.text,TEST_ONLY:true},text:segment.text,segments:[segment],timing:'chunk',speakerScope:'none',execution:null}],transcriptVersions:[version,{...version,id:editedId,parentId:versionId,segments:[{...segment,text:'TEST_ONLY edited transcript'}]}],selectedTranscriptVersionId:editedId,runs:[{id:runId,projectId:p.id,state:'saving',checkpoint:null}]},runId,audioRecords:[]},createJobContext());
 const minutesId=crypto.randomUUID(),revisionId=crypto.randomUUID();
 const minutes={id:minutesId,transcriptVersionId:editedId,settings:p.minutesSettings,generatedMarkdown:'# TEST_ONLY grounded fixture',requestedModel:'TEST_ONLY past model',returnedModel:null,actualProvider:null,usage:{inputTokens:null,outputTokens:null,durationSeconds:null,audioInputTokens:null,textInputTokens:null,audioOutputTokens:null,textOutputTokens:null,elapsedMs:0,cost:null,costKind:'unavailable' as const,currency:null,rateSource:null,rateCheckedAt:null,rateSnapshot:null}};
 await f.session().store.checkpoint({project:{...saved.project,minutesRuns:[minutes],minutesRevisions:[{id:revisionId,runId:minutesId,parentId:null,markdown:'# TEST_ONLY edited notes'}],selectedMinutesRevisionId:revisionId,runs:[...saved.project.runs,{id:minutesId,projectId:p.id,state:'saving',checkpoint:null}]},runId:minutesId,audioRecords:[]},createJobContext());
 await f.core.lock();await f.core.unlock('TEST_ONLY_STORAGE_PASSPHRASE');return{...f,before:f.core.getSnapshot().projects[0]};
}
it('confirms source-only cleanup through the canceled-job boundary and keeps chunks plus all saved versions usable',async()=>{
 const f=await withResults(),before=f.before; const plan=await f.core.planAudioDeletion('source',f.id);await f.core.deletePlannedAudio(plan.versionToken);
 const snapshot=f.core.getSnapshot(),p=snapshot.projects[0];expect(snapshot.storageNotice).toContain('삭제');expect(snapshot.storageWorking).toBe(false);expect(snapshot.selectedProjectId).toBe(f.id);
 expect(p.retainedAudio).toEqual({sourceIds:[],chunkIds:before.preparedChunks.map(chunk=>chunk.id)});expect(preparedAudioReady(p)).toBe(true);
 expect({...p,retainedAudio:before.retainedAudio}).toEqual(before);await expect(f.session().store.readAudio(p.preparedChunks[0].audioRecordId,createJobContext())).resolves.toBeInstanceOf(Blob);
 await expect(f.core.importFile(f.id,wav())).rejects.toThrow();expect(f.core.getSnapshot().error).toContain('바이트');expect(f.calls).toEqual([]);
});
it('reprepares only retained-source ranges with fresh IDs and counts no deleted descriptors as completed audio',async()=>{
 const f=await withResults(),before=f.before,old=before.preparedChunks[0];const plan=await f.core.planAudioDeletion('chunks',f.id);await f.core.deletePlannedAudio(plan.versionToken);
 let p=f.core.getSnapshot().projects[0];expect(preparedAudioReady(p)).toBe(false);expect(retainedChunks(p)).toEqual([]);expect(p.preparedChunks).toEqual(before.preparedChunks);
 await f.core.prepareAudio(f.id);p=f.core.getSnapshot().projects[0];const available=retainedChunks(p);expect(available).toHaveLength(1);expect(available[0].id).not.toBe(old.id);expect(available[0].audioRecordId).not.toBe(old.audioRecordId);
 expect(p.preparedChunks).toHaveLength(2);expect(p.preparedChunks[0]).toEqual(old);expect(p.transcriptVersions).toEqual(before.transcriptVersions);expect(p.minutesRevisions).toEqual(before.minutesRevisions);expect(p.selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId);
 expect(f.core.getSnapshot().preparation).toMatchObject({stage:'complete',completed:1,total:1,savedEncodedBytes:available[0].encodedBytes});expect(retainedInitialChunkIds(p)).toEqual([available[0].id]);expect(f.calls).toEqual([]);
});
it.each(['initial','retry-failed','rerun-successful'] as const)('blocks deleted historical chunks from %s dispatch before provider or audio reads',async purpose=>{
 const f=await withResults(),chunk=f.before.preparedChunks[0];
 const route={connectionId:'openai',provider:'openai' as const,stage:'stt' as const,modelId:'gpt-transcribe',endpointTag:null},key=registryRouteKey(route);
 const registry=setRegistryDefault(setRegistryEnabled(addRegistryObservation(emptyModelRegistry(),observeSTTRoute(route,STT_MODELS.find(model=>model.id===route.modelId)!)),key,true),'stt',key);
 await f.session().saveModelRegistry(registry,createJobContext());await f.core.lock();await f.core.unlock('TEST_ONLY_STORAGE_PASSPHRASE');
 const plan=await f.core.planAudioDeletion('chunks',f.id);await f.core.deletePlannedAudio(plan.versionToken);
 const p=f.core.getSnapshot().projects[0],token=sttActionToken(f.core.getSnapshot().sttConsentToken,p,{purpose,chunkIds:[chunk.id],modelId:'gpt-transcribe'}),reads=f.audioReads();
 expect(f.core.getSnapshot().modelCatalog?.find(model=>model.id==='gpt-transcribe')?.enabled).toBe(true);expect(f.core.getSnapshot().sttModelId).toBe('gpt-transcribe');expect(p.retainedAudio!.sourceIds).toHaveLength(1);
 await expect(f.core.startSTT(f.id,{modelId:'gpt-transcribe',acknowledged:true,additionalChargeAcknowledged:true,consentToken:token},[chunk.id],{purpose})).rejects.toThrow();expect(f.audioReads()).toBe(reads);expect(f.calls).toEqual([]);
});
it('admits a genuinely new import after verified empty audio availability',async()=>{
 const f=await fixture(),id=await f.core.createMeeting();expect(f.core.getSnapshot().projects.find(p=>p.id===id)!.retainedAudio).toEqual({sourceIds:[],chunkIds:[]});
 await f.core.importFile(id,wav());const p=f.core.getSnapshot().projects.find(p=>p.id===id)!;expect(p.sourceAssets).toHaveLength(1);expect(p.retainedAudio).toEqual({sourceIds:[p.sourceAssets[0].id],chunkIds:[]});expect(f.calls).toEqual([]);
});
it('preserves deleted audio descriptors against replacement controls and encoding changes',async()=>{
 const f=await prepared(),before=f.core.getSnapshot().projects[0],chunks=await f.core.planAudioDeletion('chunks',f.id);await f.core.deletePlannedAudio(chunks.versionToken);
 f.core.getSnapshot().onAudioOptions!(f.id,{...before.audioOptions,bitrateKbps:48});await vi.waitFor(()=>expect(f.core.getSnapshot().busy).toBe(false));
 expect(f.core.getSnapshot().projects[0].preparedChunks).toEqual(before.preparedChunks);await f.core.prepareAudio(f.id);expect(retainedChunks(f.core.getSnapshot().projects[0])).toHaveLength(1);
 const p=f.core.getSnapshot().projects[0],source=await f.core.planAudioDeletion('source',f.id);await f.core.deletePlannedAudio(source.versionToken);f.core.getSnapshot().onClearFile!(f.id);await vi.waitFor(()=>expect(f.core.getSnapshot().busy).toBe(false));
 expect(f.core.getSnapshot().projects[0].sourceAssets).toEqual(p.sourceAssets);expect(f.core.getSnapshot().projects[0].preparedChunks).toEqual(p.preparedChunks);expect(f.calls).toEqual([]);
});
it('never executes absent/wrong confirmation and consumes stale plans without automatic replanning',async()=>{
 const f=await fixture();await expect(f.core.deletePlannedAudio('TEST_ONLY wrong')).rejects.toThrow();const plan=await f.core.planAudioDeletion('source',f.id);
 await expect(f.core.deletePlannedAudio('TEST_ONLY wrong')).rejects.toThrow();expect(f.deletionCalls()).toBe(0);await f.core.updateMeeting(f.id,{title:'TEST_ONLY revision changed'});
 await expect(f.core.deletePlannedAudio(plan.versionToken)).rejects.toThrow();expect(f.core.getSnapshot().audioDeletionPlan).toBeNull();expect(f.core.getSnapshot().storageNotice).toBeNull();expect(f.deletionCalls()).toBe(1);
 expect((await f.session().getAudioAvailability(f.id,createJobContext())).sourceIds).toHaveLength(1);const renewed=await f.core.planAudioDeletion('source',f.id);expect(renewed.versionToken).not.toBe(plan.versionToken);await f.core.deletePlannedAudio(renewed.versionToken);expect(f.calls).toEqual([]);
});
it('keeps completed editor state after teardown failure until the coordinator saves it on lock',async()=>{
 const f=await fixture(),original=f.core.getSnapshot().projects[0].title,plan=await f.core.planAudioDeletion('source',f.id);f.core.getSnapshot().onUpdateMeeting!(f.id,{title:'TEST_ONLY pending captured title'});f.failTeardown();
 await expect(f.core.deletePlannedAudio(plan.versionToken)).rejects.toThrow();expect(f.core.getSnapshot().projects[0].title).toBe('TEST_ONLY pending captured title');expect((await f.session().store.readProject(f.id,createJobContext()))!.title).toBe(original);
 expect(f.core.getSnapshot().storageNotice).toBeNull();expect(f.core.getSnapshot().storageError).toBeTruthy();await f.core.lock();await f.core.unlock('TEST_ONLY_STORAGE_PASSPHRASE');
 expect(f.core.getSnapshot().projects[0].title).toBe('TEST_ONLY pending captured title');expect(f.core.getSnapshot().projects[0].retainedAudio!.sourceIds).toHaveLength(1);expect(f.calls).toEqual([]);
});
it('shows failed atomic cleanup honestly, preserves availability and requires a newly confirmed retry',async()=>{
 const f=await prepared(),before=f.core.getSnapshot().projects[0],plan=await f.core.planAudioDeletion('chunks',f.id),native=IDBObjectStore.prototype.delete;
 const spy=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['delete']>){const r=native.apply(this,args);if(String(args[0])===plan.recordIds[0]&&this.transaction.objectStoreNames.contains('header'))this.transaction.abort();return r;});
 await expect(f.core.deletePlannedAudio(plan.versionToken)).rejects.toThrow();spy.mockRestore();expect(f.core.getSnapshot().storageNotice).toBeNull();expect(f.core.getSnapshot().projects[0].retainedAudio).toEqual(before.retainedAudio);expect(f.core.getSnapshot().busy).toBe(false);
 const renewed=await f.core.planAudioDeletion('chunks',f.id);expect(renewed.versionToken).not.toBe(plan.versionToken);await f.core.deletePlannedAudio(renewed.versionToken);expect(f.core.getSnapshot().projects[0].retainedAudio!.chunkIds).toEqual([]);
});
it('fences an already-completed cleanup refresh when locking and restores only durable availability later',async()=>{
 const f=await fixture(),plan=await f.core.planAudioDeletion('source',f.id),hold=gate(),entered=gate();f.holdInventory(hold,entered);
 const deletion=f.core.deletePlannedAudio(plan.versionToken),rejected=expect(deletion).rejects.toThrow();await entered.promise;await f.core.lock();hold.release();await rejected;
 expect(f.core.getSnapshot()).toMatchObject({session:'locked',projects:[],storageInventory:null,audioDeletionPlan:null,storageNotice:null,storageError:null});await f.core.unlock('TEST_ONLY_STORAGE_PASSPHRASE');expect(f.core.getSnapshot().projects[0].retainedAudio!.sourceIds).toEqual([]);expect(f.calls).toEqual([]);
});
it('clears owned preview URLs and playback before source cleanup with local registry restoration only',async()=>{
 const f=await fixture(),url=f.core.getSnapshot().sourcePreviewUrl!,audio={pause:vi.fn()} as unknown as HTMLAudioElement;f.core.getSnapshot().onSourcePreviewPlay!(audio);
 const plan=await f.core.planAudioDeletion('source',f.id);await f.core.deletePlannedAudio(plan.versionToken);expect(audio.pause).toHaveBeenCalled();expect(f.revoke).toHaveBeenCalledWith(url);expect(f.core.getSnapshot().sourcePreviewUrl).toBeNull();expect(f.core.getSnapshot().modelRegistry).toBeTruthy();expect(f.calls).toEqual([]);
});
it('issues a controlled exact source plan without deleting on open or cancel', async()=>{
  const f=await fixture(), source=f.core.getSnapshot().projects[0].sourceAssets[0];
  const future=f.core as MeetingController & {planAudioDeletion?:(scope:'source',id:string)=>Promise<DeletionPlan>;cancelAudioDeletion?:()=>void};
  const plan=await future.planAudioDeletion?.('source',f.id);
  expect(plan).toMatchObject({scope:'source',projectId:f.id,versionToken:expect.any(String)});
  expect((await f.session().getAudioAvailability(f.id,createJobContext())).sourceIds).toEqual([source.id]); future.cancelAudioDeletion?.();
  expect((await f.session().getAudioAvailability(f.id,createJobContext())).sourceIds).toEqual([source.id]); expect(f.calls).toEqual([]);
});

it('refreshes pending list preferences committed by an audio cleanup finalizer', async () => {
 const f = await fixture(), lists = { icons: ['headphones', 'mic'], colors: ['#123456'], languages: [{ code: 'fr', name: 'TEST_ONLY_LIST_REFRESH' }] }, native = IDBObjectStore.prototype.put;
 const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'records') { this.transaction.abort(); throw new Error('TEST_ONLY quota'); } return native.apply(this, args); });
 await expect(f.core.saveSelectionLists(lists)).rejects.toThrow(); spy.mockRestore();
 const plan = await f.core.planAudioDeletion('source', f.id);
 f.core.getSnapshot().onUpdateMeeting!(f.id, { title: 'TEST_ONLY pending list boundary' });
 await expect(f.core.deletePlannedAudio(plan.versionToken)).rejects.toThrow();
 expect(await f.session().loadSelectionLists(createJobContext())).toEqual(lists);
 expect(f.core.getSnapshot().selectionLists).toEqual(lists);
 expect(f.calls).toEqual([]);
});
