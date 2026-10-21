import {afterEach,expect,it,vi} from 'vitest';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {createVaultSession,type VaultSession} from '../src/react-app/vault/session';
import {cancelJobs,createJobContext} from '../src/react-app/domain/jobs';
import {validateRegistration,registrationSignature,normalizeRegistrations,registrationReadiness,buildRegistrationRequest} from '../src/react-app/providers/model-registrations';
import {createModelPreset,exportModelProfiles,importModelProfiles} from '../src/react-app/providers/model-profiles';
const phrase='synthetic shared credential passphrase',sessions:VaultSession[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const session of sessions.splice(0))await session.dispose();cancelJobs()});
async function fixture(){const session=createVaultSession({indexedDB:new IDBFactory(),databaseName:crypto.randomUUID(),testOnlyOwnership:{acquire:async()=>()=>{}}});sessions.push(session);await session.create(phrase,phrase);return session}
function model(id='llm',stage:'stt'|'llm'='llm'){return validateRegistration({id,name:id,stage,baseUrl:'https://api.openai.com/v1',auth:'bearer',modelId:stage==='stt'?'whisper-1':'gpt-4.1-mini',credentialVersion:0,credentialOrigin:null})}
const testResult=(entry:ReturnType<typeof model>)=>({signature:registrationSignature(entry),inputSignature:'fixture',inputSummary:'synthetic',state:'success' as const,status:200,elapsedMs:1,text:'synthetic',raw:'{}',message:'',requestedModel:entry.modelId,returnedModel:null,usage:null});
it('stores one named credential separately and binds STT plus LLM without copying secret values into model config',async()=>{
 const s=await fixture(),job=createJobContext();
 let c=await s.saveApiCredential({id:'shared',name:'My OpenAI key',origin:'https://api.openai.com',keyStorage:'encrypted',version:0},{action:'replace',value:'SYNTHETIC_SHARED'},job);
 expect(c.credentials).toEqual([{id:'shared',name:'My OpenAI key',origin:'https://api.openai.com',keyStorage:'encrypted',version:1}]);
 c=await s.saveRegisteredModel({...model(),credentialId:'shared'},{action:'keep'},job);
 c=await s.saveRegisteredModel({...model('stt','stt'),credentialId:'shared'},{action:'keep'},job);
 expect(c.entries.map(entry=>entry.credentialId)).toEqual(['shared','shared']);
 expect(await s.getProviderKey('registration:llm')).toBe('SYNTHETIC_SHARED');expect(await s.getProviderKey('registration:stt')).toBe('SYNTHETIC_SHARED');
 expect(JSON.stringify(c)).not.toContain('SYNTHETIC_SHARED');
 const exported=exportModelProfiles(c.entries);expect(exported).not.toContain('credentialId');expect(exported).not.toContain('My OpenAI key');
 expect(()=>importModelProfiles(JSON.stringify({format:'mom-models',version:1,models:[{...JSON.parse(exported).models[0],credentialId:'shared'}]}))).toThrow();
});
it('rotates shared credentials atomically, invalidates both models, and distinguishes model detach from credential deletion',async()=>{
 const s=await fixture(),job=createJobContext();let c=await s.saveRegisteredModel(model(),{action:'replace',name:'Shared',value:'SYNTHETIC_FIRST'},job);const id=c.entries[0].credentialId!;
 c=await s.saveRegisteredModel({...model('stt','stt'),credentialId:id},{action:'keep'},job);
 for(const entry of c.entries)await s.saveRegistrationTest(entry.id,testResult(entry),job);
 c=await s.saveApiCredential({...c.credentials![0],name:'Renamed'},{action:'replace',value:'SYNTHETIC_SECOND'},job);
 expect(c.entries.every(entry=>entry.credentialVersion===2&&!entry.lastTest)).toBe(true);expect(c.entries.every(entry=>(entry.revision??0)>0)).toBe(true);
 expect(await s.getProviderKey('registration:stt')).toBe('SYNTHETIC_SECOND');
 c=await s.saveRegisteredModel(c.entries[0],{action:'clear'},job);expect(c.credentials).toHaveLength(1);expect(c.entries[0].credentialId).toBeUndefined();expect(await s.getProviderKey('registration:llm')).toBeNull();expect(await s.getProviderKey('registration:stt')).toBe('SYNTHETIC_SECOND');
 c=await s.deleteApiCredential(id,job);expect(c.credentials).toEqual([]);expect(c.entries.every(entry=>!entry.credentialId&&entry.credentialOrigin===null)).toBe(true);expect(await s.getProviderKey('registration:stt')).toBeNull();
});
it('rejects wrong-origin bindings and failed rotations without affecting shared configuration or secret',async()=>{
 const s=await fixture(),job=createJobContext();const before=await s.saveRegisteredModel(model(),{action:'replace',value:'SYNTHETIC_OLD'},job),id=before.entries[0].credentialId!;
 await expect(s.saveRegisteredModel({...model('wrong'),baseUrl:'https://example.com/v1',adapter:'openai-compatible',credentialId:id},{action:'keep'},job)).rejects.toThrow();
 const native=IDBObjectStore.prototype.put,spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='records'){this.transaction.abort();throw Error('synthetic quota')}return native.apply(this,args)});
 await expect(s.saveApiCredential(before.credentials![0],{action:'replace',value:'SYNTHETIC_NEW'},job)).rejects.toThrow();spy.mockRestore();expect(await s.loadModelRegistrations(job)).toEqual(before);expect(await s.getProviderKey('registration:llm')).toBe('SYNTHETIC_OLD');
});
it('moves shared storage once for all linked models and refuses to persist an unavailable session key',async()=>{
 const s=await fixture(),job=createJobContext();let c=await s.saveRegisteredModel(model(),{action:'replace',value:'SYNTHETIC_MODE'},job);const id=c.entries[0].credentialId!;
 c=await s.saveRegisteredModel({...model('stt','stt'),credentialId:id},{action:'keep'},job);
 c=await s.saveApiCredential({...c.credentials![0],keyStorage:'session'},{action:'keep'},job);expect(c.entries.every(entry=>entry.keyStorage==='session')).toBe(true);expect(await s.getProviderKey('registration:llm')).toBe('SYNTHETIC_MODE');
 await s.lock('manual');await s.unlock(phrase);c=await s.loadModelRegistrations(createJobContext());expect(c.credentials![0].keyStorage).toBe('session');expect(await s.getProviderKey('registration:stt')).toBeNull();
 await expect(s.saveApiCredential({...c.credentials![0],keyStorage:'encrypted'},{action:'keep'},createJobContext())).rejects.toThrow();expect((await s.loadModelRegistrations(createJobContext())).credentials![0].keyStorage).toBe('session');
});
it('validates credential metadata and references without including values',()=>{
 const c={id:'shared',name:'Shared',origin:'https://api.openai.com',keyStorage:'encrypted',version:1};
 const normalized=normalizeRegistrations({version:2,entries:[{...model(),credentialId:'shared',keyStorage:'session',credentialVersion:99}],credentials:[c]});expect(normalized.credentials).toEqual([c]);expect(normalized.entries[0]).toMatchObject({keyStorage:'encrypted',credentialOrigin:c.origin,credentialVersion:1});
 for(const bad of [{...c,origin:'https://api.openai.com/path'},{...c,id:'bad:id'},{...c,keyStorage:'plain'},{...c,value:'SYNTHETIC'}])expect(()=>normalizeRegistrations({version:2,entries:[],credentials:[bad]})).toThrow();
 expect(()=>normalizeRegistrations({version:2,entries:[{...model(),credentialId:'unknown'}],credentials:[c]})).toThrow();
});
it('applies an API retention policy to both stages, invalidates tests atomically, and preserves frozen requests',async()=>{
 const s=await fixture(),job=createJobContext();
 let c=await s.saveApiCredential({id:'router',name:'Router',origin:'https://openrouter.ai',keyStorage:'encrypted',version:0,routerPolicy:{requireZdr:false,acknowledged:true}},{action:'replace',value:'SYNTHETIC_ROUTER'},job);
 for(const id of ['mai-transcribe-2','openrouter-text'])c=await s.saveRegisteredModel({...createModelPreset(id),credentialId:'router',enabled:true},{action:'keep'},job);
 for(const entry of c.entries)await s.saveRegistrationTest(entry.id,testResult(entry),job);
 const before=structuredClone(c.entries);
 c=await s.saveApiCredential({...c.credentials![0],routerPolicy:{requireZdr:true,acknowledged:false}},{action:'keep'},job);
 expect(c.entries.every(entry=>entry.routerPolicy?.requireZdr===true&&!entry.routerPolicy.acknowledged&&!entry.lastTest)).toBe(true);
 expect(c.entries.every((entry,i)=>(entry.revision??0)>(before[i].revision??0)&&registrationSignature(entry)!==registrationSignature(before[i]))).toBe(true);
 expect(c.entries.every(entry=>registrationReadiness(entry).includes('router-disclosure'))).toBe(true);
 expect(c.entries[0].stt?.routerRequireZdr).toBe(true);
 expect(before.every(entry=>entry.routerPolicy?.requireZdr===false)).toBe(true);
 expect(await s.getProviderKey('registration:'+c.entries[0].id)).toBe('SYNTHETIC_ROUTER');
 c=await s.saveApiCredential({...c.credentials![0],routerPolicy:{requireZdr:true,acknowledged:true}},{action:'keep'},job);
 await s.lock('manual');await s.unlock(phrase);c=await s.loadModelRegistrations(createJobContext());
 expect(c.entries.every(entry=>entry.routerPolicy?.acknowledged===true&&entry.routerPolicy.requireZdr===true)).toBe(true);
 const body=JSON.parse(buildRegistrationRequest(c.entries[1],{stage:'llm',transcript:'Synthetic',outputLanguage:'ko',sections:['summary'],instructions:''}).body as string);
 expect(body.provider).toMatchObject({data_collection:'deny',zdr:true,allow_fallbacks:false});
});
it('rejects malformed or wrong-provider API policies while preserving legacy model policies until API review',()=>{
 const meta={id:'router',name:'Router',origin:'https://openrouter.ai',keyStorage:'encrypted',version:1};
 const entry={...createModelPreset('mai-transcribe-2'),credentialId:'router',routerPolicy:{requireZdr:false,acknowledged:true},stt:{routerRequireZdr:false}};
 expect(normalizeRegistrations({version:2,entries:[entry],credentials:[meta]}).entries[0].routerPolicy).toEqual({requireZdr:false,acknowledged:true});
 for(const policy of [{requireZdr:'true',acknowledged:true},{requireZdr:true,acknowledged:true,extra:true},null])expect(()=>normalizeRegistrations({version:2,entries:[],credentials:[{...meta,routerPolicy:policy}]})).toThrow();
 expect(()=>normalizeRegistrations({version:2,entries:[],credentials:[{...meta,origin:'https://api.openai.com',routerPolicy:{requireZdr:true,acknowledged:true}}]})).toThrow();
});
it('retains the API policy and linked model revisions after a failed policy save',async()=>{
 const s=await fixture(),job=createJobContext();let before=await s.saveApiCredential({id:'router',name:'Router',origin:'https://openrouter.ai',keyStorage:'encrypted',version:0,routerPolicy:{requireZdr:true,acknowledged:true}},{action:'replace',value:'SYNTHETIC_POLICY'},job);
 before=await s.saveRegisteredModel({...createModelPreset('openrouter-text'),credentialId:'router'},{action:'keep'},job);
 const put=IDBObjectStore.prototype.put,failure=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='records'){this.transaction.abort();throw Error('synthetic quota')}return put.apply(this,args)});
 await expect(s.saveApiCredential({...before.credentials![0],routerPolicy:{requireZdr:false,acknowledged:true}},{action:'keep'},job)).rejects.toThrow();failure.mockRestore();
 expect(await s.loadModelRegistrations(job)).toEqual(before);expect(await s.getProviderKey('registration:'+before.entries[0].id)).toBe('SYNTHETIC_POLICY');
});
