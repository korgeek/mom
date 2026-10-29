// Deliberately synthetic provider responses. Audio preparation, HTTP/CORS and vault are real.
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { clickAppAction, createVault, inspectVaultSentinels, toneWav, unlock } from './helpers';
import { startLocalModelServer, syntheticModelResponse } from './fixtures/local-model-server';

type Adapter = 'openai' | 'openrouter' | 'openai-compatible';
const adapters: Adapter[] = ['openai', 'openrouter', 'openai-compatible'];
const fakeKey = 'SYNTHETIC_BROWSER_SHARED_KEY';

function profile(stage: 'stt' | 'llm', adapter: Adapter, localUrl: string) {
  const baseUrl = adapter === 'openai' ? 'https://api.openai.com/v1' : adapter === 'openrouter' ? 'https://openrouter.ai/api/v1' : localUrl;
  return {
    name: `SYNTHETIC ${adapter} ${stage}`, stage, adapter, baseUrl,
    endpointUrl: baseUrl + (stage === 'stt' ? '/audio/transcriptions' : '/chat/completions'),
    modelId: `synthetic-${stage}`, auth: adapter === 'openai-compatible' ? 'none' : 'bearer',
    ...(adapter === 'openrouter' ? { routerPolicy: { requireZdr: true, acknowledged: false } } : {}),
    ...(stage === 'stt' ? { stt: { formats: ['mp3', 'wav'], maxBytes: 16000000, languageMode: 'none', termMode: 'none', responseFormat: 'json', timestamps: 'none' } }
      : { llm: { tokenField: 'max_tokens', maxTokens: 1024, contextTokens: 32000 }, instructionTemplate: 'Use {{output_language}}. {{instructions}}' }),
  };
}
async function openModels(page: Page) {
  await clickAppAction(page, '설정');
  await page.getByRole('tab', { name: '모델 관리', exact: true }).click();
  return page.getByRole('region', { name: '모델 관리', exact: true });
}
async function importProfiles(page: Page, models: ReturnType<typeof profile>[]) {
  const manager = await openModels(page);
  await manager.getByRole('button', { name: 'JSON 가져오기', exact: true }).click();
  const form = manager.getByRole('region', { name: '모델 가져오기', exact: true });
  await form.getByLabel('모델 JSON', { exact: true }).fill(JSON.stringify({ format: 'mom-models', version: 1, models }));
  await form.getByRole('button', { name: '미리보기', exact: true }).click();
  await form.getByRole('button', { name: '가져오기', exact: true }).click();
  await expect(form).toHaveCount(0);
}
async function openKeys(page: Page) {
  await openModels(page);
  return page.getByRole('region', { name: 'API 키 관리', exact: true });
}
async function addKey(page: Page, provider: 'openai' | 'openrouter', name: string) {
  const editor=page.getByRole('dialog',{name:/새 모델 등록|모델 수정/u}),nested=await editor.isVisible();
  const keys=nested?editor:await openKeys(page);
  if (!nested && await keys.getByText(name, { exact: true }).count()) return;
  await keys.getByRole('button', { name: 'API 키 추가', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'API 키 추가', exact: true });
  await form.getByLabel('키 이름', { exact: true }).fill(name);
  await form.getByRole('combobox', { name: '제공사', exact: true }).selectOption(provider);
  await form.getByLabel('새 API 키', { exact: true }).fill(fakeKey);
  await form.getByRole('button', { name: '키 저장', exact: true }).click();
  await expect(form).toHaveCount(0);
  if(nested)await expect(keys.getByRole('option',{name,exact:true})).toHaveCount(1);
  else await expect(keys.getByRole('list', { name: '저장된 API 키' })).toContainText(name);
}
async function activate(page: Page, model: ReturnType<typeof profile>, reuseKeyName?: string) {
  const name = reuseKeyName ?? 'SYNTHETIC ' + model.adapter + ' key';
  if (model.auth === 'bearer') await addKey(page, model.adapter as 'openai' | 'openrouter', name);
  const manager = await openModels(page);
  await manager.getByRole('tab', { name: model.stage === 'stt' ? 'STT' : 'LLM', exact: true }).click();
  const row = manager.locator('.registration-row').filter({ has: page.getByText(model.name, { exact: true }) });
  await expect(row).toContainText('비활성');
  await row.getByRole('button', { name: '수정', exact: true }).click();
  const form = page.getByRole('dialog',{name:'모델 수정',exact:true});
  await form.getByRole('checkbox', { name: '이 모델 활성화', exact: true }).check();
  if (model.auth === 'bearer') {
    const key = form.getByRole('combobox', { name: 'API 키 선택', exact: true });
    await key.selectOption(await key.locator('option').filter({ hasText: name }).getAttribute('value') as string);
  }
  if (model.adapter === 'openrouter') await form.getByRole('checkbox', { name: '선택한 OpenRouter 전송·보관 정책을 확인했어요', exact: true }).check();
  await form.getByRole('button', { name: '저장', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(row).toContainText('활성');
  await manager.getByRole('button',{name:'기본 모델 설정',exact:true}).click();
  const defaults = page.getByRole('dialog',{name:'기본 모델 설정',exact:true}).getByRole('combobox', { name: `${model.stage.toUpperCase()} 기본 모델`, exact: true });
  await defaults.selectOption({ label: model.name });
  await expect(defaults).toHaveValue(await defaults.locator('option').filter({ hasText: model.name }).getAttribute('value') as string);
  await page.getByRole('dialog',{name:'기본 모델 설정',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();
}
async function prepareAndTranscribe(page: Page, succeeds = true) {
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
  await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_PRIVATE_SOURCE.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect(page.getByRole('button', { name: '전사하기 →', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
  await page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true }).check();
  await page.getByRole('button', { name: '전사 실행', exact: true }).click();
  if (succeeds) await expect(page.getByText('SYNTHETIC_MODEL_SPEECH: Review the release on Monday.', { exact: true }).first()).toBeVisible();
}

for (const sttAdapter of adapters) for (const llmAdapter of adapters) {
  test(`${sttAdapter} STT → ${llmAdapter} notes, separate keys and encrypted reload`, async ({ page }, testInfo) => {
    const local = await startLocalModelServer('http://127.0.0.1:4174');
    const cloudCalls: { url: string; authorization: string | undefined; body: string }[] = [];
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https:\/\/(api\.openai\.com|openrouter\.ai)\//u, async route => {
      const request = route.request(), url = request.url();
      const body = request.postData() ?? '';
      cloudCalls.push({ url, authorization: request.headers().authorization, body });
      const stage = url.endsWith('/audio/transcriptions') ? 'stt' : 'llm';
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(syntheticModelResponse(url, `synthetic-${stage}`)) });
    });
    try {
      await createVault(page);
      const stt = profile('stt', sttAdapter, local.url), llm = profile('llm', llmAdapter, local.url);
      await importProfiles(page, [stt, llm]);
      await activate(page, stt);
      await activate(page, llm, sttAdapter === llmAdapter && llm.auth === 'bearer' ? 'SYNTHETIC ' + llmAdapter + ' key' : undefined);
      expect(cloudCalls).toEqual([]); expect(local.calls).toEqual([]);
      if (sttAdapter === 'openrouter' && llmAdapter === 'openrouter') {
        const manager = page.getByRole('region', { name: '모델 관리', exact: true });
        const download = page.waitForEvent('download');
        await manager.getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
        const exported = await readFile((await (await download).path())!, 'utf8');
        expect(exported).toContain('{{output_language}}');
        expect(exported).not.toMatch(/credential|SYNTHETIC_BROWSER_SHARED_KEY|SYNTHETIC openrouter key|lastTest/u);
        await page.screenshot({ path: testInfo.outputPath('models-desktop-ko.png'), fullPage: true });
      }
      await prepareAndTranscribe(page);
      await page.getByRole('button', { name: '이 전사문으로 메모 정리', exact: true }).click();
      await page.getByRole('checkbox', { name: '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.', exact: true }).check();
      await page.getByRole('button', { name: '정리 노트 생성', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'SYNTHETIC_MODEL_NOTES', exact: true })).toBeVisible();
      const calls = [...cloudCalls.map(call => ({ ...call, path: new URL(call.url).pathname })), ...local.calls];
      expect(calls).toHaveLength(2);
      expect(calls.find(call => call.path.endsWith('/audio/transcriptions'))?.authorization).toBe(stt.auth === 'bearer' ? 'Bearer ' + fakeKey : undefined);
      expect(calls.find(call => call.path.endsWith('/chat/completions'))?.authorization).toBe(llm.auth === 'bearer' ? 'Bearer ' + fakeKey : undefined);
      const notes = calls.find(call => call.path.endsWith('/chat/completions'))!.body;
      expect(notes).toContain('SYNTHETIC_MODEL_SPEECH'); expect(notes).not.toContain('input_audio');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: '.md 다운로드', exact: true }).click();
      expect(await readFile((await (await download).path())!, 'utf8')).toContain('SYNTHETIC_MODEL_NOTES');
      expect((await inspectVaultSentinels(page, [fakeKey, 'SYNTHETIC_PRIVATE_SOURCE.wav', 'SYNTHETIC_MODEL_SPEECH', 'SYNTHETIC_MODEL_NOTES'])).leakedSentinelIndices).toEqual([]);
      if (sttAdapter === 'openrouter' && llmAdapter === 'openrouter') await page.screenshot({ path: testInfo.outputPath('notes-desktop-ko.png'), fullPage: true });
      await page.reload(); await unlock(page);
      await page.getByRole('button', { name: /^열기 / }).click();
      await page.getByRole('button', { name: /정리 노트/ }).first().click();
      await expect(page.getByRole('heading', { name: 'SYNTHETIC_MODEL_NOTES', exact: true })).toBeVisible();
      expect(cloudCalls.length + local.calls.length).toBe(2); expect(errors).toEqual([]);
    } finally { await local.close(); }
  });
}

test('a local server without CORS yields an unknown outcome and never falls back or retries automatically', async ({ page }) => {
  const local = await startLocalModelServer('http://127.0.0.1:4174');
  const cloudCalls: string[] = [];
  await page.route(/^https:\/\/(api\.openai\.com|openrouter\.ai)\//u, route => { cloudCalls.push(route.request().url()); return route.abort(); });
  try {
    await createVault(page);
    const model = profile('stt', 'openai-compatible', local.url);
    await importProfiles(page, [model]); await activate(page, model);
    local.setCors(false);
    await prepareAndTranscribe(page, false);
    await expect(page.locator('.chunk-status')).toContainText('결과 불명 · 비용 발생 가능');
    expect(local.calls).toHaveLength(1); expect(cloudCalls).toEqual([]);
    await page.reload(); await unlock(page);
    await page.getByRole('button', { name: /^열기 / }).click();
    expect(local.calls).toHaveLength(1); expect(cloudCalls).toEqual([]);
  } finally { await local.close(); }
});

test('one named key is saved before models, then reused, rotated, detached and deleted independently', async ({ page }, testInfo) => {
  const calls: string[] = [];
  await page.route(/^https:\/\/(api\.openai\.com|openrouter\.ai)\//u, route => { calls.push(route.request().url()); return route.abort(); });
  await createVault(page);
  await addKey(page, 'openrouter', 'SYNTHETIC openrouter key');
  await openModels(page);
  await expect(page.getByText('등록한 모델이 없어요.', { exact: true })).toBeVisible();
  await page.reload(); await unlock(page);
  const keys = await openKeys(page);
  const row = keys.getByRole('listitem').filter({ has: page.getByText('SYNTHETIC openrouter key', { exact: true }) });
  await expect(row).toBeVisible(); await expect(row).not.toContainText('키 입력 필요');
  await page.screenshot({ path: testInfo.outputPath('key-before-models-desktop-ko.png'), fullPage: true });
  const stt = profile('stt', 'openrouter', ''), llm = profile('llm', 'openrouter', '');
  await importProfiles(page, [stt, llm]);
  await activate(page, stt, 'SYNTHETIC openrouter key'); await activate(page, llm, 'SYNTHETIC openrouter key');
  const manager = page.getByRole('region', { name: '모델 관리', exact: true });
  await openKeys(page);
  await row.getByLabel('SYNTHETIC openrouter key 관리', { exact: true }).click();
  await row.getByRole('button', { name: '키 수정', exact: true }).click();
  const keyForm = page.getByRole('dialog', { name: 'API 키 수정', exact: true });
  await expect(keyForm.getByLabel('새 API 키', { exact: true })).toHaveValue('');
  await keyForm.getByLabel('새 API 키', { exact: true }).fill('SYNTHETIC_BROWSER_ROTATED_KEY');
  await keyForm.getByRole('button', { name: '키 저장', exact: true }).click();
  await expect(keyForm).toHaveCount(0);
  await openModels(page); await manager.getByRole('tab', { name: 'LLM', exact: true }).click();
  const notesRow = manager.locator('.registration-row').filter({ has: page.getByText(llm.name, { exact: true }) });
  await notesRow.getByRole('button', { name: '수정', exact: true }).click();
  const modelForm = page.getByRole('dialog',{name:'모델 수정',exact:true});
  await modelForm.getByRole('combobox', { name: 'API 키 선택', exact: true }).selectOption('');
  await modelForm.getByRole('button', { name: '저장', exact: true }).click();
  await expect(modelForm).toHaveCount(0);
  await openKeys(page); await expect(row).toBeVisible();
  await row.getByLabel('SYNTHETIC openrouter key 관리', { exact: true }).click();
  await row.getByRole('button', { name: '키 삭제', exact: true }).click();
  const confirm = keys.getByRole('alertdialog', { name: 'API 키 삭제 확인', exact: true });
  await expect(confirm).toContainText('모델과 기존 결과는 유지');
  await confirm.getByRole('button', { name: '취소', exact: true }).click(); await expect(row).toBeVisible();
  await row.getByLabel('SYNTHETIC openrouter key 관리', { exact: true }).click();
  await row.getByRole('button', { name: '키 삭제', exact: true }).click();
  await confirm.getByRole('button', { name: '키 영구 삭제', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(calls).toEqual([]);
  expect((await inspectVaultSentinels(page, [fakeKey, 'SYNTHETIC_BROWSER_ROTATED_KEY'])).leakedSentinelIndices).toEqual([]);
  await page.reload(); await unlock(page); await openModels(page);
  await expect(manager.locator('.registration-row').filter({ has: page.getByText(stt.name, { exact: true }) })).toContainText('설정 전');
  await manager.getByRole('tab', { name: 'LLM', exact: true }).click(); await expect(notesRow).toContainText('설정 전');
});

test('locking a registered local request fences its late result and does not replay after reload', async ({ page }) => {
  const local = await startLocalModelServer('http://127.0.0.1:4174');
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  try {
    await createVault(page);
    const model = profile('stt', 'openai-compatible', local.url);
    await importProfiles(page, [model]); await activate(page, model);
    local.pauseResponsesUntil(delayed);
    await prepareAndTranscribe(page, false);
    await expect.poll(() => local.calls.length).toBe(1);
    await clickAppAction(page, '지금 잠그기');
    await expect(page.getByRole('heading', { name: '암호로 잠금 해제', exact: true })).toBeVisible();
    release();
    await expect(page.getByText(/SYNTHETIC_MODEL_SPEECH/u)).toHaveCount(0);
    await page.reload(); await unlock(page);
    expect(local.calls).toHaveLength(1);
    await expect(page.getByText(/SYNTHETIC_MODEL_SPEECH/u)).toHaveCount(0);
  } finally { release(); await local.close(); }
});

for (const language of ['ko', 'en'] as const) {
  test(`360px ${language} model editor keeps advanced fields collapsed and has no horizontal overflow`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await createVault(page);
    await openModels(page);
    if (language === 'en') {
      await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('tab', { name: 'Models', exact: true }).click();
    }
    const t = (ko: string, en: string) => language === 'ko' ? ko : en;
    const manager = page.getByRole('region', { name: t('모델 관리', 'Models'), exact: true });
    await expect(page.getByRole('tab', { name: t('연결 설정', 'Connections'), exact: true })).toHaveCount(0);
    await manager.getByRole('button', { name: t('새 모델', 'New model'), exact: true }).click();
    const editor=page.getByRole('dialog');
    await expect(editor.getByLabel(t('전체 엔드포인트 URL', 'Full endpoint URL'), { exact: true })).toHaveValue('https://openrouter.ai/api/v1/audio/transcriptions');
    const advanced = editor.locator('details').filter({ has: page.getByText(t('고급 설정', 'Advanced settings'), { exact: true }) });
    await expect(advanced).not.toHaveAttribute('open');
    await expect(editor.getByLabel(t('매개변수 JSON', 'Parameters JSON'), { exact: true })).toBeHidden();
    await expect(editor.getByRole('combobox', { name: t('API 키 선택', 'API key'), exact: true })).toBeVisible();
    await expect(editor.getByLabel(t('새 API 키', 'New API key'), { exact: true })).toHaveCount(0);
    const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, main: document.querySelector('main')!.scrollWidth, mainClient: document.querySelector('main')!.clientWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
    expect(widths.main).toBeLessThanOrEqual(widths.mainClient + 1);
    await page.screenshot({ path: testInfo.outputPath(`models-mobile-${language}.png`), fullPage: true });
  });
}

for (const width of [1440, 360]) for (const language of ['ko', 'en'] as const) {
  test(`${width}px ${language} API key list and editor stay independent from models`, async ({ page }, testInfo) => {
    const calls: string[] = [];
    await page.route(/^https:\/\/(api\.openai\.com|openrouter\.ai)\//u, route => { calls.push(route.request().url()); return route.abort(); });
    await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
    await createVault(page);
    await addKey(page, 'openrouter', 'SYNTHETIC key without models');
    if (language === 'en') {
      await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('tab', { name: 'Models', exact: true }).click();
    }
    const t = (ko: string, en: string) => language === 'ko' ? ko : en;
    const keys = page.getByRole('region', { name: t('API 키 관리', 'API key management'), exact: true });
    await expect(page.getByRole('tab', { name: t('API 키', 'API keys'), exact: true })).toHaveCount(0);
    await expect(keys.getByRole('list', { name: t('저장된 API 키', 'Saved API keys') })).toContainText('SYNTHETIC key without models');
    const models = page.getByRole('region', { name: t('모델 관리', 'Models'), exact: true });
    await models.getByRole('tab', { name: 'LLM', exact: true }).click();
    await expect(models.getByRole('tab', { name: 'LLM', exact: true })).toHaveAttribute('aria-selected', 'true');
    const modelBox = (await models.boundingBox())!, keyBox = (await keys.boundingBox())!;
    if (width === 1440) expect(keyBox.x).toBeGreaterThan(modelBox.x + modelBox.width);
    else expect(keyBox.y).toBeGreaterThan(modelBox.y);
    const footer = page.getByRole('navigation', { name: t('앱 정보 · 라이선스', 'App info & licenses'), exact: true });
    await expect(footer.getByRole('link', { name: t('제3자 라이선스', 'Third-party licenses'), exact: true })).toHaveAttribute('href', '/THIRD_PARTY_NOTICES.txt');
    await expect(footer.getByRole('link', { name: t('제3자 소스 · 재빌드 · 재연결', 'Third-party source · rebuild · relink'), exact: true })).toHaveAttribute('target', '_blank');
    await page.screenshot({ path: testInfo.outputPath(`api-keys-${width}-${language}.png`), fullPage: true });
    const actions = keys.getByLabel(t('SYNTHETIC key without models 관리', 'Manage SYNTHETIC key without models'), { exact: true });
    await actions.focus(); await page.keyboard.press('Enter');
    await expect(keys.getByRole('button', { name: t('키 수정', 'Edit key'), exact: true })).toBeVisible();
    await keys.getByRole('button', { name: t('키 수정', 'Edit key'), exact: true }).click();
    const form = page.getByRole('dialog', { name: t('API 키 수정', 'Edit API key'), exact: true });
    await expect(form.getByRole('combobox', { name: t('제공사', 'Provider'), exact: true })).toBeDisabled();
    await expect(form.getByLabel(t('새 API 키', 'New API key'), { exact: true })).toHaveValue('');
    await expect(form.getByLabel(t('키 이름', 'Key name'), { exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(form.getByLabel(t('새 API 키', 'New API key'), { exact: true })).toBeFocused();
    await form.getByRole('button', { name: t('취소', 'Cancel'), exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(await form.evaluate(node => node.matches(':modal') && (!document.hasFocus() || node.contains(document.activeElement)))).toBe(true);
    await form.getByLabel(t('키 이름', 'Key name'), { exact: true }).focus();
    await page.keyboard.press('Escape'); await expect(form).toHaveCount(0); await expect(actions).toBeFocused();
    await actions.press('Enter'); await keys.getByRole('button', { name: t('키 수정', 'Edit key'), exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`api-key-editor-${width}-${language}.png`), fullPage: true });
    const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, main: document.querySelector('main')!.scrollWidth, mainClient: document.querySelector('main')!.clientWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1); expect(widths.main).toBeLessThanOrEqual(widths.mainClient + 1);
    await form.getByLabel(t('새 API 키', 'New API key'), { exact: true }).fill('SYNTHETIC_PENDING_KEY');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect(page.getByRole('heading', { name: t('암호로 잠금 해제', 'Unlock with your passphrase'), exact: true })).toBeVisible();
    await expect(page.getByText('SYNTHETIC key without models', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel(t('새 API 키', 'New API key'), { exact: true })).toHaveCount(0);
    expect(calls).toEqual([]);
  });
}

test('saving a key modal preserves an unsaved model and makes the key immediately selectable', async ({ page }, testInfo) => {
  const calls: string[] = [];
  await page.route(/^https:\/\/(api\.openai\.com|openrouter\.ai)\//u, route => { calls.push(route.request().url()); return route.abort(); });
  await createVault(page); const models = await openModels(page);
  await models.getByRole('button', { name: '새 모델', exact: true }).click();
  const form = page.getByRole('dialog',{name:'새 모델 등록',exact:true});
  await form.getByLabel('이름', { exact: true }).fill('SYNTHETIC unsaved model');
  const add=form.getByRole('button',{name:'API 키 추가',exact:true});await add.click();
  const pending=page.getByRole('dialog',{name:'API 키 추가',exact:true});await pending.getByLabel('새 API 키',{exact:true}).fill('SYNTHETIC_CANCELLED_DRAFT');
  await page.screenshot({path:testInfo.outputPath('nested-key-dialog.png'),fullPage:true});
  await page.keyboard.press('Escape');await expect(pending).toHaveCount(0);await expect(form).toBeVisible();await expect(add).toBeFocused();
  await addKey(page, 'openrouter', 'SYNTHETIC draft key');
  await expect(form.getByLabel('이름', { exact: true })).toHaveValue('SYNTHETIC unsaved model');
  const key = form.getByRole('combobox', { name: 'API 키 선택', exact: true });
  await key.selectOption({ label: 'SYNTHETIC draft key' });
  await page.screenshot({ path: testInfo.outputPath('model-draft-after-key-save.png'), fullPage: true });
  await form.getByRole('button', { name: '저장', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(models.locator('.registration-row').filter({ has: page.getByText('SYNTHETIC unsaved model', { exact: true }) })).not.toContainText('설정 전');
  expect(calls).toEqual([]);
});

for(const [width,language] of [[1440,'ko'],[360,'en']] as const) {
  test(`${width}px ${language} unified model list separates editing, testing, deletion and key authentication`,async({page},testInfo)=>{
    const calls:{url:string;method:string}[]=[];
    await page.route(/^https:\/\/(api\.openai\.com|openrouter\.ai)\//u,async route=>{
      const request=route.request();calls.push({url:request.url(),method:request.method()});
      const body=request.url().endsWith('/key')?{data:{label:'synthetic-key'}}:request.url().endsWith('/audio/transcriptions')?{text:'SYNTHETIC_MODEL_TEST_SPEECH'}:{choices:[{message:{content:'SYNTHETIC_MODEL_TEST_NOTES'},finish_reason:'stop'}]};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.setViewportSize({width,height:width===360?800:900});await createVault(page);
    const stt=profile('stt','openrouter',''),llm=profile('llm','openrouter','');
    await importProfiles(page,[stt,llm]);await activate(page,stt);await activate(page,llm);
    if(language==='en'){await page.getByRole('tab',{name:'화면 · 언어',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('tab',{name:'Models',exact:true}).click();}
    const t=(ko:string,en:string)=>language==='ko'?ko:en;
    const manager=page.getByRole('region',{name:t('모델 관리','Models'),exact:true}),keys=page.getByRole('region',{name:t('API 키 관리','API key management'),exact:true});
    await manager.getByRole('tab',{name:t('전체','All'),exact:true}).click();
    const rows=manager.getByRole('list',{name:t('등록한 모델','Registered models'),exact:true}).getByRole('listitem');
    await expect(rows).toHaveCount(2);expect(calls).toEqual([]);
    await manager.getByRole('tab',{name:'STT',exact:true}).click();await expect(rows).toHaveCount(1);await expect(rows).toContainText(stt.name);
    await manager.getByRole('tab',{name:'LLM',exact:true}).click();await expect(rows).toHaveCount(1);await expect(rows).toContainText(llm.name);
    await manager.getByRole('tab',{name:'LLM',exact:true}).press('Home');await expect(rows).toHaveCount(2);
    await keys.getByRole('button',{name:t('연결 확인','Check connection'),exact:true}).click();await expect(keys.getByRole('listitem').getByRole('status')).toHaveText(t('인증 확인','Authenticated'));
    await keys.getByText(t('인증 확인','Authenticated'),{exact:true}).click();await expect(keys.getByText(t('인증을 확인했어요. 실제 모델 실행은 별도 테스트가 필요해요.','Authentication verified. Model inference has not been tested.'),{exact:true})).toBeVisible();
    expect(calls).toEqual([{url:'https://openrouter.ai/api/v1/key',method:'GET'}]);
    await page.screenshot({path:testInfo.outputPath(`unified-model-list-${width}-${language}.png`),fullPage:true});
    await manager.getByRole('button',{name:t('전송·공유 안내','Transmission & sharing details'),exact:true}).click();
    let dialog=page.getByRole('dialog',{name:t('전송·공유 안내','Transmission & sharing details'),exact:true});await expect(dialog).toContainText(t('로컬 암호화는 서버 로그','Local encryption does not control'));
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    const sttRow=rows.filter({has:page.getByText(stt.name,{exact:true})});
    await sttRow.getByRole('button',{name:t('수정','Edit'),exact:true}).click();dialog=page.getByRole('dialog',{name:t('모델 수정','Edit model'),exact:true});
    await expect(dialog.getByLabel(t('이름','Name'),{exact:true})).toHaveValue(stt.name);await expect(dialog.getByRole('button',{name:t('테스트 호출','Test call'),exact:true})).toHaveCount(0);
    await expect(dialog.getByLabel(t('매개변수 JSON','Parameters JSON'),{exact:true})).toBeHidden();
    await page.screenshot({path:testInfo.outputPath(`model-edit-${width}-${language}.png`),fullPage:true});
    if(language==='en') {
      const download=page.waitForEvent('download');await dialog.getByRole('button',{name:`Export ${stt.name} JSON`,exact:true}).click();
      const exported=await readFile((await (await download).path())!,'utf8');expect(JSON.parse(exported).models).toHaveLength(1);expect(exported).not.toMatch(/credential|SYNTHETIC_BROWSER_SHARED_KEY/u);
      expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    }
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    const target=width===1440?stt:llm,targetRow=rows.filter({has:page.getByText(target.name,{exact:true})});
    await targetRow.getByRole('button',{name:t('테스트','Test'),exact:true}).click();dialog=page.getByRole('dialog',{name:`${target.stage.toUpperCase()} ${t('테스트','test')}`,exact:true});
    await expect(dialog.getByLabel(t('이름','Name'),{exact:true})).toHaveCount(0);await expect(dialog.getByLabel(t('요청 템플릿 미리보기','Request template preview'),{exact:true})).toBeHidden();
    if(target.stage==='stt')await dialog.getByLabel(t('테스트 음성 (30초 · 5 MiB 이하)','Test audio (up to 30 seconds · 5 MiB)'),{exact:true}).setInputFiles({name:'SYNTHETIC_TEST.wav',mimeType:'audio/wav',buffer:toneWav()});
    else await expect(dialog.getByRole('textbox',{name:'Test transcript',exact:true})).not.toHaveValue('');
    await dialog.getByRole('checkbox',{name:t('OpenRouter 전송·보관 정책을 확인했어요.','I reviewed OpenRouter transmission and the selected retention policy.'),exact:false}).check();
    await dialog.getByRole('button',{name:t('테스트 호출','Test call'),exact:true}).click();await expect(dialog.getByRole('region',{name:t('테스트 결과','Test result'),exact:true})).toContainText('SYNTHETIC_MODEL_TEST_');
    expect(calls).toHaveLength(2);expect(calls[1]).toEqual({url:target.endpointUrl,method:'POST'});
    await page.screenshot({path:testInfo.outputPath(`model-test-${width}-${language}.png`),fullPage:true});
    const overflow=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,dialog:document.querySelector('dialog')!.scrollWidth,client:document.querySelector('dialog')!.clientWidth}));expect(overflow.width).toBeLessThanOrEqual(overflow.viewport+1);expect(overflow.dialog).toBeLessThanOrEqual(overflow.client+1);
    await page.keyboard.press('Escape');await sttRow.getByRole('button',{name:t('삭제','Delete'),exact:true}).click();
    const confirm=page.getByRole('alertdialog',{name:t('모델 삭제 확인','Confirm model deletion'),exact:true});await expect(confirm).toContainText(t('API 키와 기존','API keys, voice memos'));
    await confirm.getByRole('button',{name:t('취소','Cancel'),exact:true}).click();await expect(rows).toHaveCount(2);
    await sttRow.getByRole('button',{name:t('삭제','Delete'),exact:true}).click();await confirm.getByRole('button',{name:t('모델 삭제','Delete model'),exact:true}).click();await expect(sttRow).toHaveCount(0);await expect(keys.getByRole('listitem')).toHaveCount(1);
    await page.reload();await unlock(page);await clickAppAction(page, '설정');
    if(language==='en'){await page.getByRole('tab',{name:'화면 · 언어',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('tab',{name:'Models',exact:true}).click();}
    await expect(rows).toHaveCount(1);await expect(rows).toContainText(llm.name);await expect(keys).toContainText(t('인증 확인 전','Authentication not checked'));
    await manager.getByRole('button',{name:t('기본 모델 설정','Default models'),exact:true}).click();dialog=page.getByRole('dialog',{name:t('기본 모델 설정','Default models'),exact:true});
    await expect(dialog.getByRole('combobox',{name:t('STT 기본 모델','STT default model'),exact:true})).toHaveValue('');await expect(dialog.getByRole('combobox',{name:t('LLM 기본 모델','LLM default model'),exact:true})).not.toHaveValue('');
    await page.keyboard.press('Escape');await manager.getByRole('button',{name:t('새 모델','New model'),exact:true}).click();await page.getByRole('dialog').getByLabel(t('이름','Name'),{exact:true}).fill('SYNTHETIC_MODAL_DRAFT');
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(page.getByRole('heading',{name:t('암호로 잠금 해제','Unlock with your passphrase'),exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('SYNTHETIC_MODAL_DRAFT',{exact:true})).toHaveCount(0);
    expect(calls).toHaveLength(2);
  });
}
