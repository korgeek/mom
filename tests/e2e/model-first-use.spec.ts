// Fresh headed Chrome and native encrypted synthetic vault. No real keys or inference.
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { MINUTES_SHORTLIST } from '../../src/react-app/providers/model-shortlist';
import { clickAppAction, createVault, passphrase, routerModel, routerEndpoint, fixtureModelRow, inspectVaultSentinels } from './helpers';
const evidence = '.superpowers/sdd/model-first-use/evidence/browser';
const mini = { id: 'openai/gpt-4o-mini-transcribe', name: 'TEST_ONLY Mini', architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] }, pricing: { prompt: '0.000001', completion: '0.000002' } };
const whisper = { ...mini, id: 'openai/whisper-large-v3', name: 'TEST_ONLY Whisper' };
const textModels = [...MINUTES_SHORTLIST.map(({ id }) => ({ ...routerModel, id, name: `TEST_ONLY ${id}` })), ...Array.from({ length: 24 }, (_, i) => ({ ...routerModel, id: `fixture/text-${i}`, name: `TEST_ONLY Other ${i}` }))];
const initialTextMetadata = ['https://openrouter.ai/api/v1/models', ...['openai/gpt-6-luna', 'google/gemini-3.8-flash', 'anthropic/claude-opus-5.5'].map(id => `https://openrouter.ai/api/v1/models/${id}/endpoints`)];
const sttDiscovery = 'https://openrouter.ai/api/v1/models?output_modalities=transcription';
async function transport(page: Page) {
 const calls: string[] = [], blocked: string[] = [];
 await page.route('https://**/*', async route => {
  const req = route.request(), url = req.url();
  if (req.headers().authorization || !url.startsWith('https://openrouter.ai/api/v1/models')) { blocked.push(url); await route.abort(); return; }
  calls.push(url);
  const id = url.match(/models\/(.+)\/endpoints$/)?.[1];
  const data = url.includes('output_modalities=transcription') ? [mini, whisper] : id ? { id, endpoints: [routerEndpoint, { ...routerEndpoint, tag: 'TEST_ONLY/second-exact' }] } : textModels;
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
 });
 return { calls, blocked };
}
async function setup(page: Page, language: 'ko' | 'en') {
 await createVault(page); await clickAppAction(page, '설정');
 if (language === 'en') { await page.getByRole('tab', { name: '화면 · 언어' }).click(); await page.getByRole('button', { name: 'English', exact: true }).click(); await page.getByRole('tab', { name: 'Connections', exact: true }).click(); }
 const key = page.getByLabel(language === 'ko' ? 'OpenRouter API 키' : 'OpenRouter API key');
 await key.fill('TEST_ONLY_FIRST_USE_KEY'); await page.locator('.connection-card').filter({ has: key }).getByRole('button', { name: language === 'ko' ? '키 저장' : 'Save key', exact: true }).click();
 await expect(key).toHaveValue('');
}
async function open(page: Page, language: 'ko' | 'en') { await page.getByRole('button', { name: language === 'ko' ? 'OpenRouter 모델 선택' : 'Select OpenRouter models', exact: true }).click(); return page.getByRole('dialog'); }
async function discover(page: Page, language: 'ko' | 'en') {
 const t = (ko: string, en: string) => language === 'ko' ? ko : en, dialog = page.getByRole('dialog');
 const summary = dialog.getByText(t('추가 정보 · 목록 조회', 'Additional information · discovery'), { exact: true }); if (await summary.locator('..').getAttribute('open') === null) await summary.click();
 await dialog.getByRole('button', { name: t('OpenRouter 목록 조회', 'Discover OpenRouter'), exact: true }).click(); await dialog.getByRole('button', { name: t('최신 목록 확인', 'Review refreshed list') }).click();
}
async function capture(page: Page, name: string) {
 await mkdir(evidence, { recursive: true });
 const values = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, rows: [...document.querySelectorAll('.model-selection-row')].map(row => ({ label: row.getAttribute('aria-label'), checked: row.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked, default: row.querySelector<HTMLInputElement>('input[type=radio]')?.checked })), dialog: (() => { const element = document.querySelector('.model-selection-modal')!; const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }; })() }));
 await writeFile(`${evidence}/${name}.json`, JSON.stringify(values, null, 2)); await page.screenshot({ path: `${evidence}/${name}.png` });
 expect(values.documentWidth).toBeLessThanOrEqual(values.viewport.width); expect(values.dialog.scrollWidth).toBeLessThanOrEqual(values.dialog.clientWidth); return values;
}
test('first-use STT draft has a prospective default and persists only after explicit Apply', async ({ page }) => {
 const network = await transport(page); await setup(page, 'ko'); expect(network.calls).toEqual([]); const dialog = await open(page, 'ko'); await discover(page, 'ko');
 const row = fixtureModelRow(page, 'openrouter', 'stt', mini.id, null); await row.getByText('추가 정보', { exact: true }).click();
 const before = await capture(page, '1440-ko-first-use-default');
 expect(before.rows.find(item => item.label?.includes(mini.id))?.default).toBe(true);
 await dialog.getByRole('button', { name: '적용', exact: true }).click(); await expect(dialog).toHaveCount(0);
 await page.reload(); await page.getByLabel('암호', { exact: true }).fill(passphrase); await page.getByRole('button', { name: '잠금 해제', exact: true }).click(); await clickAppAction(page, '설정'); await open(page, 'ko');
 await row.getByText('추가 정보', { exact: true }).click(); await expect(row.getByRole('radio')).toBeChecked(); await expect(row.getByRole('checkbox')).toBeChecked(); await capture(page, '1440-ko-reloaded-saved-default');
 expect(network.calls).toEqual([...initialTextMetadata, sttDiscovery, ...initialTextMetadata]); expect(network.blocked).toEqual([]); expect((await inspectVaultSentinels(page, ['TEST_ONLY_FIRST_USE_KEY'])).leakedSentinelIndices).toEqual([]);
});
test.describe('mobile first-use text route', () => {
 test.use({ viewport: { width: 360, height: 800 } });
 test('shows five supported candidates and requires an explicit exact endpoint', async ({ page }) => {
  const network = await transport(page); await setup(page, 'en'); const dialog = await open(page, 'en'); await dialog.getByRole('tab', { name: 'Text generation' }).click(); await discover(page, 'en');
  const before = await capture(page, '360-en-first-use-text'); expect(before.rows).toHaveLength(5);
  const modelId = 'openai/gpt-6-luna', candidate = fixtureModelRow(page, 'openrouter', 'minutes', modelId, null); await expect(candidate.getByRole('button', { name: 'Load endpoints' })).toBeVisible(); await candidate.getByRole('button', { name: 'Load endpoints' }).click();
  await dialog.getByRole('button', { name: 'Review refreshed list' }).click(); const exact = fixtureModelRow(page, 'openrouter', 'minutes', modelId, routerEndpoint.tag); await expect(exact.getByRole('checkbox')).not.toBeChecked(); await exact.getByRole('checkbox').check(); await expect(exact.getByRole('radio')).toBeChecked(); await exact.getByRole('radio').scrollIntoViewIfNeeded(); await capture(page, '360-en-explicit-text-route');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(dialog).toHaveCount(0); await open(page, 'en'); await dialog.getByRole('tab', { name: 'Text generation' }).click(); await expect(exact.getByRole('checkbox')).toBeChecked();
  expect(network.calls).toEqual([...initialTextMetadata, 'https://openrouter.ai/api/v1/models', `https://openrouter.ai/api/v1/models/${modelId}/endpoints`]); expect(network.blocked).toEqual([]);
 });
});
test('saved disabled choices and a deliberate default survive refresh and failed Apply', async ({ page }) => {
 await page.addInitScript(() => { const nativePut = IDBObjectStore.prototype.put; const state = window as unknown as { failNextTestRecord: boolean }; state.failNextTestRecord = false; IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'records' && state.failNextTestRecord) { state.failNextTestRecord = false; this.transaction.abort(); throw new DOMException('TEST_ONLY failed save', 'QuotaExceededError'); } return nativePut.apply(this, args); }; });
 const network = await transport(page); await setup(page, 'ko'); let dialog = await open(page, 'ko'); await discover(page, 'ko');
 const miniRow = fixtureModelRow(page, 'openrouter', 'stt', mini.id, null), whisperRow = fixtureModelRow(page, 'openrouter', 'stt', whisper.id, null);
 await miniRow.getByRole('checkbox').uncheck(); await dialog.getByRole('button', { name: '적용', exact: true }).click(); await expect(dialog).toHaveCount(0);
 dialog = await open(page, 'ko'); await expect(miniRow.getByRole('checkbox')).not.toBeChecked(); await whisperRow.getByRole('checkbox').check(); await whisperRow.getByRole('radio').check(); await dialog.getByRole('button', { name: '적용', exact: true }).click(); await expect(dialog).toHaveCount(0);
 await page.reload(); await page.getByLabel('암호', { exact: true }).fill(passphrase); await page.getByRole('button', { name: '잠금 해제', exact: true }).click(); await clickAppAction(page, '설정'); dialog = await open(page, 'ko'); await discover(page, 'ko');
 await expect(miniRow.getByRole('checkbox')).not.toBeChecked(); await expect(whisperRow.getByRole('checkbox')).toBeChecked(); await expect(whisperRow.getByRole('radio')).toBeChecked(); await capture(page, '1440-ko-preserved-deliberate-choices');
 await miniRow.getByRole('checkbox').check(); await page.evaluate(() => { (window as unknown as { failNextTestRecord: boolean }).failNextTestRecord = true; }); await dialog.getByRole('button', { name: '적용', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('초안은 유지'); await expect(dialog.getByRole('button', { name: '적용', exact: true })).toBeDisabled(); await expect(miniRow.getByRole('checkbox')).toBeChecked(); await capture(page, '1440-ko-failed-apply-preserved-draft');
 await page.reload(); await page.getByLabel('암호', { exact: true }).fill(passphrase); await page.getByRole('button', { name: '잠금 해제', exact: true }).click(); await clickAppAction(page, '설정'); await open(page, 'ko'); await expect(miniRow.getByRole('checkbox')).not.toBeChecked(); await expect(whisperRow.getByRole('radio')).toBeChecked();
 await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await expect(page.getByRole('heading', { name: '암호로 잠금 해제' })).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(network.calls).toEqual([...initialTextMetadata, sttDiscovery, ...initialTextMetadata, ...initialTextMetadata, sttDiscovery, ...initialTextMetadata]); expect(network.blocked).toEqual([]);
});
