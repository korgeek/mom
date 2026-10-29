import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createVaultSession, VaultAttemptError, type Ownership, type VaultSession } from '../src/react-app/vault/session';
import { openVaultDatabase, readHeader, readVaultAuthPolicy, writeInitialHeader } from '../src/react-app/vault/store';
import { createHeader } from '../src/react-app/vault/crypto';
import { createJobContext } from '../src/react-app/domain/jobs';

const good = 'synthetic valid passphrase', bad = 'synthetic incorrect passphrase';
const sessions: VaultSession[] = [];
function fixture() {
 const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(), held = new Set<string>();
 const ownership: Ownership = { async acquire(name) { if (held.has(name)) return null; held.add(name); return () => { held.delete(name); }; } };
 const make = () => { const s=createVaultSession({indexedDB,databaseName,testOnlyOwnership:ownership,screenLockManaged:true}); sessions.push(s); return s; };
 return { indexedDB, databaseName, make };
}
async function policy(f: ReturnType<typeof fixture>) {
 const db=await openVaultDatabase(f.indexedDB,f.databaseName); try { const header=await readHeader(db); return header ? await readVaultAuthPolicy(db,header.vaultId) : null; } finally { db.close(); }
}
afterEach(async()=>{vi.restoreAllMocks(); for(const s of sessions.splice(0)) await s.dispose();});

it('migrates a legacy vault lazily and retains compatibility with an existing eight-character passphrase',async()=>{
 const f=fixture(),db=await openVaultDatabase(f.indexedDB,f.databaseName),created=await createHeader('Eight123',crypto.randomUUID());
 await writeInitialHeader(db,created.header,created.key,()=>{}); db.close();
 const s=f.make(); await s.unlock('Eight123'); expect(s.state).toBe('unlocked');
 expect((await policy(f))?.failures).toBe(0);
});
it('requires the new passphrase policy at the creation boundary without creating a header',async()=>{
 const f=fixture(),s=f.make(); await expect(s.create('Eight123','Eight123')).rejects.toThrow();
 expect(await policy(f)).toBeNull(); await s.create(good,good); expect(s.state).toBe('unlocked');
});

it('shares persistent failure count across screen reauthentication and full unlock; success resets it',async()=>{
 const f=fixture(),a=f.make(),b=f.make(); await a.create(good,good);
 for(let count=1;count<=3;count++) { await expect(a.verifyScreenPassphrase(bad)).rejects.toMatchObject({failures:count}); }
 expect((await policy(f))?.failures).toBe(3);
 await expect(b.unlock(bad)).rejects.not.toBeInstanceOf(VaultAttemptError);
 expect((await policy(f))?.failures).toBe(3);
 await a.lock('manual'); await expect(b.unlock(bad)).rejects.toMatchObject({failures:4});
 await b.unlock(good); expect((await policy(f))?.failures).toBe(0);
});
it('persists the deletion latch when atomic reset fails, blocks decryption, and retries deletion after reopening',async()=>{
 const f=fixture(),a=f.make(); await a.create(good,good); await a.lock('manual');
 for(let count=1;count<=4;count++) await expect(a.unlock(bad)).rejects.toMatchObject({failures:count});
 const clear=vi.spyOn(IDBObjectStore.prototype,'clear').mockImplementationOnce(()=>{throw new Error('synthetic storage failure');});
 await expect(a.unlock(bad)).rejects.toMatchObject({failures:5,pendingDeletion:true});
 expect(await policy(f)).toMatchObject({failures:5,pendingDeletion:true}); clear.mockRestore();
 const b=f.make(); await expect(b.unlock(good)).rejects.toMatchObject({failures:5,deleted:true});
 expect(await policy(f)).toBeNull();
});
it('never lets a stale deletion retry erase a replacement vault',async()=>{
 const f=fixture(),a=f.make(),b=f.make(); await a.create(good,good); await a.lock('manual');
 for(let count=1;count<=4;count++) await expect(a.unlock(bad)).rejects.toMatchObject({failures:count});
 const clear=vi.spyOn(IDBObjectStore.prototype,'clear').mockImplementationOnce(()=>{throw new Error('synthetic storage failure');});
 await expect(a.unlock(bad)).rejects.toMatchObject({pendingDeletion:true}); clear.mockRestore();
 await b.reset(); await b.create('replacement synthetic passphrase','replacement synthetic passphrase'); await b.lock('manual');
 const before=await policy(f); await expect(a.reset()).rejects.toThrow();
 expect(await policy(f)).toEqual(before); await b.unlock('replacement synthetic passphrase');
});
it('counts short and numeric incorrect candidates, while overlong inputs do not count',async()=>{
 const f=fixture(),s=f.make(); await s.create(good,good); await s.lock('manual');
 for(const [candidate,count] of [['x',1],['123456',2]] as const) await expect(s.unlock(candidate)).rejects.toMatchObject({failures:count});
 await expect(s.unlock('z'.repeat(257))).rejects.not.toBeInstanceOf(VaultAttemptError);
 expect((await policy(f))?.failures).toBe(2);
 await s.unlock(good); await expect(s.verifyScreenPassphrase('1')).rejects.toMatchObject({failures:1});
});
it('shows the crypto limitation: a corrupted wrapped key also fails even with the correct passphrase',async()=>{
 const f=fixture(),s=f.make(); await s.create(good,good); await s.lock('manual');
 const db=await openVaultDatabase(f.indexedDB,f.databaseName),header=(await readHeader(db))!;
 const bytes=Uint8Array.from(atob(header.wrappedKey),c=>c.charCodeAt(0)); bytes[0]^=1;
 const wrappedKey=btoa(Array.from(bytes,c=>String.fromCharCode(c)).join(''));
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('header','readwrite');tx.objectStore('header').put({...header,wrappedKey});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);}); db.close();
 for(let count=1;count<=4;count++) await expect(s.unlock(good)).rejects.toMatchObject({failures:count});
 await expect(s.unlock(good)).rejects.toMatchObject({failures:5,deleted:true}); expect(await policy(f)).toBeNull();
});
it('rejects overlapping screen verification without counting it twice and deletes after the fifth real failure',async()=>{
 const f=fixture(),a=f.make(); await a.create(good,good);
 const first=a.verifyScreenPassphrase(bad), second=a.verifyScreenPassphrase(bad);
 await expect(second).rejects.not.toBeInstanceOf(VaultAttemptError); await expect(first).rejects.toMatchObject({failures:1});
 for(let count=2;count<=4;count++) await expect(a.verifyScreenPassphrase(bad)).rejects.toMatchObject({failures:count});
 const active=createJobContext();
 await expect(a.verifyScreenPassphrase(bad)).rejects.toMatchObject({failures:5,deleted:true});
 expect(active.signal.aborted).toBe(true);
 expect(a.state).toBe('locked'); expect(await policy(f)).toBeNull();
});
