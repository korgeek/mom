import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { cancelJobs } from '../src/react-app/domain/jobs';
import { createVaultSession } from '../src/react-app/vault/session';

const passphrase = 'synthetic home persistence testing phrase';
const controllers: MeetingController[] = [];
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterEach(async () => { for (const core of controllers.splice(0)) await core.dispose(); cancelJobs(); });

function setup(indexedDB = new IDBFactory(), databaseName = crypto.randomUUID()) {
  const held = new Set<string>();
  const core = createMeetingController({ indexedDB, databaseName,
    fetch: async () => new Response(JSON.stringify({ data: [] })),
    sessionFactory: hooks => createVaultSession({ ...hooks, indexedDB, databaseName,
      testOnlyOwnership: { acquire: async name => {
        if (held.has(name)) return null;
        held.add(name); return () => { held.delete(name); };
      } } }),
  });
  controllers.push(core); return { core, indexedDB, databaseName };
}
async function reopened(fixture: ReturnType<typeof setup>) {
  await fixture.core.dispose();
  const next = setup(fixture.indexedDB, fixture.databaseName);
  await next.core.initialize(); await next.core.unlock(passphrase); return next.core;
}

describe('Home encrypted metadata persistence', () => {
  it.each([false, true])('saves an immediate UI pin change from %s before lock and a new controller reload', async initialPinned => {
    const fixture = setup(); await fixture.core.initialize(); await fixture.core.createVault(passphrase);
    const id = await fixture.core.createMeeting();
    await fixture.core.updateMeeting(id, { title: 'TEST_ONLY_HOME_PERSISTENCE', pinned: initialPinned });
    fixture.core.getSnapshot().onUpdateMeeting!(id, { pinned: !initialPinned });
    expect(fixture.core.getSnapshot().projects.find(project => project.id === id)?.pinned).toBe(!initialPinned);
    await fixture.core.lock();
    const next = await reopened(fixture);
    expect(next.getSnapshot().projects.find(project => project.id === id)?.pinned).toBe(!initialPinned);
  });
  it('preserves the newest adjacent Home title and pin edits at the lock barrier', async () => {
    const fixture = setup(); await fixture.core.initialize(); await fixture.core.createVault(passphrase);
    const id = await fixture.core.createMeeting();
    fixture.core.getSnapshot().onUpdateMeeting!(id, { title: 'TEST_ONLY_HOME_RENAMED' });
    fixture.core.getSnapshot().onUpdateMeeting!(id, { pinned: true });
    await fixture.core.lock();
    const next = await reopened(fixture);
    expect(next.getSnapshot().projects.find(project => project.id === id)).toMatchObject({ title: 'TEST_ONLY_HOME_RENAMED', pinned: true });
  });
});
