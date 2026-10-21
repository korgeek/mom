import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { createLocalMediaWorker } from '../src/react-app/media/worker';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';

const phrase='synthetic memo deletion controller phrase', cores:MeetingController[]=[];
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));
afterEach(async()=>{for(const core of cores.splice(0))await core.dispose();cancelJobs();vi.unstubAllGlobals();});
function toneFile(){
 const bytes=new Uint8Array(44+32000),view=new DataView(bytes.buffer);
 const text=(at:number,value:string)=>[...value].forEach((letter,i)=>{bytes[at+i]=letter.charCodeAt(0);});
 text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,32000,true);
 for(let i=0;i<16000;i++)view.setInt16(44+i*2,8192,true);
 return new File([bytes],'SYNTHETIC_DELETE.wav',{type:'audio/wav'});
}

it('deletes only the selected memo drafts, history and preview through controller and encrypted restoration',async()=>{
 let session!:VaultSession;
 const revoked=vi.fn(),core=createMeetingController({indexedDB:new IDBFactory(),databaseName:crypto.randomUUID(),
  sessionFactory:options=>{session=createVaultSession({...options,testOnlyOwnership:{acquire:async()=>()=>{}}});return session;},
  mediaWorkerFactory:createLocalMediaWorker,objectUrls:{create:()=>`blob:SYNTHETIC-${crypto.randomUUID()}`,revoke:revoked}});
 cores.push(core);await core.initialize();await core.createVault(phrase);
 const a=await core.createMeeting();await core.importFile(a,toneFile());const b=await core.createMeeting();
 const savedA=(await session.store.readProject(a,createJobContext()))!;
 await session.store.checkpoint({project:{...savedA,runs:[{id:'SYNTHETIC_DELETED_REQUEST',projectId:a,state:'failed',checkpoint:null}]},runId:null,audioRecords:[]},createJobContext());
 await core.lock();await core.unlock(phrase);
 const aKey=JSON.stringify(['review-text',a,'SYNTHETIC_VERSION_A']),bKey=JSON.stringify(['review-text',b,'SYNTHETIC_VERSION_B']);
 core.getSnapshot().onUIDraft!(aKey,'SYNTHETIC_A_DRAFT');core.getSnapshot().onUIDraft!(bKey,'SYNTHETIC_B_DRAFT');core.getSnapshot().onUIDraft!('settings','SYNTHETIC_SHARED_DRAFT');
 await core.lock();await core.unlock(phrase);
 expect(core.getSnapshot().uiDrafts).toHaveProperty(aKey,'SYNTHETIC_A_DRAFT');
 core.getSnapshot().onNavigate!('import',a);await vi.waitFor(()=>expect(core.getSnapshot()).toMatchObject({screen:'import',selectedProjectId:a}));
 core.getSnapshot().onLoadSourcePreview!(a);await vi.waitFor(()=>expect(core.getSnapshot().sourceWaveform?.[0]).toBe(.25));
 const preview=core.getSnapshot().sourcePreviewUrl!;expect(preview).toBeTruthy();
 core.getSnapshot().onNavigate!('history',a);await vi.waitFor(()=>expect(core.getSnapshot().historyProjectId).toBe(a));
 expect(core.getSnapshot().history).toEqual(expect.arrayContaining([expect.objectContaining({id:'SYNTHETIC_DELETED_REQUEST',projectId:a})]));
 const player={pause:vi.fn()} as unknown as HTMLAudioElement;core.getSnapshot().onSourcePreviewPlay!(player);
 core.getSnapshot().onDeleteMeeting!(a);await vi.waitFor(()=>{expect(core.getSnapshot().busy).toBe(false);expect(core.getSnapshot().projects.map(p=>p.id)).toEqual([b]);});
 expect(player.pause).toHaveBeenCalled();expect(revoked).toHaveBeenCalledWith(preview);
 expect(core.getSnapshot()).toMatchObject({selectedProjectId:null,historyProjectId:null,sourcePreviewUrl:null,sourceWaveform:null,sourcePreviewLoading:false});
 expect(core.getSnapshot().history).toEqual([]);expect(core.getSnapshot().uiDrafts).toEqual({[bKey]:'SYNTHETIC_B_DRAFT',settings:'SYNTHETIC_SHARED_DRAFT'});
 await core.lock();await core.unlock(phrase);
 expect(core.getSnapshot().projects.map(p=>p.id)).toEqual([b]);expect(core.getSnapshot().uiDrafts).toEqual({[bKey]:'SYNTHETIC_B_DRAFT',settings:'SYNTHETIC_SHARED_DRAFT'});
 const restored=await session.loadScreenState(createJobContext());expect(restored?.restore?.drafts).toEqual({[bKey]:'SYNTHETIC_B_DRAFT',settings:'SYNTHETIC_SHARED_DRAFT'});
 expect(restored?.restore?.selectedProjectId).not.toBe(a);expect(await session.store.readProject(a,createJobContext())).toBeNull();
});
