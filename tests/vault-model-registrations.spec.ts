import { it, expect, afterEach, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBDatabase } from 'fake-indexeddb';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { emptyModelRegistry, mergeModelRegistry, observeSTTRoute, registryRouteKey, setRegistryAlias, setRegistryDefault, setRegistryEnabled } from '../src/react-app/providers/model-registry';
import { STT_MODELS } from '../src/react-app/providers/catalog';
import { openVaultDatabase, readHeader } from '../src/react-app/vault/store';
import { decryptRecord, encryptRecord, unwrapHeader, type RecordEnvelope } from '../src/react-app/vault/crypto';
import { createJobContext, cancelJobs } from '../src/react-app/domain/jobs';
import { validateRegistration, registrationSignature, type RegistrationTestResult } from '../src/react-app/providers/model-registrations';
const phrase = 'synthetic registration fixture passphrase';
const sessions: VaultSession[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const s of sessions.splice(0))
    await s.dispose(); cancelJobs(); });
const registration = () => validateRegistration({ id: 'fixture', name: 'PRIVATE_REGISTERED_MODEL', stage: 'llm', baseUrl: 'https://api.openai.com/v1', modelId: 'local-alias', auth: 'bearer', credentialVersion: 0, credentialOrigin: null });
async function fixtureWithDatabase() { const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(); const s = createVaultSession({ indexedDB, databaseName, testOnlyOwnership: { acquire: async () => () => { } } }); sessions.push(s); await s.create(phrase, phrase); return {s,indexedDB,databaseName}; }
async function fixture() { return (await fixtureWithDatabase()).s; }
const result = (signature: string): RegistrationTestResult => ({ signature, inputSignature: 'fixture-input', inputSummary: 'synthetic input', state: 'success', status: 200, elapsedMs: 10, text: 'synthetic output', raw: '{}', message: '', requestedModel: 'local-alias', returnedModel: null, usage: null });
it('loads legacy absence and preserves the old registry across encrypted roundtrip', async () => {
    const s = await fixture();
    expect(await s.loadModelRegistrations(createJobContext())).toEqual({ version: 2, entries: [], defaults: {stt:null,llm:null},legacyRouteIds:{},credentials:[] });
    const old = { version: 1 as const, entries: [], defaults: { stt: null, minutes: null }, lastCheckedAt: null };
    await s.saveModelRegistry(old, createJobContext());
    await s.saveModelRegistrations({ version: 1, entries: [registration()] }, createJobContext());
    await s.lock('manual');
    await s.unlock(phrase);
    expect((await s.loadModelRegistrations(createJobContext())).entries[0].name).toBe('PRIVATE_REGISTERED_MODEL');
    expect(await s.loadModelRegistry(createJobContext())).toEqual(old);
    await expect(s.saveModelRegistrations({ version: 3, entries: [] } as never, createJobContext())).rejects.toThrow();
    expect((await s.loadModelRegistrations(createJobContext())).entries).toHaveLength(1);
});
it('requires a saved registration, separates global keys, atomically versions replacements and invalidates old tests', async () => {
    const s = await fixture();
    await s.saveProviderKey('openai', 'SYNTHETIC_GLOBAL');
    await expect(s.saveRegistrationKey('fixture', 'SYNTHETIC_KEY', 'encrypted', createJobContext())).rejects.toThrow();
    await s.saveModelRegistrations({ version: 1, entries: [registration()] }, createJobContext());
    let c = await s.saveRegistrationKey('fixture', 'SYNTHETIC_KEY', 'encrypted', createJobContext());
    expect(await s.getProviderKey('openai')).toBe('SYNTHETIC_GLOBAL');
    expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_KEY');
    expect(c.entries[0].credentialVersion).toBe(1);
    await s.saveRegistrationTest('fixture', result(registrationSignature(c.entries[0])), createJobContext());
    c = await s.saveRegistrationKey('fixture', 'SYNTHETIC_NEXT', 'session', createJobContext());
    expect(c.entries[0].lastTest).toBeUndefined();
    expect(c.entries[0].credentialVersion).toBe(2);
    await s.lock('manual');
    await s.unlock(phrase);
    expect(await s.getProviderKey('registration:fixture')).toBeNull();
});
it('does not bind old secrets or old successes after an origin change', async () => {
    const s = await fixture();
    await s.saveModelRegistrations({ version: 1, entries: [registration()] }, createJobContext());
    const c = await s.saveRegistrationKey('fixture', 'SYNTHETIC_KEY', 'encrypted', createJobContext());
    await s.saveModelRegistrations({ version: 1, entries: [{ ...c.entries[0], baseUrl: 'http://localhost:8000/v1', adapter:'openai-compatible' }] }, createJobContext());
    const saved = (await s.loadModelRegistrations(createJobContext())).entries[0];
    expect(saved.credentialOrigin).toBeNull();
    await expect(s.saveRegistrationTest('fixture', result(registrationSignature(c.entries[0])), createJobContext())).rejects.toThrow();
});
it('a failed key transaction leaves both the prior key and prior version unchanged', async () => {
    const s = await fixture();
    await s.saveModelRegistrations({ version: 1, entries: [registration()] }, createJobContext());
    const old = await s.saveRegistrationKey('fixture', 'SYNTHETIC_OLD', 'encrypted', createJobContext());
    const native = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'records') {
        this.transaction.abort();
        throw new Error('synthetic quota');
    } return native.apply(this, args); });
    await expect(s.saveRegistrationKey('fixture', 'SYNTHETIC_NEW', 'session', createJobContext())).rejects.toThrow();
    spy.mockRestore();
    expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_OLD');
    expect(await s.loadModelRegistrations(createJobContext())).toEqual(old);
});
it('retains a completed test after a failed save and finalizes it on lock without another request', async () => {
    const s = await fixture();
    await s.saveModelRegistrations({ version: 1, entries: [registration()] }, createJobContext());
    const r = result(registrationSignature(registration()));
    const native = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'records') {
        this.transaction.abort();
        throw new Error('synthetic quota');
    } return native.apply(this, args); });
    await expect(s.saveRegistrationTest('fixture', r, createJobContext())).rejects.toThrow();
    await expect(s.lock('manual')).rejects.toThrow();
    expect(s.state).toBe('lock-save-failed');
    spy.mockRestore();
    await s.retryLock();
    await s.unlock(phrase);
    expect((await s.loadModelRegistrations(createJobContext())).entries[0].lastTest).toEqual(r);
});
it('atomically saves model and key, retaining v2 defaults and preserving test identity on name-only edits', async()=>{
 const s=await fixture(), job=createJobContext();
 let c=await s.saveRegisteredModel(registration(),{action:'replace',value:'  SYNTHETIC_ATOMIC  '},job);
 expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_ATOMIC');
 expect(c.entries[0]).toMatchObject({credentialVersion:1,revision:0,credentialOrigin:'https://api.openai.com'});
 c={...c,defaults:{stt:null,llm:'fixture'}};
 await s.saveModelRegistrations(c,job);
 const tested=result(registrationSignature(c.entries[0]));
 await s.saveRegistrationTest('fixture',tested,job);
 c=await s.saveRegisteredModel({...c.entries[0],name:'RENAMED',credentialVersion:999},{action:'keep'},job);
 expect(c.entries[0].lastTest).toEqual(tested);
 expect(c.entries[0].credentialVersion).toBe(1);
 expect(c.defaults).toEqual({stt:null,llm:'fixture'});
 c=await s.saveRegisteredModel({...c.entries[0],modelId:'changed'},{action:'keep'},job);
 expect(c.entries[0].revision).toBe(1);expect(c.entries[0].lastTest).toBeUndefined();
 const old=c,native=IDBObjectStore.prototype.put;
 const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='records'){this.transaction.abort();throw Error('synthetic quota')}return native.apply(this,args)});
 await expect(s.saveRegisteredModel({...c.entries[0],name:'SHOULD_ROLL_BACK',keyStorage:'session'},{action:'replace',value:'SYNTHETIC_REPLACEMENT'},job)).rejects.toThrow();spy.mockRestore();
 expect(await s.loadModelRegistrations(job)).toEqual(old);expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_ATOMIC');
});
it('moves kept credentials between encrypted/session storage and fences origin/auth and stage changes',async()=>{
 const s=await fixture(),job=createJobContext();
 let c=await s.saveRegisteredModel(registration(),{action:'replace',value:'SYNTHETIC_MOVE'},job);
 c=await s.saveRegisteredModel({...c.entries[0],keyStorage:'session'},{action:'keep'},job);
 expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_MOVE');
 c=await s.saveRegisteredModel({...c.entries[0],keyStorage:'encrypted'},{action:'keep'},job);
 await s.lock('manual');await s.unlock(phrase);
 expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_MOVE');
 await expect(s.saveRegisteredModel({...c.entries[0],stage:'stt'},{action:'keep'},createJobContext())).rejects.toThrow();
 c=await s.saveRegisteredModel({...c.entries[0],adapter:'openai-compatible',endpointUrl:'https://example.com/v1/chat/completions'},{action:'keep'},createJobContext());
 expect(c.entries[0].credentialOrigin).toBeNull();expect(await s.getProviderKey('registration:fixture')).toBeNull();
 c=await s.saveRegisteredModel({...c.entries[0],auth:'none'},{action:'replace',value:'SYNTHETIC_IGNORED'},createJobContext());
 expect(c.entries[0].credentialOrigin).toBeNull();expect(await s.getProviderKey('registration:fixture')).toBeNull();
});
it('explicit clear and no-auth remove secrets; malformed replacement and bulk imports leave prior state intact',async()=>{
 const s=await fixture(),job=createJobContext();
 let current=await s.saveRegisteredModel(registration(),{action:'replace',value:'SYNTHETIC_PRIOR'},job);
 for(const value of ['  ','line\nnext','x'.repeat(8193)]) await expect(s.saveRegisteredModel(current.entries[0],{action:'replace',value},job)).rejects.toThrow();
 current=await s.saveRegisteredModel(current.entries[0],{action:'replace',value:''},job);
 expect(current.entries[0].credentialVersion).toBe(1);expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_PRIOR');
 const before=await s.loadModelRegistrations(job);
 await expect(s.saveModelRegistrations({...before,entries:[...before.entries,{...registration(),id:'bad',baseUrl:'https://example.com/?key=bad'}]},job)).rejects.toThrow();
 await expect(s.saveModelRegistrations({...before,entries:Array.from({length:151},(_,i)=>({...registration(),id:'import-'+i}))},job)).rejects.toThrow();
 expect(await s.loadModelRegistrations(job)).toEqual(before);
 current=await s.saveRegisteredModel(current.entries[0],{action:'clear'},job);
 expect(current.entries[0]).toMatchObject({credentialVersion:2,credentialOrigin:null});expect(await s.getProviderKey('registration:fixture')).toBeNull();
});
it('commits an imported batch without disturbing existing secret/default/map/test metadata',async()=>{
 const s=await fixture(),job=createJobContext();
 const original=await s.saveRegisteredModel(registration(),{action:'replace',value:'SYNTHETIC_IMPORT_KEY'},job);
 const test=result(registrationSignature(original.entries[0]));await s.saveRegistrationTest('fixture',test,job);
 const before=await s.loadModelRegistrations(job);
 const values={...before,defaults:{stt:null,llm:'fixture'},legacyRouteIds:{'legacy-key':'fixture'},entries:[...before.entries,...Array.from({length:149},(_,i)=>({...registration(),id:'import-'+i,enabled:false}))]};
 await s.saveModelRegistrations(values,job);
 const saved=await s.loadModelRegistrations(job);
 expect(saved.entries).toHaveLength(150);expect(saved.defaults).toEqual(values.defaults);expect(saved.legacyRouteIds).toEqual(values.legacyRouteIds);expect(saved.entries[0].lastTest).toEqual(test);expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_IMPORT_KEY');
});
function legacyRegistry() {
 const route={connectionId:'custom-openai-connection',provider:'openai' as const,stage:'stt' as const,modelId:'whisper-1',endpointTag:null},key=registryRouteKey(route);
 const observed=mergeModelRegistry(emptyModelRegistry(),{connectionId:route.connectionId,stage:'stt',status:'success',checkedAt:'2026-10-02T00:00:00Z',observations:[observeSTTRoute(route,STT_MODELS.find(m=>m.id===route.modelId)!)]});
 return {registry:setRegistryAlias(setRegistryDefault(setRegistryEnabled(observed,key,true),'stt',key),key,'LEGACY_PRIVATE_ALIAS'),key};
}
async function encryptedRows(indexedDB:IDBFactory,databaseName:string) {
 const db=await openVaultDatabase(indexedDB,databaseName);
 const rows=await new Promise<RecordEnvelope[]>((resolve,reject)=>{const r=db.transaction('records').objectStore('records').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();return rows;
}
it('durably migrates legacy keys/defaults once, preserves source namespaces and leaves project records untouched',async()=>{
 const {s,indexedDB,databaseName}=await fixtureWithDatabase(),{registry,key}=legacyRegistry();
 await s.saveModelRegistry(registry,createJobContext());await s.saveProviderKey('openai','SYNTHETIC_LEGACY');await s.saveProviderKey('custom-openai-connection','SYNTHETIC_DIFFERENT_NAMESPACE');
 const project={id:crypto.randomUUID(),title:'SYNTHETIC_HISTORY',icon:'mic',color:'cobalt',pinned:false,createdAt:'2026-10-02T00:00:00Z',updatedAt:'2026-10-02T00:00:00Z',sourceAssets:[],preparedChunks:[],audioOptions:{chunkMinutes:10 as const,overlapSeconds:10 as const,expectedLanguages:['ko'],bitrateKbps:32 as const,sampleRateHz:16000 as const},rawTranscripts:[],transcriptVersions:[],selectedTranscriptVersionId:null,minutesSettings:{outputLanguage:'ko',sections:['summary' as const],instructions:'',modelId:''},minutesRuns:[],minutesRevisions:[],selectedMinutesRevisionId:null,runs:[]};
 await s.store.checkpoint({project,runId:null,audioRecords:[]},createJobContext());
 const rows=await encryptedRows(indexedDB,databaseName),oldProject=rows.find(r=>r.recordId===project.id);
 const migrated=await s.loadModelRegistrations(createJobContext()),id=migrated.legacyRouteIds![key];
 expect(migrated.defaults!.stt).toBe(id);expect(await s.getProviderKey('registration:'+id)).toBe('SYNTHETIC_LEGACY');expect(await s.getProviderKey('openai')).toBe('SYNTHETIC_LEGACY');expect(await s.getProviderKey('custom-openai-connection')).toBe('SYNTHETIC_DIFFERENT_NAMESPACE');
 expect((await encryptedRows(indexedDB,databaseName)).find(r=>r.recordId===project.id)).toEqual(oldProject);
 expect(await s.loadModelRegistry(createJobContext())).toEqual(registry);
 await s.lock('manual');await s.unlock(phrase);
 expect(await s.loadModelRegistrations(createJobContext())).toEqual(migrated);expect(await s.store.readProject(project.id,createJobContext())).toEqual(project);
 await s.saveModelRegistry(emptyModelRegistry(),createJobContext());expect(await s.loadModelRegistrations(createJobContext())).toEqual(migrated);
});
it('keeps session legacy keys out of durable secrets and does not duplicate models after lock',async()=>{
 const {s,indexedDB,databaseName}=await fixtureWithDatabase(),{registry,key}=legacyRegistry();
 await s.saveModelRegistry(registry,createJobContext());await s.saveProviderKey('openai','SYNTHETIC_SESSION','session');
 const migrated=await s.loadModelRegistrations(createJobContext()),id=migrated.legacyRouteIds![key];
 expect(migrated.entries[0].keyStorage).toBe('session');expect(await s.getProviderKey('registration:'+id)).toBe('SYNTHETIC_SESSION');
 const db=await openVaultDatabase(indexedDB,databaseName),header=(await readHeader(db))!,keyMaterial=await unwrapHeader(phrase,header);
 const row=(await encryptedRows(indexedDB,databaseName)).find(r=>r.recordId===header.secretRecordId)!;
 const plaintext=await decryptRecord(keyMaterial,header,header.secretRecordId,row);expect(JSON.parse(new TextDecoder().decode(plaintext)).values).toEqual({});plaintext.fill(0);db.close();
 await s.lock('manual');await s.unlock(phrase);expect(await s.getProviderKey('registration:'+id)).toBeNull();expect(await s.loadModelRegistrations(createJobContext())).toEqual(migrated);
});
it('a failed migration transaction leaves the prior catalog and secret ciphertext available for retry',async()=>{
 const {s,indexedDB,databaseName}=await fixtureWithDatabase(),{registry}=legacyRegistry();await s.saveModelRegistry(registry,createJobContext());await s.saveProviderKey('openai','SYNTHETIC_RETRY');
 const before=await encryptedRows(indexedDB,databaseName),native=IDBObjectStore.prototype.put;
 let writes=0;const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='records'&&++writes===2){this.transaction.abort();throw Error('synthetic quota')}return native.apply(this,args)});
 await expect(s.loadModelRegistrations(createJobContext())).rejects.toThrow();spy.mockRestore();
 expect(await encryptedRows(indexedDB,databaseName)).toEqual(before);expect(await s.loadModelRegistry(createJobContext())).toEqual(registry);expect(await s.getProviderKey('openai')).toBe('SYNTHETIC_RETRY');
 const migrated=await s.loadModelRegistrations(createJobContext());expect(migrated.entries).toHaveLength(1);expect(await s.getProviderKey('registration:'+migrated.entries[0].id)).toBe('SYNTHETIC_RETRY');
});
it('migration recognizes a raw v1 catalog after recovery and preserves direct model IDs alongside legacy entries',async()=>{
 const {s,indexedDB,databaseName}=await fixtureWithDatabase(),{registry}=legacyRegistry();await s.saveModelRegistry(registry,createJobContext());await s.saveProviderKey('openai','SYNTHETIC_OLD');await s.lock('manual');
 const db=await openVaultDatabase(indexedDB,databaseName),header=(await readHeader(db))!,material=await unwrapHeader(phrase,header);
 const rows=await encryptedRows(indexedDB,databaseName),row=rows.find(r=>r.recordId===header.vaultId)!;
 const bytes=await decryptRecord(material,header,header.vaultId,row),catalog=JSON.parse(new TextDecoder().decode(bytes));bytes.fill(0);catalog.modelRegistrations={version:1,entries:[registration()]};
 const replacement=await encryptRecord(material,header,header.vaultId,new TextEncoder().encode(JSON.stringify(catalog)),crypto.getRandomValues(new Uint8Array(12)));
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(replacement);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});db.close();
 await s.unlock(phrase);const migrated=await s.loadModelRegistrations(createJobContext());expect(migrated.entries).toHaveLength(2);expect(migrated.entries[0]).toMatchObject({id:'fixture',enabled:false});
});
it('a lock after a committed session transition never republishes its key map',async()=>{
 const s=await fixture();const current=await s.saveRegisteredModel(registration(),{action:'replace',value:'SYNTHETIC_LOCK'},createJobContext());
 const native=IDBDatabase.prototype.transaction;let locking:Promise<void>|undefined;
 const spy=vi.spyOn(IDBDatabase.prototype,'transaction').mockImplementation(function(this:IDBDatabase,...args:Parameters<IDBDatabase['transaction']>){const tx=native.apply(this,args);if(args[1]==='readwrite'&&Array.isArray(args[0])&&args[0].includes('records')&&!args[0].includes('nonces'))tx.addEventListener('complete',()=>{locking??=s.lock('manual')},{once:true});return tx});
 await expect(s.saveRegisteredModel({...current.entries[0],keyStorage:'session'},{action:'keep'},createJobContext())).rejects.toThrow();await locking;spy.mockRestore();await s.unlock(phrase);expect(await s.getProviderKey('registration:fixture')).toBeNull();expect((await s.loadModelRegistrations(createJobContext())).entries[0].keyStorage).toBe('session');
});
it('bulk configuration changes cannot silently move an existing key into session storage',async()=>{
 const s=await fixture(),job=createJobContext(),current=await s.saveRegisteredModel(registration(),{action:'replace',value:'SYNTHETIC_BULK_MODE'},job);
 await expect(s.saveModelRegistrations({...current,entries:[{...current.entries[0],keyStorage:'session'}]},job)).rejects.toThrow();
 expect(await s.loadModelRegistrations(job)).toEqual(current);expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_BULK_MODE');
});
it('snapshots atomic model/key and bulk inputs at invocation before waiting behind other writes',async()=>{
 const s=await fixture(),job=createJobContext(),model={...registration()},update={action:'replace' as const,value:'SYNTHETIC_SNAPSHOT'};
 const saving=s.saveRegisteredModel(model,update,job);model.name='MUTATED_AFTER_CALL';update.value='SYNTHETIC_MUTATED';
 let saved=await saving;expect(saved.entries[0].name).toBe('PRIVATE_REGISTERED_MODEL');expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_SNAPSHOT');
 const input={...saved,entries:[{...saved.entries[0],name:'BULK_SNAPSHOT'}]},bulk=s.saveModelRegistrations(input,job);input.entries[0].name='BULK_MUTATED';await bulk;saved=await s.loadModelRegistrations(job);expect(saved.entries[0].name).toBe('BULK_SNAPSHOT');
});
it('retries a fenced migration receipt using the retained provider session key without duplicating registrations',async()=>{
 const s=await fixture(),{registry}=legacyRegistry();await s.saveModelRegistry(registry,createJobContext());await s.saveProviderKey('openai','SYNTHETIC_FENCED_SESSION','session');
 const native=IDBDatabase.prototype.transaction;let cancelled=false;
 const spy=vi.spyOn(IDBDatabase.prototype,'transaction').mockImplementation(function(this:IDBDatabase,...args:Parameters<IDBDatabase['transaction']>){const tx=native.apply(this,args);if(args[1]==='readwrite'&&Array.isArray(args[0])&&args[0].includes('records')&&!args[0].includes('nonces'))tx.addEventListener('complete',()=>{if(!cancelled){cancelled=true;cancelJobs()}},{once:true});return tx});
 await expect(s.loadModelRegistrations(createJobContext())).rejects.toThrow();spy.mockRestore();
 const migrated=await s.loadModelRegistrations(createJobContext());expect(migrated.entries).toHaveLength(1);expect(await s.getProviderKey('registration:'+migrated.entries[0].id)).toBe('SYNTHETIC_FENCED_SESSION');
});
async function seedPreCredentialCatalog(indexedDB:IDBFactory,databaseName:string,entry:ReturnType<typeof registration>){
 const db=await openVaultDatabase(indexedDB,databaseName),header=(await readHeader(db))!,material=await unwrapHeader(phrase,header);
 const row=(await encryptedRows(indexedDB,databaseName)).find(r=>r.recordId===header.vaultId)!,bytes=await decryptRecord(material,header,header.vaultId,row),catalog=JSON.parse(new TextDecoder().decode(bytes));bytes.fill(0);
 catalog.modelRegistrations={version:2,entries:[entry],defaults:{stt:null,llm:entry.id},legacyRouteIds:{}};
 const replacement=await encryptRecord(material,header,header.vaultId,new TextEncoder().encode(JSON.stringify(catalog)),crypto.getRandomValues(new Uint8Array(12)));
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(replacement);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error)});db.close();
}
it('atomically migrates a pre-credential v2 registration secret into named credential storage across reload',async()=>{
 const {s,indexedDB,databaseName}=await fixtureWithDatabase();await s.saveProviderKey('registration:fixture','SYNTHETIC_PRE_CREDENTIAL');
 await seedPreCredentialCatalog(indexedDB,databaseName,{...registration(),credentialOrigin:'https://api.openai.com',credentialVersion:3});
 const migrated=await s.loadModelRegistrations(createJobContext()),id=migrated.entries[0].credentialId!;
 expect(migrated.credentials).toEqual([{id,name:'PRIVATE_REGISTERED_MODEL',origin:'https://api.openai.com',keyStorage:'encrypted',version:3}]);expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_PRE_CREDENTIAL');
 const rows=await encryptedRows(indexedDB,databaseName);expect(JSON.stringify(rows)).not.toContain('SYNTHETIC_PRE_CREDENTIAL');expect(JSON.stringify(rows)).not.toContain('PRIVATE_REGISTERED_MODEL');
 await s.lock('manual');await s.unlock(phrase);expect(await s.loadModelRegistrations(createJobContext())).toEqual(migrated);expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_PRE_CREDENTIAL');
 const db=await openVaultDatabase(indexedDB,databaseName),header=(await readHeader(db))!,key=await unwrapHeader(phrase,header),secret=(await encryptedRows(indexedDB,databaseName)).find(r=>r.recordId===header.secretRecordId)!;
 const bytes=await decryptRecord(key,header,header.secretRecordId,secret),values=JSON.parse(new TextDecoder().decode(bytes)).values;bytes.fill(0);db.close();expect(values).toEqual({['credential:'+id]:'SYNTHETIC_PRE_CREDENTIAL'});
});
it('migrates a live registration session key without persisting it and keeps the reusable metadata after lock',async()=>{
 const {s,indexedDB,databaseName}=await fixtureWithDatabase();await s.saveProviderKey('registration:fixture','SYNTHETIC_OLD_SESSION','session');
 await seedPreCredentialCatalog(indexedDB,databaseName,{...registration(),credentialOrigin:'https://api.openai.com',credentialVersion:2,keyStorage:'session'});
 const migrated=await s.loadModelRegistrations(createJobContext());expect(migrated.credentials![0].keyStorage).toBe('session');expect(await s.getProviderKey('registration:fixture')).toBe('SYNTHETIC_OLD_SESSION');
 await s.lock('manual');await s.unlock(phrase);expect(await s.loadModelRegistrations(createJobContext())).toEqual(migrated);expect(await s.getProviderKey('registration:fixture')).toBeNull();
});
