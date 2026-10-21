import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { clickAppAction, configureFixtureMinutes, configureFixtureSTT, fixtureModelRow, fixtureRouteKey, selectFixtureMinutesRoute, createVault, fixtureTransport, inspectVaultSentinels, routerEndpoint, routerModel, toneWav, unlock } from './helpers';

const evidence = '.superpowers/sdd/remaining-work/task-model-settings-fixtures/workflow';
for (const { language, width, height } of [{ language: 'ko' as const, width: 360, height: 800 }, { language: 'en' as const, width: 1440, height: 900 }]) test.describe(`${language} ${width} three-stage workflow`, () => {
  test.use({ viewport: { width, height }, hasTouch: width === 360 });
  test('keyless real preparation, encrypted reload, selected edits and acknowledged unresolved notes/comparison', async ({ page }) => {
    const t = (ko: string, en: string) => language === 'ko' ? ko : en;
    const calls = await fixtureTransport(page), errors: string[] = [], requests: { messages: { content: string }[]; model: string }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let stt = 0;
    const texts = ['TEST_ONLY_UNRESOLVED: proceed with the launch.', 'TEST_ONLY_UNRESOLVED: cancel the launch.'];
    await page.route('https://api.openai.com/v1/audio/transcriptions', async route => {
      calls.push({ url: route.request().url(), body: null });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: texts[stt++], usage: { type: 'duration', seconds: 1 } }) });
    });
    const modelB = { ...routerModel, id: 'fixture/workflow-b', name: 'TEST_ONLY_WORKFLOW_B' };
    const endpointB = { ...routerEndpoint, tag: 'FixtureWorkflowB/region', provider_name: 'FixtureWorkflowB' };
    await page.route('https://openrouter.ai/api/v1/**', async route => {
      const url = route.request().url(); let body: unknown;
      if (url.endsWith('/models')) body = { data: [routerModel, modelB] };
      else if (url.endsWith('/endpoints')) body = { data: { id: url.includes('workflow-b') ? modelB.id : routerModel.id, endpoints: [url.includes('workflow-b') ? endpointB : routerEndpoint] } };
      else if (url.endsWith('/chat/completions')) {
        const request = route.request().postDataJSON(); requests.push(request);
        expect(request.provider.only).toEqual([request.model === modelB.id ? endpointB.tag : routerEndpoint.tag]);
        expect(request.provider.allow_fallbacks).toBe(false);
        body = { model: request.model, choices: [{ message: { content: '# TEST_ONLY_WORKFLOW_MINUTES' }, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 10 } };
      } else { await route.abort(); return; }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await createVault(page);
    if (language === 'en') {
      await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '화면 · 언어' }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click(); await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
    }
    await mkdir(evidence, { recursive: true });
    const capture = async (state: string) => {
      const bounds = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, mainWidth: document.querySelector('main')?.clientWidth, mainScroll: document.querySelector('main')?.scrollWidth }));
      expect(bounds.documentWidth).toBeLessThanOrEqual(width + 1); if (bounds.mainWidth !== undefined) expect(bounds.mainScroll).toBeLessThanOrEqual(bounds.mainWidth + 1);
      await writeFile(`${evidence}/${width}-${language}-${state}.json`, JSON.stringify(bounds, null, 2));
      await page.screenshot({ path: `${evidence}/${width}-${language}-${state}.png`, fullPage: true });
    };
    await page.getByRole('main').getByRole('button', { name: t('+ 새 음성 메모', '+ New voice memo'), exact: true }).click();
    const steps = page.getByRole('navigation', { name: t('음성 메모 단계', 'Memo steps') }).getByRole('button');
    await expect(steps).toHaveCount(3);
    await expect(steps).toHaveText(language === 'ko' ? ['1음성 준비', '2전사', '3메모 정리'] : ['1Prepare audio', '2Transcribe', '3Organize memo']);
    await page.locator('input[type=file]').setInputFiles({ name: 'TEST_ONLY_301_SECOND_WORKFLOW.wav', mimeType: 'audio/wav', buffer: toneWav(301) });
    await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('TEST_ONLY_301_SECOND_WORKFLOW.wav')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: t('위 내용을 확인했어요', "I've reviewed the above") })).toHaveCount(0);
    await expect(page.getByLabel(t('전사 모델', 'Transcription model'))).toHaveCount(0);
    const chunks = page.locator('summary').filter({ hasText: t('청크·압축', 'Chunks & compression') }); await expect(chunks.locator('..')).not.toHaveAttribute('open');
    await capture('import-collapsed');
    await page.getByRole('button', { name: t('전사 준비', 'Prepare transcription'), exact: true }).click();
    await expect(page.getByText(t('로컬 음성 준비 완료', 'Local audio preparation complete'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('암호화 저장된 음성 청크: 2 / 계획 2', 'Encrypted audio chunks saved: 2 / planned 2'))).toBeVisible();
    expect(stt).toBe(0); expect(requests).toHaveLength(0); await capture('local-ready-keyless');
    const vault = await inspectVaultSentinels(page, ['TEST_ONLY_301_SECOND_WORKFLOW.wav']); expect(vault.records).toBeGreaterThan(0); expect(vault.leakedSentinelIndices).toEqual([]);
    await clickAppAction(page, t('지금 잠그기', 'Lock now'));
    await expect(page.getByLabel(t('암호', 'Passphrase'), { exact: true })).toBeEnabled(); await expect(page.getByRole('main')).toHaveCount(0);
    await capture('locked'); await page.reload();
    await unlock(page);
    if (language === 'en') {
      await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '화면 · 언어' }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click(); await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
    }
    await clickAppAction(page, t('설정', 'Settings')); await page.getByRole('tab', { name: t('연결 설정', 'Connections'), exact: true }).click();
    for (const provider of ['OpenAI', 'OpenRouter']) {
      const input = page.getByLabel(`${provider} API ${t('키', 'key')}`), section = page.locator('section').filter({ has: input });
      await input.fill(`KEYLESS_WORKFLOW_${provider}_TEST`); await section.getByRole('button', { name: t('키 저장', 'Save key'), exact: true }).click();
      await expect(section.getByText(t('저장됨 · 연결 미확인', 'Saved · connection unverified'))).toBeVisible();
    }
    await configureFixtureSTT(page, language);
    await configureFixtureMinutes(page, [{ modelId: routerModel.id, endpointTag: routerEndpoint.tag }, { modelId: modelB.id, endpointTag: endpointB.tag }], language);
    // Full-catalog search/filter/provenance belongs only to central Settings.
    await clickAppAction(page, t('설정', 'Settings'));
    await page.getByRole('tab', { name: t('모델', 'Models'), exact: true }).click();
    const manager = page.getByRole('region', { name: t('중앙 모델 관리', 'Central model management') });
    await manager.getByRole('tab', { name: t('정리 노트', 'Notes'), exact: true }).click();
    await manager.getByRole('combobox', { name: t('제공사', 'Provider'), exact: true }).selectOption('openrouter');
    await manager.getByRole('combobox', { name: t('카탈로그 소유자 / 네임스페이스', 'Catalog owner / namespace'), exact: true }).selectOption('unknown');
    await manager.getByRole('combobox', { name: t('카탈로그 요금', 'Catalog price'), exact: true }).selectOption('priced');
    await manager.getByRole('spinbutton', { name: t('최소 컨텍스트 토큰', 'Minimum context tokens'), exact: true }).fill('32000');
    await manager.getByRole('spinbutton', { name: t('최소 출력 토큰', 'Minimum output tokens'), exact: true }).fill('4096');
    const search = manager.getByRole('searchbox', { name: t('모델 검색', 'Search models'), exact: true }); await search.fill(routerModel.id);
    const exactRoute = fixtureModelRow(page, 'openrouter', 'minutes', routerModel.id, routerEndpoint.tag);
    await expect(manager.getByRole('listitem')).toHaveCount(1); await expect(exactRoute).toBeVisible();
    // Catalog rates do not resolve the actual endpoint price. Unknown remains
    // distinct until an exact endpoint's sourced rates are available.
    await manager.getByRole('combobox', { name: t('카탈로그 요금', 'Catalog price'), exact: true }).selectOption('unknown');
    const unresolvedRoute = fixtureModelRow(page, 'openrouter', 'minutes', routerModel.id, null);
    await expect(manager.getByRole('listitem')).toHaveCount(0);
    await manager.getByRole('spinbutton', { name: t('최소 컨텍스트 토큰', 'Minimum context tokens'), exact: true }).clear();
    await manager.getByRole('spinbutton', { name: t('최소 출력 토큰', 'Minimum output tokens'), exact: true }).clear();
    await expect(manager.getByRole('listitem')).toHaveCount(1); await expect(unresolvedRoute).toBeVisible();
    await expect(unresolvedRoute.getByRole('checkbox')).toBeDisabled();
    await manager.getByRole('combobox', { name: t('카탈로그 요금', 'Catalog price'), exact: true }).selectOption('priced');
    await manager.getByRole('spinbutton', { name: t('최소 컨텍스트 토큰', 'Minimum context tokens'), exact: true }).fill('32000');
    await manager.getByRole('spinbutton', { name: t('최소 출력 토큰', 'Minimum output tokens'), exact: true }).fill('4096');
    await expect(manager.getByRole('listitem')).toHaveCount(1); await expect(exactRoute).toBeVisible();
    const metadataSummary = exactRoute.getByText(t('자세히 보기 · 메타데이터', 'Details · metadata'), { exact: true });
    await expect(metadataSummary.locator('..')).not.toHaveAttribute('open'); await metadataSummary.focus(); await page.keyboard.press('Enter');
    await expect(metadataSummary.locator('..')).toHaveAttribute('open', '');
    await expect(exactRoute).toContainText('https://openrouter.ai/api/v1/models'); await expect(exactRoute).toContainText('USD');
    await expect(exactRoute).toContainText(routerModel.id); await expect(exactRoute).toContainText(routerEndpoint.tag); await capture('central-catalog-expanded');
    await metadataSummary.focus(); await page.keyboard.press('Space'); await expect(metadataSummary.locator('..')).not.toHaveAttribute('open'); await expect(exactRoute).toBeVisible(); await capture('central-catalog-collapsed');
    await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click(); await page.getByRole('button', { name: language === 'ko' ? /^열기 / : /^Open / }).click();
    await expect(page.getByRole('button', { name: t('전사 준비', 'Prepare transcription'), exact: true })).toBeDisabled();
    expect(stt).toBe(0); await capture('ready-after-encrypted-reload');
    await page.getByRole('button', { name: t('전사하기 →', 'Transcribe →'), exact: true }).click();
    await expect(page.getByLabel(t('전사 모델', 'Transcription model'))).not.toBeVisible();
    await expect(page.getByText('Direct OpenAI · api.openai.com/v1/audio/transcriptions')).toBeVisible();
    await capture('stt-before-paid-consent');
    await page.getByLabel(t('전사 모델', 'Transcription model')).selectOption('gpt-transcribe');
    await page.getByRole('checkbox', { name: t('위 내용을 확인했어요', "I've reviewed the above") }).check(); await page.getByRole('button', { name: t('전사 실행', 'Transcribe'), exact: true }).click();
    await expect(page.getByRole('button', { name: t('문장 수정 1', 'Edit segment 1') })).toBeVisible(); expect(stt).toBe(2);
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step'); await expect(page.getByText(t('확인 필요', 'Needs review'), { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: t('청크별 원본', 'Raw by chunk'), exact: true }).click(); for (const text of texts) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: t('선택 전사', 'Selected transcript'), exact: true }).click();
    const versions = page.getByLabel(t('전사 버전', 'Transcript version')), before = await versions.inputValue();
    await page.getByRole('button', { name: t('문장 수정 1', 'Edit segment 1') }).click(); await page.getByRole('textbox', { name: t('전사 수정', 'Transcript edit') }).fill('TEST_ONLY_EDITED_VERSION: launch decision remains uncertain.');
    await page.getByRole('button', { name: t('전사 수정 저장', 'Save transcript edit') }).click(); await expect(versions).not.toHaveValue(before);
    const editedVersion = await versions.inputValue(); await versions.selectOption(before); await expect(page.getByText(texts[0], { exact: true }).first()).toBeVisible();
    await versions.selectOption(editedVersion); await page.getByRole('button', { name: t('청크별 원본', 'Raw by chunk'), exact: true }).click(); for (const text of texts) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: t('선택 전사', 'Selected transcript'), exact: true }).click(); await capture('selected-edited-unresolved');
    await page.getByRole('button', { name: t('이 전사문으로 메모 정리', 'Organize memo from this transcript'), exact: true }).click();
    const basicModel = page.getByRole('combobox', { name: t('정리 모델', 'Notes model'), exact: true });
    const changeSummary = page.getByText(t('자세히 보기 · 모델 변경', 'Details · change model'), { exact: true });
    await expect(basicModel).not.toBeVisible(); await expect(page.getByText(/선택 모델 경로|Selected model route/).first()).toBeVisible();
    await changeSummary.focus(); await page.keyboard.press('Enter'); await expect(basicModel).toBeVisible();
    await basicModel.selectOption(fixtureRouteKey(routerModel.id, routerEndpoint.tag));
    await expect(basicModel).toHaveValue(fixtureRouteKey(routerModel.id, routerEndpoint.tag)); await capture('enabled-route-expanded');
    await changeSummary.focus(); await page.keyboard.press('Space'); await expect(basicModel).not.toBeVisible();
    await expect(page.getByText(/선택 모델 경로|Selected model route/).first()).toContainText(routerModel.id); await capture('enabled-route-collapsed');
    await expect(page.getByRole('combobox', { name: t('모델 분류', 'Model category'), exact: true })).toHaveCount(0);
    const generate = page.getByRole('button', { name: t('정리 노트 생성', 'Generate notes'), exact: true });
    await page.getByRole('checkbox', { name: t('선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.', 'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.') }).check(); await expect(generate).toBeEnabled(); await capture('normal-overlap-consent');
    await generate.click(); await expect(page.locator('.minutes-output')).not.toContainText('Unresolved overlap ranges:'); expect(requests).toHaveLength(1);
    await page.getByRole('button', { name: t('모델 비교', 'Compare models'), exact: true }).click(); await selectFixtureMinutesRoute(page, routerModel.id, routerEndpoint.tag, language, true);
    await expect(page.getByRole('combobox', { name: t('B 모델 분류', 'Member B model category'), exact: true })).toHaveCount(0);
    const compare = page.getByRole('button', { name: t('두 모델 비교 실행', 'Compare two models'), exact: true }); await expect(compare).toBeDisabled(); await expect(page.getByText(/서로 다른 모델 ID를 선택하세요|Choose two different model IDs/)).toBeVisible(); await capture('same-model-rejected');
    await selectFixtureMinutesRoute(page, modelB.id, endpointB.tag, language, true);
    await page.getByRole('checkbox', { name: t('순차 요청 두 번의 전송·요금을 확인했어요', 'I approve two sequential requests, transmission and charges') }).check(); await expect(compare).toBeEnabled(); await compare.click();
    await expect(page.getByRole('button', { name: t('B 결과 사용', 'Use result B'), exact: true })).toBeEnabled(); expect(requests).toHaveLength(3); expect(requests[1].messages).toEqual(requests[2].messages);
    for (const request of requests) {
      const input = JSON.parse(request.messages[1].content).selectedTranscript;
      expect(input.versionId).toBe(editedVersion); expect(input.intentionalOverlaps).toHaveLength(1); expect(input.intentionalOverlaps[0].durationMs).toBe(10000);
      expect(input).not.toHaveProperty('unresolvedBoundaries'); expect(request.messages[1].content).toContain('TEST_ONLY_EDITED_VERSION'); expect(request.messages[1].content).toContain(texts[1]);
    }
    expect(stt).toBe(2); expect(errors).toEqual([]); await capture('partial-comparison-results');
  });
});

test('local preparation cancel and lock fence a held native Worker without provider calls, then real preparation resumes', async ({ page }) => {
  const calls = await fixtureTransport(page);
  await page.addInitScript(() => {
    const state = { hold: true, held: 0, terminated: 0 };
    (window as unknown as { localPreparationLifecycle: typeof state }).localPreparationLifecycle = state;
    window.Worker = new Proxy(window.Worker, { construct(target, args) {
      const worker = Reflect.construct(target, args) as Worker;
      worker.postMessage = new Proxy(worker.postMessage, { apply(post, receiver, messages) {
        if (state.hold && messages[0]?.operation === 'start') { state.held++; return; }
        return Reflect.apply(post, receiver, messages);
      } });
      worker.terminate = new Proxy(worker.terminate, { apply(terminate, receiver, messages) { state.terminated++; return Reflect.apply(terminate, receiver, messages); } });
      return worker;
    } });
  });
  await createVault(page); await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'TEST_ONLY_LOCAL_CANCEL.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('TEST_ONLY_LOCAL_CANCEL.wav')).toBeVisible();
  await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { localPreparationLifecycle: { held: number } }).localPreparationLifecycle.held)).toBe(1);
  await page.getByRole('button', { name: '음성 준비 취소', exact: true }).click();
  await expect(page.getByRole('button', { name: '전사 준비', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: '로컬 음성 준비' })).toHaveCount(0);
  await mkdir(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/1440-ko-local-cancelled.png`, fullPage: true });
  await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { localPreparationLifecycle: { held: number } }).localPreparationLifecycle.held)).toBe(2);
  await clickAppAction(page, '지금 잠그기'); await expect(page.getByLabel('암호', { exact: true })).toBeEnabled();
  await expect(page.getByRole('main')).toHaveCount(0); await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('TEST_ONLY_LOCAL_CANCEL.wav')).toHaveCount(0);
  const actual = await page.evaluate(() => { const state = (window as unknown as { localPreparationLifecycle: { hold: boolean; held: number; terminated: number } }).localPreparationLifecycle; state.hold = false; return { held: state.held, terminated: state.terminated }; });
  expect(actual.terminated).toBeGreaterThanOrEqual(2); await writeFile(`${evidence}/1440-ko-local-lifecycle.json`, JSON.stringify(actual, null, 2));
  await unlock(page); await page.getByRole('button', { name: /^열기 / }).click(); await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect(page.getByText('로컬 음성 준비 완료', { exact: true })).toBeVisible();
  await expect(page.getByText('암호화 저장된 음성 청크: 1 / 계획 1')).toBeVisible();
  expect(calls.filter(call => /audio\/transcriptions|chat\/completions/.test(call.url))).toHaveLength(0);
  await page.screenshot({ path: `${evidence}/1440-ko-local-resumed-real-codec.png`, fullPage: true });
});
