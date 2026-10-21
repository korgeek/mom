import { expect, it } from 'vitest';
import { migrateModelRegistrations, migrateRegistrationCredentials } from '../src/react-app/vault/model-registration-migration';
import { STT_MODELS } from '../src/react-app/providers/catalog';
import { emptyModelRegistry, mergeModelRegistry, observeSTTRoute, observeUnsupportedRoute, observeRouterSTTRoute, registryRouteKey, setRegistryAlias, setRegistryDefault, setRegistryEnabled } from '../src/react-app/providers/model-registry';
import { validateRegistration, registrationSignature, normalizeRegistrations } from '../src/react-app/providers/model-registrations';

const route = { connectionId: 'openai', provider: 'openai' as const, stage: 'stt' as const, modelId: 'whisper-1', endpointTag: null };
const key = registryRouteKey(route);
function registry() {
 const observed = mergeModelRegistry(emptyModelRegistry(), {connectionId:'openai',stage:'stt',status:'success',checkedAt:'2026-10-02T00:00:00Z',observations:[observeSTTRoute(route,STT_MODELS.find(m=>m.id==='whisper-1')!)]});
 return setRegistryAlias(setRegistryDefault(setRegistryEnabled(observed,key,true),'stt',key),key,'PRIVATE_ALIAS');
}
it('migrates exact legacy identity/default/evidence and encrypted versus session source keys without merging same model IDs',()=>{
 const direct=validateRegistration({id:'direct',name:'same model',stage:'stt',baseUrl:'https://api.openai.com/v1',modelId:'whisper-1',auth:'bearer',credentialOrigin:null,credentialVersion:0,enabled:true});
 const migrated=migrateModelRegistrations({version:1,entries:[direct]},registry(),{openai:'SYNTHETIC_PROVIDER','registration:direct':'SYNTHETIC_DIRECT'},new Set(),()=> 'new-id');
 expect(migrated.registrations.entries).toHaveLength(2);
 expect(migrated.registrations.entries[0]).toMatchObject({id:'direct',enabled:false});
 expect(migrated.registrations.entries[1]).toMatchObject({id:'new-id',name:'PRIVATE_ALIAS',stage:'stt',enabled:true,endpointUrl:'https://api.openai.com/v1/audio/transcriptions',credentialOrigin:'https://api.openai.com',keyStorage:'encrypted',stt:{maxBytes:24_900_000,responseFormat:'verbose_json',languageMode:'single',termMode:'prompt',timestamps:'segment',formats:['mp3','wav']}});
 expect(migrated.registrations.defaults.stt).toBe('new-id');
 expect(migrated.registrations.legacyRouteIds[key]).toBe('new-id');
 expect(migrated.registrations.entries[1].catalogEvidence).toEqual(registry().entries[0].acceptedMetadata);
 expect(migrated.values).toMatchObject({openai:'SYNTHETIC_PROVIDER','registration:direct':'SYNTHETIC_DIRECT','registration:new-id':'SYNTHETIC_PROVIDER'});
 const session=migrateModelRegistrations(undefined,registry(),{openai:'OLD_PERSISTENT'},new Set(['openai']),()=> 'session-id');
 expect(session.registrations.entries[0]).toMatchObject({keyStorage:'session',credentialVersion:1});
 expect(session.values['registration:session-id']).toBeUndefined();
 expect(session.sessionTransfers).toEqual([{sourceNamespace:'openai',targetId:'session-id'}]);
});
it('canonical v2 is idempotent and collision-safe migration preserves v1 IDs',()=>{
 const direct=validateRegistration({id:'collision',name:'old',stage:'llm',baseUrl:'http://localhost:8000/v1',modelId:'local',auth:'none',credentialOrigin:null,credentialVersion:0});
 const ids=['collision','distinct'];
 const migrated=migrateModelRegistrations({version:1,entries:[direct]},registry(),{},new Set(),()=>ids.shift()!);
 expect(migrated.registrations.entries.map(m=>m.id)).toEqual(['collision','distinct']);
 expect(migrateModelRegistrations(migrated.registrations,registry(),{},new Set(),()=>{throw Error('must not generate')})).toMatchObject({changed:false,registrations:migrated.registrations});
});
it('preserves long aliases from valid legacy entries',()=>{
 const alias='a'.repeat(200),legacy=setRegistryAlias(registry(),key,alias);
 expect(migrateModelRegistrations(undefined,legacy,{},new Set(),()=> 'alias').registrations.entries[0].name).toBe(alias);
});
it('retains exact unaccepted OpenRouter text endpoint identity without adopting unaccepted limits or pricing',()=>{
 const route={connectionId:'openrouter',provider:'openrouter' as const,stage:'minutes' as const,modelId:'fixture/model',endpointTag:'Private/Exact-Tag'};
 const observation=observeUnsupportedRoute(route,{name:'Unaccepted',source:'https://openrouter.ai/api/v1/models',checkedAt:'2026-10-02T00:00:00Z'});
 const legacy=mergeModelRegistry(emptyModelRegistry(),{connectionId:'openrouter',stage:'minutes',status:'success',checkedAt:'2026-10-02T00:00:00Z',observations:[observation]});
 const migrated=migrateModelRegistrations(undefined,legacy,{},new Set(),()=> 'unaccepted').registrations.entries[0];
 expect(migrated).toMatchObject({stage:'llm',routerEndpointTag:'Private/Exact-Tag',enabled:false});
 expect(migrated.catalogEvidence).toBeUndefined();expect(migrated.llm?.maxTokens).toBeUndefined();expect(migrated.llm?.contextTokens).toBeUndefined();
});
it('invalidates old success when migration changes the direct registration settings',()=>{
 const model=validateRegistration({id:'old-enabled',name:'old',stage:'llm',baseUrl:'http://localhost:8000/v1',modelId:'local',auth:'none',credentialOrigin:null,credentialVersion:0,enabled:true});
 const tested={...model,lastTest:{signature:registrationSignature(model),inputSignature:'synthetic',inputSummary:'fixture',state:'success' as const,status:200,elapsedMs:1,text:'synthetic',raw:'{}',message:'',requestedModel:'local',returnedModel:null,usage:null}};
 const migrated=migrateModelRegistrations({version:1,entries:[tested]},undefined,{},new Set()).registrations.entries[0];
 expect(migrated.enabled).toBe(false);expect(migrated.lastTest).toBeUndefined();
});
it('carries reviewed OpenRouter STT limits/policy and leaves unknown OpenAI limits incomplete',()=>{
 const route={connectionId:'router-connection',provider:'openrouter' as const,stage:'stt' as const,modelId:'openai/gpt-4o-mini-transcribe',endpointTag:null};
 const observed=observeRouterSTTRoute(route,{id:route.modelId,name:'Mini',source:'https://openrouter.ai/api/v1/models',checkedAt:'2026-10-02T00:00:00Z',inputModalities:['audio'],outputModalities:['transcription'],adapterStatus:'unsupported',pricing:{status:'unknown',raw:null}});
 const legacy={...mergeModelRegistry(emptyModelRegistry(),{connectionId:route.connectionId,stage:'stt',status:'success',checkedAt:'2026-10-02T00:00:00Z',observations:[observed]}),openRouterSTT:{[route.connectionId]:{policy:{dataCollection:'deny' as const,requireZdr:false},acknowledgedDisclosureVersion:'or-stt-1' as const,initialDefaultApplied:false}}};
 const migrated=migrateModelRegistrations(undefined,legacy,{},new Set(),()=> 'reviewed').registrations.entries[0];
 expect(migrated).toMatchObject({routerPolicy:{requireZdr:false,acknowledged:true},stt:{formats:['mp3','wav'],maxBytes:16_000_000,responseFormat:'json',languageMode:'single',routerRequireZdr:false}});
 const unknownRoute={connectionId:'openai',provider:'openai' as const,stage:'stt' as const,modelId:'unknown-model',endpointTag:null};
 const unknown=mergeModelRegistry(emptyModelRegistry(),{connectionId:'openai',stage:'stt',status:'success',checkedAt:'2026-10-02T00:00:00Z',observations:[observeUnsupportedRoute(unknownRoute,{name:'Unknown',source:'https://api.openai.com/v1/models',checkedAt:'2026-10-02T00:00:00Z'})]});
 expect(migrateModelRegistrations(undefined,unknown,{},new Set(),()=> 'unknown').registrations.entries[0].stt?.maxBytes).toBeUndefined();
});
it('rejects migration over the combined 150 model limit before returning any partial catalog',()=>{
 const direct=validateRegistration({id:'direct',name:'old',stage:'llm',baseUrl:'http://localhost:8000/v1',modelId:'local',auth:'none',credentialOrigin:null,credentialVersion:0});
 expect(()=>migrateModelRegistrations({version:1,entries:Array.from({length:150},(_,i)=>({...direct,id:'old-'+i}))},registry(),{},new Set(),()=> 'excess')).toThrow();
});
it('privately deduplicates equal encrypted keys only when origin and storage mode match',()=>{
 const model=validateRegistration({id:'one',name:'One',stage:'llm',baseUrl:'https://api.openai.com/v1',modelId:'test',auth:'bearer',credentialOrigin:'https://api.openai.com',credentialVersion:2});
 const registrations=normalizeRegistrations({version:2,entries:[model,{...model,id:'two'},{...model,id:'different',baseUrl:'https://example.com/v1',adapter:'openai-compatible',credentialOrigin:'https://example.com'}]});
 const migrated=migrateRegistrationCredentials(registrations,{'registration:one':'SYNTHETIC_EQUAL','registration:two':'SYNTHETIC_EQUAL','registration:different':'SYNTHETIC_EQUAL'},new Set());
 expect(migrated.registrations.credentials).toHaveLength(2);expect(migrated.registrations.entries[0].credentialId).toBe(migrated.registrations.entries[1].credentialId);expect(migrated.registrations.entries[2].credentialId).not.toBe(migrated.registrations.entries[0].credentialId);expect(Object.keys(migrated.values).every(key=>key.startsWith('credential:'))).toBe(true);
});
