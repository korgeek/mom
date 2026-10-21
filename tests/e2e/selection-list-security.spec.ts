import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { clickAppAction, createVault, passphrase } from './helpers';

test('settings reject executable input, escape imported names and clear decrypted UI on lock', async ({ page }, info) => {
  const external: string[] = [], errors: string[] = []; let dialogs = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
  await page.route('https://**/*', route => { external.push(route.request().url()); return route.abort(); });
  await createVault(page); await clickAppAction(page, '설정');
  await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
  const label = 'SECURITY_LABEL_<svg onload=alert(1)>', lists = { icons: ['mic'], colors: ['#123456'], languages: [{ code: 'fr', name: label }] };
  const payload = { format: 'mom-appearance-settings', version: 1, ...lists };
  const upload = (text: string) => page.getByLabel('설정 JSON 가져오기', { exact: true }).setInputFiles({ name: 'security.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  for (const malicious of [JSON.stringify({ ...payload, icons: ['constructor'] }), JSON.stringify({ ...payload, colors: ['url(https://example.invalid)'] }), JSON.stringify({ ...payload, apiKey: 'SYNTHETIC_FORBIDDEN_FIELD' }), `{"__proto__":{"polluted":true},${JSON.stringify(payload).slice(1)}`]) {
    await upload(malicious); await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('group', { name: '가져오기 미리보기' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '아이콘 제외 star', exact: true })).toBeVisible();
  }
  await upload(JSON.stringify(payload)); await expect(page.getByRole('group', { name: '가져오기 미리보기' })).toBeVisible();
  await page.getByRole('button', { name: '가져온 설정 적용', exact: true }).click();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.locator('main [onload], main [onerror], main img')).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '설정 JSON 내보내기', exact: true }).click()]);
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(payload);
  await page.getByRole('region', { name: '사용 언어 목록' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('escaped-name.png') });
  await page.getByRole('button', { name: '언어 수정 fr', exact: true }).click();
  await expect(page.getByLabel('표시 이름', { exact: true })).toHaveValue(label);
  await clickAppAction(page, '지금 잠그기');
  await expect(page.getByRole('heading', { name: '암호로 잠금 해제' })).toBeVisible();
  await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('표시 이름', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('locked.png') });
  await page.reload(); await page.getByLabel('암호', { exact: true }).fill(passphrase); await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  expect(dialogs).toBe(0); expect(external).toEqual([]); expect(errors).toEqual([]);
});
