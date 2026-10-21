import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { clickAppAction, createVault, fixtureModelRow, fixtureTransport, inspectVaultSentinels, prepareForTranscription, toneWav, unlock } from './helpers';

const mini = 'openai/gpt-4o-mini-transcribe', whisper = 'openai/whisper-large-v3';
const fakeKey = 'KEYLESS_OR_STT_BROWSER_TEST';
const text = 'TEST_ONLY_OR_STT_SAVED_RESPONSE';
const lateText = 'TEST_ONLY_OR_STT_LATE_DISCARDED';
const evidence = '.superpowers/sdd/openrouter-stt/review-fix-browser';
type Language = 'ko' | 'en';
const translate = (language: Language) => (ko: string, en: string) => language === 'ko' ? ko : en;
const catalog = [mini, whisper, 'fixture/unknown-stt'].map(id => ({ id, name: id, architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] }, pricing: { prompt: '0.000001', completion: id === whisper ? '0' : '0.000002', request: '0' } }));

async function guardedTransport(page: Page) {
  await fixtureTransport(page); // Existing Worker diagnostics and fixture infrastructure.
  const unexpected: string[] = [], calls: { method: string; url: string; authenticated: boolean }[] = [];
  const posts: { model: string; provider: { data_collection: string; zdr: boolean }; audioBytes: number; bodyBytes: number; language: string | null }[] = [];
  const state = { failCheckpoint: false, hold: false, entered: false, release: () => {} };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === new URL(process.env.MOM_E2E_BASE_URL ?? 'http://127.0.0.1:4174').origin && method === 'GET') { await route.continue(); return; }
    calls.push({ method, url: request.url(), authenticated: !!request.headers().authorization });
    if (url.href === 'https://openrouter.ai/api/v1/models?output_modalities=transcription' && method === 'GET' && !request.headers().authorization) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: catalog }) }); return;
    }
    if (url.href !== 'https://openrouter.ai/api/v1/audio/transcriptions' || method !== 'POST') { unexpected.push(`${method} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient'); return; }
    expect(request.headers().authorization).toBe(`Bearer ${fakeKey}`);
    const body = request.postDataJSON();
    expect(body.model).toBe(mini); expect(body.response_format).toBe('json'); expect(body.input_audio.format).toBe('mp3'); expect(body.provider.data_collection).toBe('deny');
    expect(Object.keys(body.provider).sort()).toEqual(['data_collection', 'zdr']); expect(body.language).toBeUndefined();
    const audioBytes = Buffer.from(body.input_audio.data, 'base64').byteLength, bodyBytes = Buffer.byteLength(request.postData() ?? '', 'utf8');
    expect(audioBytes).toBeGreaterThan(0); expect(audioBytes).toBeLessThanOrEqual(16_000_000); expect(bodyBytes).toBeLessThanOrEqual(24_000_000);
    posts.push({ model: body.model, provider: body.provider, audioBytes, bodyBytes, language: body.language ?? null });
    if (state.failCheckpoint) await page.evaluate(() => {
      const storage = window as unknown as { syntheticRejectCheckpoint: boolean }; storage.syntheticRejectCheckpoint = true;
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (names, mode, options) {
        const transaction = original.call(this, names, mode, options);
        if (storage.syntheticRejectCheckpoint && mode === 'readwrite' && transaction.objectStoreNames.contains('records') && transaction.objectStoreNames.contains('header')) queueMicrotask(() => transaction.abort());
        return transaction;
      };
    });
    const held = state.hold;
    if (held) { state.entered = true; await new Promise<void>(resolve => { state.release = resolve; }); }
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: held ? lateText : text, model: mini, provider: 'TEST_ONLY_DYNAMIC_PROCESSOR', usage: { cost: 0.0001, input_tokens: 12, output_tokens: 4 } }) }); }
    catch { if (!held) throw new Error('Unexpected fixture response failure'); }
  });
  return { posts, unexpected, calls, state };
}
async function languageUI(page: Page, language: Language) {
  if (language === 'en') { await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click(); await page.getByRole('button', { name: 'English', exact: true }).click(); }
}
async function settings(page: Page, language: Language) {
  const t = translate(language); await clickAppAction(page, t('설정', 'Settings')); await page.getByRole('tab', { name: t('연결 설정', 'Connections'), exact: true }).click();
  return page.getByRole('region', { name: t('OpenRouter 전사 설정', 'OpenRouter transcription settings') });
}
async function discover(page: Page, language: Language) {
  const t = translate(language); await clickAppAction(page, t('설정', 'Settings')); await page.getByRole('tab', { name: t('모델', 'Models'), exact: true }).click();
  const manager = page.getByRole('region', { name: t('중앙 모델 관리', 'Central model management') });
  await manager.getByRole('button', { name: t('OpenRouter 목록 조회', 'Discover OpenRouter'), exact: true }).click();
  await expect(fixtureModelRow(page, 'openrouter', 'stt', mini, null)).toBeVisible();
  return manager;
}
async function setup(page: Page, language: Language) {
  const t = translate(language); await createVault(page); await languageUI(page, language); const policy = await settings(page, language);
  await expect(page.getByText(t('OpenRouter 전사 · 정리 노트', 'OpenRouter transcription · notes'), { exact: true })).toBeVisible();
  const key = page.getByLabel(`OpenRouter API ${t('키', 'key')}`), connection = page.locator('section').filter({ has: key });
  await key.fill(fakeKey); await connection.getByRole('button', { name: t('키 저장', 'Save key'), exact: true }).click();
  await expect(connection.getByText(t('저장됨 · 연결 미확인', 'Saved · connection unverified'))).toBeVisible(); await expect(key).toHaveValue('');
  const collection = policy.getByRole('link', { name: t('OpenRouter 데이터 수집 정책', 'OpenRouter data collection policy'), exact: true });
  const logging = policy.getByRole('link', { name: t('처리 제공사 로그·보관 정책', 'Processor logging and retention policy'), exact: true });
  for (const [link, href] of [[collection, 'https://openrouter.ai/docs/guides/privacy/data-collection'], [logging, 'https://openrouter.ai/docs/guides/privacy/provider-logging']] as const) {
    await expect(link).toBeVisible(); await expect(link).toHaveAttribute('href', href); await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', 'noreferrer');
  }
  const acknowledgment = policy.getByRole('checkbox'); await expect(acknowledgment).not.toBeChecked(); await expect(policy.getByRole('combobox')).toHaveValue('zdr');
  await expect(policy.getByRole('button', { name: t('추천 초기 기본값 사용', 'Use recommended initial default'), exact: true })).toBeDisabled();
  await acknowledgment.focus(); await expect(acknowledgment).toBeFocused(); await page.keyboard.press('Space');
  await policy.getByRole('button', { name: t('전사 정책 저장', 'Save transcription policy'), exact: true }).click();
  await expect(policy.getByRole('status')).toContainText(t('ZDR 필수', 'ZDR required'));
  const manager = await discover(page, language); await expect(manager.getByRole('button', { name: t('OpenAI 목록 조회', 'Discover OpenAI'), exact: true })).toBeDisabled();
  const row = fixtureModelRow(page, 'openrouter', 'stt', mini, null), enable = row.getByRole('checkbox', { name: t('이 경로 활성화', 'Enable this route'), exact: true });
  await expect(enable).not.toBeChecked(); await expect(fixtureModelRow(page, 'openrouter', 'stt', whisper, null)).toBeVisible();
  await manager.getByRole('button', { name: t('전체 모델 보기', 'Show all models'), exact: true }).click();
  await expect(fixtureModelRow(page, 'openrouter', 'stt', 'fixture/unknown-stt', null).getByRole('checkbox')).toBeDisabled();
  await enable.click(); await expect(enable).toBeChecked();
  await page.getByRole('region', { name: t('OpenRouter 전사 설정', 'OpenRouter transcription settings') }).getByRole('button', { name: t('추천 초기 기본값 사용', 'Use recommended initial default'), exact: true }).click();
  await expect(page.getByRole('region', { name: t('OpenRouter 전사 설정', 'OpenRouter transcription settings') }).getByRole('button', { name: t('추천 초기 기본값 사용', 'Use recommended initial default'), exact: true })).toBeDisabled();
  await row.getByText(t('자세히 보기 · 메타데이터', 'Details · metadata'), { exact: true }).click();
  await expect(row.getByRole('button', { name: t('이 단계 기본 모델', 'Default for this stage'), exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
}
async function prepare(page: Page, language: Language) {
  const t = translate(language); await page.getByRole('main').getByRole('button', { name: t('+ 새 음성 메모', '+ New voice memo'), exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'TEST_ONLY_OR_STT.wav', mimeType: 'audio/wav', buffer: toneWav() }); await prepareForTranscription(page, language);
  await expect(page.getByRole('combobox', { name: t('전사 모델', 'Transcription model'), exact: true })).toHaveValue(mini);
}
async function openSaved(page: Page, language: Language) {
  const t = translate(language); await page.getByRole('button', { name: /^열기 |^Open / }).click(); await page.getByRole('navigation', { name: t('음성 메모 단계', 'Memo steps'), exact: true }).getByRole('button', { name: t('2 전사', '2 Transcribe'), exact: true }).click();
}
async function capture(page: Page, language: Language, state: string) {
  await mkdir(evidence, { recursive: true });
  const bounds = await page.evaluate(() => ({ userAgent: navigator.userAgent, width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, mainWidth: document.querySelector('main')?.clientWidth, mainScroll: document.querySelector('main')?.scrollWidth, focusLabel: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.closest('label')?.textContent ?? document.activeElement?.textContent, labeledCheckboxes: [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map(input => ({ label: input.closest('label')?.textContent, checked: input.checked, disabled: input.disabled })) }));
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.width + 1); if (bounds.mainWidth !== undefined) expect(bounds.mainScroll).toBeLessThanOrEqual(bounds.mainWidth + 1);
  await writeFile(`${evidence}/${language}-${bounds.width}-${state}.json`, JSON.stringify(bounds, null, 2)); await page.screenshot({ path: `${evidence}/${language}-${bounds.width}-${state}.png`, fullPage: true });
}

for (const { language, width, height } of [{ language: 'ko' as const, width: 1440, height: 900 }, { language: 'en' as const, width: 360, height: 800 }]) {
  test.describe(`${language} ${width} OR-only transcription`, () => {
    test.use({ viewport: { width, height } });
    test('explicit setup, changed policy, fresh presend, raw version and encrypted reload', async ({ page }) => {
      const t = translate(language), guard = await guardedTransport(page), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await setup(page, language); expect(guard.posts).toHaveLength(0); const policy = await settings(page, language);
      await policy.getByRole('button', { name: t('무료 전사 모델 찾기', 'Find a free transcription model'), exact: true }).click();
      await expect(policy.getByRole('status').filter({ hasText: t('검증된 무료 전사 후보가 없어요', 'No verified free transcription candidate') })).toBeVisible(); await capture(page, language, 'settings');
      await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click(); await prepare(page, language);
      const consent = page.getByRole('checkbox', { name: t('위 내용을 확인했어요', "I've reviewed the above"), exact: true }), submit = page.getByRole('button', { name: t('전사 실행', 'Transcribe'), exact: true });
      await expect(consent).not.toBeChecked(); await expect(submit).toBeDisabled(); await expect(page.getByText(t('브라우저 → OpenRouter → 동적으로 선택되는 처리 제공사', 'Browser → OpenRouter → dynamically selected processor'), { exact: true })).toBeVisible();
      await expect(page.getByText(t('자동 감지 · 여러 예상 언어', 'Automatic detection · multiple expected languages'), { exact: true })).toBeVisible();
      await consent.focus(); await expect(consent).toBeFocused(); await page.keyboard.press('Space'); await page.keyboard.press('Tab'); await expect(submit).toBeFocused(); await capture(page, language, 'zdr-presend');
      const nextPolicy = await settings(page, language); await nextPolicy.getByRole('combobox').selectOption('standard'); await expect(nextPolicy.getByRole('checkbox')).not.toBeChecked();
      await nextPolicy.getByRole('checkbox').check(); await nextPolicy.getByRole('button', { name: t('전사 정책 저장', 'Save transcription policy'), exact: true }).click(); await expect(nextPolicy.getByRole('status')).toContainText(t('표준 보관 허용', 'Standard retention allowed'));
      await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click(); await openSaved(page, language);
      await expect(consent).not.toBeChecked(); await expect(submit).toBeDisabled(); await expect(page.getByText(t('데이터 수집 거부 · 표준 보관 허용', 'Data collection denied · standard retention allowed'), { exact: true })).toBeVisible();
      expect(guard.posts).toHaveLength(0); await consent.check(); await submit.click(); await expect(page.getByText(t('전사 완료 · 모든 청크 결과가 저장됐어요', 'Transcription complete · all chunks saved'), { exact: true })).toBeVisible();
      expect(guard.posts).toHaveLength(1); expect(guard.posts[0].provider).toEqual({ data_collection: 'deny', zdr: false });
      const versions = page.getByRole('combobox', { name: t('전사 버전', 'Transcript version'), exact: true }); await expect(versions).not.toHaveValue(''); const selected = await versions.inputValue();
      await page.getByRole('button', { name: t('청크별 원본', 'Raw by chunk'), exact: true }).click(); await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      const rawCard = page.locator('section').filter({ has: page.getByText(t('원본 전사', 'Raw transcript') + ' #1', { exact: true }) });
      await expect(rawCard).toContainText(t('OpenRouter · 동적 처리 제공사', 'OpenRouter · dynamic processor')); await expect(rawCard).not.toContainText('Direct OpenAI'); await expect(page.getByRole('region', { name: t('STT 사용량 명세', 'STT usage statement'), exact: true })).toContainText(t('저장된 요청 경로·모델', 'Recorded requested adapters/models') + ': OpenRouter'); await capture(page, language, 'raw-result');
      const encrypted = await inspectVaultSentinels(page, [text, fakeKey, 'TEST_ONLY_OR_STT.wav']); expect(encrypted.records).toBeGreaterThan(0); expect(encrypted.leakedSentinelIndices).toEqual([]);
      await clickAppAction(page, t('지금 잠그기', 'Lock now')); await expect(page.getByRole('main')).toHaveCount(0); await page.reload(); await unlock(page); await languageUI(page, language);
      await discover(page, language); await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click(); await openSaved(page, language);
      await expect(versions).toHaveValue(selected); await expect(page.getByText(text, { exact: true }).first()).toBeVisible(); await expect(consent).not.toBeChecked();
      expect(guard.posts).toHaveLength(1); expect(guard.calls.some(call => call.url.startsWith('https://api.openai.com/'))).toBe(false); expect(guard.unexpected).toEqual([]); expect(errors).toEqual([]);
      await capture(page, language, 'encrypted-reload'); await writeFile(`${evidence}/${language}-${width}-network.json`, JSON.stringify({ calls: guard.calls, posts: guard.posts, encrypted, unexpected: guard.unexpected, errors }, null, 2));
    });
  });
}

test('OR checkpoint failure recovers completed work on lock, then a late rerun response is discarded', async ({ page }) => {
  const guard = await guardedTransport(page), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page, 'ko'); await prepare(page, 'ko'); guard.state.failCheckpoint = true;
  await page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true }).check(); await page.getByRole('button', { name: '전사 실행', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('암호화 저장에 실패'); expect(guard.posts).toHaveLength(1); expect(guard.posts[0].provider).toEqual({ data_collection: 'deny', zdr: true });
  await expect(page.getByText('전사 완료 · 모든 청크 결과가 저장됐어요', { exact: true })).toHaveCount(0); await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await clickAppAction(page, '지금 잠그기'); await expect(page.getByRole('heading', { name: '완료분 저장에 실패했어요', exact: true })).toBeVisible(); await expect(page.getByRole('main')).toHaveCount(0);
  await capture(page, 'ko', 'lock-save-failure');
  await page.evaluate(() => { (window as unknown as { syntheticRejectCheckpoint: boolean }).syntheticRejectCheckpoint = false; }); guard.state.failCheckpoint = false;
  await page.getByRole('button', { name: '저장 후 잠금 다시 시도', exact: true }).click(); await expect(page.getByRole('heading', { name: '암호로 잠금 해제', exact: true })).toBeVisible(); await unlock(page);
  await discover(page, 'ko'); await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click(); await openSaved(page, 'ko');
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible(); const versions = page.getByRole('combobox', { name: '전사 버전', exact: true }), selected = await versions.inputValue(), count = await versions.locator('option').count(); expect(guard.posts).toHaveLength(1);
  guard.state.hold = true; await page.getByRole('button', { name: '다시 전사', exact: true }).click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('checkbox')).not.toBeChecked(); await expect(dialog).toContainText('브라우저 → OpenRouter → 동적으로 선택되는 처리 제공사');
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '전사 실행', exact: true }).click(); await expect.poll(() => guard.state.entered).toBe(true);
  await clickAppAction(page, '지금 잠그기'); await expect(page.getByRole('main')).toHaveCount(0); guard.state.release(); await unlock(page);
  await page.getByRole('button', { name: /^열기 / }).click(); await page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button', { name: '2 전사', exact: true }).click();
  await expect(versions).toHaveValue(selected); await expect(versions.locator('option')).toHaveCount(count); await expect(page.getByText(lateText, { exact: true })).toHaveCount(0); await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('브라우저 → OpenRouter → 동적으로 선택되는 처리 제공사', { exact: true })).toBeVisible();
  await expect(page.getByText('현재 전사 정보를 확인할 수 없어요. 전송 전에 모델 설정에서 OpenRouter 전사 목록을 다시 조회하세요.', { exact: true })).toBeVisible();
  await expect(page.getByText(/중간 서버 없음|일반 전송 파일명/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '전사 실행', exact: true })).toBeDisabled();
  expect(guard.posts).toHaveLength(2); expect(guard.unexpected).toEqual([]); expect(errors).toEqual([]); await capture(page, 'ko', 'late-rerun-retained');
  await writeFile(`${evidence}/ko-1440-boundary-network.json`, JSON.stringify({ calls: guard.calls, posts: guard.posts, unexpected: guard.unexpected, errors }, null, 2));
});
