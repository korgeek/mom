import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { clickAppAction, createVault, enterFixtureKeys, fixtureTransport, toneWav, passphrase } from './helpers';

const evidence = '.superpowers/sdd/model-details/task-vault-reset-native/captures';
async function capture(page: Page, state: string) {
  await expect(page.getByText('테스트 빌드 · 실제 AI 미검증', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Test build · live AI unverified', { exact: true })).toHaveCount(0);
  if (await page.locator('.vault-card').count()) await expect(page.getByText(/^Minutes of Meeting$/u)).toBeVisible();
  const geometry = await page.evaluate(() => ({ viewportWidth: innerWidth, viewportHeight: innerHeight,
    documentWidth: document.documentElement.clientWidth, documentScroll: document.documentElement.scrollWidth,
    mainWidth: document.querySelector('main')?.clientWidth, mainScroll: document.querySelector('main')?.scrollWidth }));
  const controls = [];
  for (const element of await page.locator('.vault-card input:visible, .vault-card button:visible, [role="dialog"] input:visible, [role="dialog"] button:visible, .build-links a:visible').all()) {
    const box = await element.boundingBox(); expect(box, `${state}: visible control has bounds`).not.toBeNull();
    controls.push({ tag: await element.evaluate(node => node.tagName), ...box! });
  }
  await mkdir(evidence, { recursive: true });
  // Preserve actual measurements/screens even when a new reset layout fails.
  await writeFile(`${evidence}/${state}.json`, JSON.stringify({ ...geometry, controls }, null, 2));
  await page.screenshot({ path: `${evidence}/${state}.png`, fullPage: true });
  expect(geometry.documentScroll, `${state}: whole document stays bounded`).toBeLessThanOrEqual(geometry.documentWidth + 1);
  if (geometry.mainWidth !== undefined) expect(geometry.mainScroll, `${state}: main stays bounded`).toBeLessThanOrEqual(geometry.mainWidth + 1);
  for (const box of controls) {
    expect(box.x, `${state}: control left edge`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${state}: control right edge`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    if (geometry.viewportWidth <= 412) {
      expect(box.width, `${state}: phone target width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${state}: phone target height`).toBeGreaterThanOrEqual(44);
    }
  }
}
async function settingsLicenses(page: Page, language: 'ko' | 'en') {
  const legal = page.getByRole('navigation', { name: language === 'ko' ? '앱 정보 · 라이선스' : 'App info & licenses' });
  await expect(legal.getByRole('link')).toHaveCount(3);
  await expect(legal.getByRole('link').nth(0)).toHaveAttribute('href', '/licenses/MoM-SOURCE-AVAILABLE-LICENSE.txt');
  await expect(legal.getByRole('link').nth(1)).toHaveAttribute('href', '/THIRD_PARTY_NOTICES.txt');
  await expect(legal.getByRole('link').nth(2)).toHaveAttribute('href', '/sources/REBUILD.md');
}
async function counts(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('mom-encrypted-vault-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await Promise.all(['header', 'records', 'nonces'].map(name => new Promise<number>((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }))); } finally { db.close(); }
  });
}
async function confirmReset(page: Page, language: 'ko' | 'en' = 'ko', state?: string) {
  await page.getByRole('button', { name: language === 'ko' ? '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작' : 'Delete all MoM data in this browser and start over', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox')).toHaveValue('');
  if (state) await capture(page, state);
  await dialog.getByLabel(language === 'ko' ? '확인하려면 delete를 입력하세요 (대소문자 구분 없음)' : 'Type delete to confirm (case-insensitive)').fill(language === 'ko' ? 'delete' : 'DELETE');
  if (state) await capture(page, `${state}-enabled`);
  await dialog.getByRole('button', { name: language === 'ko' ? '보관함 데이터 영구 삭제' : 'Permanently delete vault data', exact: true }).click();
}

test('locked native reset requires final confirmation, wipes actual stores and reloads as a fresh vault', async ({ page }) => {
  const calls = await fixtureTransport(page); await createVault(page); await enterFixtureKeys(page);
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
  await page.getByLabel('메모 제목').fill('SYNTHETIC_NATIVE_RESET_PRIVATE_TITLE');
  await page.locator('input[type=file]').setInputFiles({ name: 'SYNTHETIC_NATIVE_RESET_SOURCE.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(page.getByText('SYNTHETIC_NATIVE_RESET_SOURCE.wav', { exact: true }).first()).toBeVisible();
  await clickAppAction(page, '지금 잠그기'); await expect(page.getByLabel('암호', { exact: true })).toBeEnabled();
  await capture(page, '1440-ko-locked-with-reset');
  const before = await counts(page); expect(before.every(n => n > 0)).toBe(true);
  await page.getByRole('button', { name: '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작', exact: true }).click();
  let dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: '보관함 데이터 영구 삭제', exact: true })).toBeDisabled();
  for (const phrase of ['잘못된 확인', 'MoM 데이터 삭제', 'DELETE MOM DATA', 'delete!']) {
    await dialog.getByRole('textbox').fill(phrase); await expect(dialog.getByRole('button', { name: '보관함 데이터 영구 삭제', exact: true })).toBeDisabled();
  }
  await capture(page, '1440-ko-invalid-confirmation');
  await dialog.getByRole('textbox').fill('DELETE'); await expect(dialog.getByRole('button', { name: '보관함 데이터 영구 삭제', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '취소', exact: true }).click(); expect(await counts(page)).toEqual(before);
  await capture(page, '1440-ko-cancelled-confirmation');
  await page.getByRole('button', { name: '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByLabel('확인하려면 delete를 입력하세요 (대소문자 구분 없음)').fill('DeLeTe');
  await capture(page, '1440-ko-delete-enabled');
  await dialog.getByRole('button', { name: '보관함 데이터 영구 삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible(); expect(await counts(page)).toEqual([0, 0, 0]);
  await capture(page, '1440-ko-new-vault-after-reset');
  await page.reload(); await expect(page.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible();
  const fresh = 'different synthetic native reset passphrase';
  await page.getByLabel('암호', { exact: true }).fill(fresh); await page.getByLabel('암호 확인', { exact: true }).fill(fresh);
  await page.getByRole('button', { name: '보관함 만들기', exact: true }).click(); await expect(page.getByRole('heading', { name: '음성 메모', exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('SYNTHETIC_NATIVE_RESET_PRIVATE_TITLE');
  await clickAppAction(page, '지금 잠그기'); await expect(page.getByLabel('암호', { exact: true })).toBeEnabled();
  await page.getByLabel('암호', { exact: true }).fill(passphrase); await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('heading', { name: '암호로 잠금 해제', exact: true })).toBeVisible();
  expect(calls.filter(call => /audio\/transcriptions|chat\/completions/.test(call.url))).toEqual([]);
});

test('English phone Settings uses the same irreversible reset and clears the connected vault', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); const calls = await fixtureTransport(page); await createVault(page);
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click(); await page.getByLabel('메모 제목').fill('SYNTHETIC_SETTINGS_RESET_TITLE');
  await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click(); await page.getByRole('tab', { name: 'Security & lock', exact: true }).click();
  // Title typing stages an encrypted autosave. Use the real completed-lock
  // checkpoint to drain that work and preferences before measuring cancellation.
  await page.getByRole('button', { name: 'Lock now', exact: true }).first().click(); await expect(page.getByLabel('Passphrase', { exact: true })).toBeEnabled();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await clickAppAction(page, 'Settings'); await page.getByRole('tab', { name: 'Security & lock', exact: true }).click();
  await settingsLicenses(page, 'en'); await capture(page, '360-en-settings-security-licenses');
  const before = await counts(page);
  await page.getByRole('button', { name: 'Delete all MoM data in this browser and start over', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Permanently delete vault data', exact: true })).toBeDisabled();
  await capture(page, '360-en-settings-confirmation');
  await dialog.getByRole('textbox').fill('delete'); await expect(dialog.getByRole('button', { name: 'Permanently delete vault data', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await counts(page)).toEqual(before);
  await confirmReset(page, 'en', '360-en-settings-reconfirmed'); await expect(page.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible();
  await capture(page, '360-ko-new-vault-after-settings-reset');
  expect(await counts(page)).toEqual([0, 0, 0]); await page.reload(); await expect(page.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('SYNTHETIC_SETTINGS_RESET_TITLE');
  expect(calls.filter(call => /audio\/transcriptions|chat\/completions/.test(call.url))).toEqual([]);
});

test('native non-owner reset fails honestly until the other vault owner locks', async ({ page, context }) => {
  await fixtureTransport(page); await createVault(page); await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
  await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '보안 · 잠금', exact: true }).click();
  await page.getByRole('checkbox', { name: '탭이 숨겨지면 잠그기' }).uncheck(); const before = await counts(page);
  const second = await context.newPage(); await fixtureTransport(second); await second.goto('/'); await expect(second.getByLabel('암호', { exact: true })).toBeEnabled();
  await second.getByLabel('암호', { exact: true }).fill(passphrase);
  await second.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await expect(second.getByRole('alert')).toBeVisible();
  await expect(second.getByRole('heading', { name: '암호로 잠금 해제', exact: true })).toBeVisible();
  await confirmReset(second, 'ko', '1440-ko-non-owner-confirmation'); await expect(second.getByRole('alert')).toContainText('삭제 완료는 확인되지 않았어요');
  await expect(second.getByRole('heading', { name: '암호로 잠금 해제', exact: true })).toBeVisible(); expect(await counts(second)).toEqual(before);
  await capture(second, '1440-ko-non-owner-failed-reset');
  await page.bringToFront(); await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '지금 잠그기', exact: true }).first().click(); await expect(page.getByLabel('암호', { exact: true })).toBeEnabled();
  await second.bringToFront(); await confirmReset(second, 'ko', '1440-ko-non-owner-explicit-retry'); await expect(second.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible();
  await capture(second, '1440-ko-new-vault-after-owner-lock');
  expect(await counts(second)).toEqual([0, 0, 0]); await second.close();
});

test('native atomic clear abort preserves every store and permits only an explicitly confirmed retry', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const calls = await fixtureTransport(page); await createVault(page); await enterFixtureKeys(page);
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
  await page.getByLabel('메모 제목').fill('SYNTHETIC_ATOMIC_ABORT_PRIVATE_TITLE');
  await page.locator('input[type=file]').setInputFiles({ name: 'SYNTHETIC_ATOMIC_ABORT_SOURCE.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(page.getByText('SYNTHETIC_ATOMIC_ABORT_SOURCE.wav', { exact: true }).first()).toBeVisible();
  await clickAppAction(page, '설정');
  await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click(); await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('tab', { name: 'Security & lock', exact: true }).click();
  await settingsLicenses(page, 'en');
  await page.getByRole('button', { name: 'Lock now', exact: true }).first().click(); await expect(page.getByLabel('Passphrase', { exact: true })).toBeEnabled();
  const before = await counts(page); expect(before.every(n => n > 0)).toBe(true);
  await capture(page, '360-en-atomic-abort-locked');
  // Install only after fixture writes/lock complete. Queue all three native clear
  // requests, then abort that exact reset transaction: browser IDB must roll back.
  await page.evaluate(() => {
    const nativeTransaction = IDBDatabase.prototype.transaction, nativeClear = IDBObjectStore.prototype.clear;
    const matched = new WeakSet<IDBTransaction>();
    const fault = { transactions: 0, clears: [] as string[], aborts: 0, abortReceipts: 0, restore: () => {
      IDBDatabase.prototype.transaction = nativeTransaction; IDBObjectStore.prototype.clear = nativeClear;
    } };
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const transaction = nativeTransaction.call(this, names, mode, options);
      if (this.name === 'mom-encrypted-vault-v1' && mode === 'readwrite' && Array.from(transaction.objectStoreNames).sort().join(',') === 'header,nonces,records') {
        matched.add(transaction); fault.transactions++;
        transaction.addEventListener('abort', () => fault.abortReceipts++);
      }
      return transaction;
    };
    IDBObjectStore.prototype.clear = function () {
      const request = nativeClear.call(this);
      if (matched.has(this.transaction)) {
        fault.clears.push(this.name);
        if (fault.clears.length === 3) { fault.aborts++; this.transaction.abort(); }
      }
      return request;
    };
    (window as unknown as { resetAtomicFault: typeof fault }).resetAtomicFault = fault;
  });
  await confirmReset(page, 'en', '360-en-atomic-abort-confirmation');
  await expect(page.getByRole('alert')).toContainText('Deletion is not confirmed.');
  await expect(page.getByRole('heading', { name: 'Unlock with your passphrase', exact: true })).toBeVisible();
  await expect(page.getByLabel('Passphrase', { exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: /Create a new vault|새 보관함 만들기/ })).toHaveCount(0);
  expect(await counts(page)).toEqual(before);
  expect(await page.evaluate(() => {
    const { transactions, clears, aborts, abortReceipts } = (window as unknown as { resetAtomicFault: { transactions: number; clears: string[]; aborts: number; abortReceipts: number } }).resetAtomicFault;
    return { transactions, clears, aborts, abortReceipts };
  })).toEqual({ transactions: 1, clears: ['header', 'records', 'nonces'], aborts: 1, abortReceipts: 1 });
  expect(await page.locator('body').innerText()).not.toContain('SYNTHETIC_ATOMIC_ABORT_PRIVATE_TITLE');
  await capture(page, '360-en-atomic-abort-failed-reset');
  await page.evaluate(() => (window as unknown as { resetAtomicFault: { restore(): void } }).resetAtomicFault.restore());
  await confirmReset(page, 'en', '360-en-atomic-abort-explicit-retry');
  await expect(page.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible(); expect(await counts(page)).toEqual([0, 0, 0]);
  await page.reload(); await expect(page.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible(); expect(await counts(page)).toEqual([0, 0, 0]);
  await capture(page, '360-ko-atomic-abort-durable-new-vault');
  const fresh = 'fresh synthetic atomic reset passphrase';
  await page.getByLabel('암호', { exact: true }).fill(fresh); await page.getByLabel('암호 확인', { exact: true }).fill(fresh);
  await page.getByRole('button', { name: '보관함 만들기', exact: true }).click(); await expect(page.getByRole('heading', { name: '음성 메모', exact: true })).toBeVisible();
  expect((await counts(page))[0]).toBeGreaterThan(0); expect(await page.locator('body').innerText()).not.toContain('SYNTHETIC_ATOMIC_ABORT_PRIVATE_TITLE');
  expect(calls.filter(call => /audio\/transcriptions|chat\/completions/.test(call.url))).toEqual([]);
});
