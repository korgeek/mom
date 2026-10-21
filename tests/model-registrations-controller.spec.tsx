import { afterEach, it, expect, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession } from '../src/react-app/vault/session';
import { validateRegistration } from '../src/react-app/providers/model-registrations';
import { cancelJobs } from '../src/react-app/domain/jobs';
const cores: MeetingController[] = [];
const phrase = 'synthetic registration controller phrase';
afterEach(async () => { vi.restoreAllMocks(); for (const c of cores.splice(0))
    await c.dispose(); cancelJobs(); });
const reg = () => validateRegistration({ id: 'fixture', stage: 'llm', name: 'PRIVATE_FIXTURE_REGISTRATION', baseUrl: 'https://api.openai.com/v1', modelId: 'fixture-alias', auth: 'bearer', credentialVersion: 0, credentialOrigin: null });
const input = { stage: 'llm' as const, transcript: 'Synthetic meeting. Review approved.', outputLanguage: 'ko', sections: ['summary'], instructions: '' };
async function fixture(fetch: typeof globalThis.fetch) { const core = createMeetingController({ indexedDB: new IDBFactory(), databaseName: crypto.randomUUID(), fetch, sessionFactory: o => createVaultSession({ ...o, testOnlyOwnership: { acquire: async () => () => { } } }) }); cores.push(core); await core.initialize(); await core.createVault(phrase); return core; }
it('saves arbitrary IDs, keeps meeting models unchanged and restores registrations with saved keys', async () => {
    const fetch = vi.fn();
    const core = await fixture(fetch);
    const before = core.getSnapshot().sttModelId;
    await core.getSnapshot().onSaveRegistration!(reg());
    await core.getSnapshot().onSaveRegistrationKey!('fixture', 'SYNTHETIC_REGISTRATION_KEY', 'encrypted');
    expect(core.getSnapshot().registrationKeyReady).toEqual(['fixture']);
    expect(core.getSnapshot().sttModelId).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
    await core.lock();
    expect(core.getSnapshot().modelRegistrations).toBeNull();
    expect(JSON.stringify(core.getSnapshot())).not.toContain('PRIVATE_FIXTURE_REGISTRATION');
    await core.unlock(phrase);
    expect(core.getSnapshot().modelRegistrations?.entries).toHaveLength(1);
    expect(core.getSnapshot().registrationKeyReady).toEqual(['fixture']);
});
it('stores real test results separately from HTTP completion and retries only saving', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic minutes' }, finish_reason: 'stop' }] })));
    const core = await fixture(fetch);
    await core.getSnapshot().onSaveRegistration!(reg());
    await core.getSnapshot().onSaveRegistrationKey!('fixture', 'SYNTHETIC_REGISTRATION_KEY', 'encrypted');
    const saved = core.getSnapshot().modelRegistrations!.entries[0];
    const native = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'records') {
        this.transaction.abort();
        throw new Error('synthetic quota');
    } return native.apply(this, args); });
    await expect(core.getSnapshot().onTestRegistration!(saved, input)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
    expect(core.getSnapshot().registrationTest?.saved).toBe(false);
    expect(core.getSnapshot().registrationTest?.result?.text).toBe('synthetic minutes');
    spy.mockRestore();
    await core.getSnapshot().onRetryRegistrationResult!();
    expect(core.getSnapshot().registrationTest?.saved).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
});
it('ignores late test data after lock and blocks duplicate requests', async () => {
    let finish!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(r => { finish = r; }));
    const core = await fixture(fetch);
    await core.getSnapshot().onSaveRegistration!({ ...reg(), auth: 'none' });
    const saved = core.getSnapshot().modelRegistrations!.entries[0];
    const p = core.getSnapshot().onTestRegistration!(saved, input), rejected = expect(p).rejects.toThrow();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await expect(core.getSnapshot().onTestRegistration!(saved, input)).rejects.toThrow();
    await core.lock();
    finish(new Response('{"choices":[]}'));
    await rejected;
    expect(core.getSnapshot().registrationTest).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
});
it('preserves a completed response when locking at its first UI receipt', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'COMPLETE_BEFORE_LOCK' }, finish_reason: 'stop' }] })));
    const core = await fixture(fetch);
    await core.getSnapshot().onSaveRegistration!({ ...reg(), auth: 'none' });
    let locking: Promise<void> | undefined;
    let requested = false;
    const unsubscribe = core.subscribe(() => { if (core.getSnapshot().registrationTest?.result && !requested) {
        requested = true;
        locking = core.lock();
    } });
    await expect(core.getSnapshot().onTestRegistration!(core.getSnapshot().modelRegistrations!.entries[0], input)).rejects.toThrow();
    await locking;
    unsubscribe();
    await core.unlock(phrase);
    expect(core.getSnapshot().modelRegistrations!.entries[0].lastTest?.text).toBe('COMPLETE_BEFORE_LOCK');
    expect(fetch).toHaveBeenCalledOnce();
});
it('cancels one test, preserves its unknown outcome and ignores a late success', async () => {
    let finish!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(r => { finish = r; }));
    const core = await fixture(fetch);
    await core.getSnapshot().onSaveRegistration!({ ...reg(), auth: 'none' });
    const running = core.getSnapshot().onTestRegistration!(core.getSnapshot().modelRegistrations!.entries[0], input);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    core.getSnapshot().onCancelRegistrationTest!();
    await running;
    expect(core.getSnapshot().registrationTest).toMatchObject({saved:true, saving:false, result:{state:'outcome-unknown'}});
    finish(new Response(JSON.stringify({choices:[{message:{content:'IGNORED_LATE_SUCCESS'},finish_reason:'stop'}]})));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(core.getSnapshot().registrationTest!.result!.text).not.toContain('IGNORED_LATE_SUCCESS');
    expect(fetch).toHaveBeenCalledOnce();
});
