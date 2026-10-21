import { test, expect } from '@playwright/test';

test('synthetic browser storage contains ciphertext and restores only after authentication', async ({ page }, testInfo) => {
  const logs: string[] = [], external: string[] = [];
  page.on('console', message => logs.push(message.text()));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    external.push(url.origin); return route.abort();
  });
  await page.goto('/');
  const audit = await page.evaluate(async () => {
    const sessionPath = '/src/react-app/vault/session.ts', jobsPath = '/src/react-app/domain/jobs.ts';
    const { createVaultSession } = await import(sessionPath), { createJobContext } = await import(jobsPath);
    const secret = 'synthetic audit cedar river password';
    const markers = ['AUDIT_PRIVATE_TITLE', 'AUDIT_PRIVATE_FILENAME', 'AUDIT_PRIVATE_INSTRUCTIONS', 'AUDIT_PRIVATE_AUDIO', 'AUDIT_PRIVATE_KEY', 'AUDIT_PRIVATE_DRAFT'];
    const name = `mom-synthetic-audit-${crypto.randomUUID()}`;
    const session = createVaultSession({ databaseName: name });
    const project = (title: string) => ({ id: crypto.randomUUID(), title, icon: 'mic', color: '#2B59C3', pinned: false, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', sourceAssets: [], preparedChunks: [], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['ko'], bitrateKbps: 32, sampleRateHz: 16000 }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: 'ko', sections: ['summary'], instructions: markers[2], modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] });
    await session.create(secret, secret).catch((error: Error) => { throw new Error('create phase: ' + error.message); });
    const original = new Blob([markers[3].repeat(100)]), sourceId = crypto.randomUUID();
    const p = { ...project(markers[0]), sourceAssets: [{ id: sourceId, fileName: markers[1], bytes: original.size, container: 'wav', codec: 'pcm_s16le', durationMs: 1000, channels: 1, sampleRateHz: 16000 }] };
    await session.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: sourceId, audio: original }] }, createJobContext());
    await session.saveProviderKey('synthetic', markers[4]);
    const draft = project(markers[5]);
    await session.store.checkpoint({ project: draft, runId: null, audioRecords: [] }, createJobContext());
    const writer = await session.createSourceWriter(draft.id, crypto.randomUUID(), { sampleRateHz: 16000, channels: 1 }, createJobContext());
    await writer.append(new TextEncoder().encode(markers[3].repeat(10)), createJobContext());
    await writer.abort();
    await session.lock('manual');
    const db: IDBDatabase = await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const dumps: string[] = [];
    for (const store of Array.from(db.objectStoreNames)) {
      const rows = await new Promise<unknown[]>((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      dumps.push(JSON.stringify(rows, (_key, value) => value instanceof ArrayBuffer ? new TextDecoder().decode(value) : value));
    }
    db.close();
    let rejected = false;
    try { await session.unlock('a different synthetic password'); } catch { rejected = true; }
    await session.unlock(secret).catch((error: Error) => { throw new Error('reopen phase: ' + error.message); });
    const restored = await session.store.readProject(p.id, createJobContext());
    const restoredKey = await session.getProviderKey('synthetic');
    const restoredDrafts = await session.listSourceDrafts(draft.id, createJobContext());
    const scan = [...dumps, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    const cacheNames = await caches.keys();
    const workers = await navigator.serviceWorker.getRegistrations();
    const result = { leak: markers.some(marker => scan.some(dump => dump.includes(marker))), rejected, restored: restored?.title === markers[0] && restoredKey === markers[4], draft: restoredDrafts.length === 1, cacheNames, workers: workers.length, stores: dumps.length };
    await session.dispose();
    return result;
  });
  expect(audit).toMatchObject({ leak: false, rejected: true, restored: true, draft: true, cacheNames: [], workers: 0, stores: 3 });
  expect(external).toEqual([]);
  expect(logs.some(line => line.includes('AUDIT_PRIVATE_'))).toBe(false);
  await testInfo.attach('synthetic-storage-audit', { body: JSON.stringify(audit), contentType: 'application/json' });
});
