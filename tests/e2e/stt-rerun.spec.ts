import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { clickAppAction, configureFixtureMinutes, createVault, enterFixtureKeys, fixtureTransport, inspectVaultSentinels, prepareForTranscription, selectFixtureMinutesRoute, routerEndpoint, routerModel, toneWav, unlock } from './helpers';

// Disposable keyless browser only: generated tone, fake keys, every provider request intercepted.
test.use({ viewport: { width: 1440, height: 900 } });
test('explicit saved-chunk rerun, frozen unknown retry, version/notes selection and lock preserve durable provenance', async ({ page }) => {
  const calls = await fixtureTransport(page), errors: string[] = [], postedMinutes: { messages: { content: string }[]; provider: { only: string[]; allow_fallbacks: boolean } }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let stt = 0, lateEntered = false, releaseLate!: () => void;
  const late = new Promise<void>(resolve => { releaseLate = resolve; });
  const texts = ['TEST_ONLY_RERUN_ORIGINAL_A', 'TEST_ONLY_RERUN_ORIGINAL_B', 'TEST_ONLY_RERUN_NEW_A', 'TEST_ONLY_NEVER_RETURNED', 'TEST_ONLY_RERUN_RETRY_A', 'TEST_ONLY_LATE_DISCARDED'];
  const sttBodies: string[] = [];
  await page.route('https://api.openai.com/v1/audio/transcriptions', async route => {
    const index = stt++; sttBodies.push(route.request().postData() ?? '');
    calls.push({ url: route.request().url(), body: null });
    if (index === 3) { await route.abort('failed'); return; }
    if (index === 5) { lateEntered = true; await late; }
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: texts[index], usage: { type: 'duration', seconds: 1 } }) }); } catch { if (index !== 5) throw new Error('Unexpected fixture response failure'); }
  });
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    const body = route.request().postDataJSON(); postedMinutes.push(body); expect(body.provider.only).toEqual([routerEndpoint.tag]); expect(body.provider.allow_fallbacks).toBe(false);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ model: routerModel.id, choices: [{ message: { content: '# TEST_ONLY_RETAINED_MINUTES' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 10 } }) });
  });
  const evidence = '.superpowers/sdd/remaining-work/task-stt-rerun-browser'; await mkdir(evidence, { recursive: true });
  await createVault(page); await enterFixtureKeys(page); await configureFixtureMinutes(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'TEST_ONLY_STT_RERUN_301S.wav', mimeType: 'audio/wav', buffer: toneWav(301) });
  await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('TEST_ONLY_STT_RERUN_301S.wav')).toBeVisible(); await prepareForTranscription(page);
  await page.getByRole('combobox', { name: '전사 모델', exact: true }).selectOption('gpt-transcribe');
  await page.getByRole('checkbox', { name: '위 내용을 확인했어요' }).check(); await page.getByRole('button', { name: '전사 실행', exact: true }).click();
  await expect(page.getByText('전사 완료 · 모든 청크 결과가 저장됐어요')).toBeVisible(); expect(stt).toBe(2);
  const versions = page.getByRole('combobox', { name: '전사 버전', exact: true }); const original = await versions.inputValue();
  await page.getByRole('button', { name: '문장 수정 1', exact: true }).click(); await page.getByRole('textbox', { name: '전사 수정', exact: true }).fill('TEST_ONLY_RETAINED_HUMAN_EDIT');
  await page.getByRole('button', { name: '전사 수정 저장', exact: true }).click(); await expect(versions).not.toHaveValue(original); const edited = await versions.inputValue();
  await page.getByRole('button', { name: '이 전사문으로 메모 정리', exact: true }).click(); await selectFixtureMinutesRoute(page, routerModel.id, routerEndpoint.tag);
  await page.getByRole('checkbox', { name: '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.' }).check();
  await page.getByRole('checkbox', { name: '미확인 겹침과 대안을 보존한 부분 정리 노트 생성을 확인했어요' }).check();
  await page.getByRole('button', { name: '정리 노트 생성', exact: true }).click(); await expect(page.locator('.minutes-output')).toContainText('TEST_ONLY_RETAINED_MINUTES');
  expect(JSON.parse(postedMinutes[0].messages[1].content).selectedTranscript.versionId).toBe(edited);
  const stages = page.getByRole('navigation', { name: '음성 메모 단계' }); await stages.getByRole('button', { name: '2 전사', exact: true }).click();
  const first = page.locator('.chunk-row').first(); await first.getByRole('button', { name: '다시 전사', exact: true }).click();
  let dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: '전사 실행', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('gpt-transcribe'); await expect(dialog).toContainText('ko, en'); await expect(dialog).toContainText('Direct OpenAI');
  await dialog.getByRole('button', { name: '취소', exact: true }).click(); expect(stt).toBe(2);
  await first.getByRole('button', { name: '다시 전사', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '전사 실행', exact: true }).click();
  await expect(first.getByRole('button', { name: '다시 전사', exact: true })).toBeEnabled(); expect(stt).toBe(3); await expect(versions).toHaveValue(edited); await expect(page.getByText('TEST_ONLY_RETAINED_HUMAN_EDIT', { exact: true }).first()).toBeVisible();
  const newVersion = await versions.locator('option').last().getAttribute('value'); expect(newVersion).toBeTruthy(); await versions.selectOption(newVersion!); await expect(versions).toHaveValue(newVersion!); expect(stt).toBe(3);
  await expect(page.getByText(texts[2], { exact: true }).first()).toBeVisible(); await page.getByRole('button', { name: '청크별 원본', exact: true }).click();
  for (const text of [texts[0], texts[1], texts[2]]) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '선택 전사', exact: true }).click(); await page.getByRole('button', { name: '이 전사문으로 메모 정리', exact: true }).click();
  await expect(page.locator('.minutes-output')).toContainText('TEST_ONLY_RETAINED_MINUTES'); await expect(page.getByRole('checkbox', { name: '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.' }).check(); await page.getByRole('checkbox', { name: '미확인 겹침과 대안을 보존한 부분 정리 노트 생성을 확인했어요' }).check();
  await page.getByRole('button', { name: '이 설정으로 다시 생성', exact: true }).click(); await expect.poll(() => postedMinutes.length).toBe(2); expect(JSON.parse(postedMinutes[1].messages[1].content).selectedTranscript.versionId).toBe(newVersion); expect(stt).toBe(3);
  await stages.getByRole('button', { name: '2 전사', exact: true }).click(); await first.getByRole('button', { name: '다시 전사', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '전사 실행', exact: true }).click();
  await expect(first.getByText('결과 불명 · 비용 발생 가능', { exact: true })).toBeVisible(); await expect(page.getByText('전사 완료 · 모든 청크 결과가 저장됐어요')).toHaveCount(0); await expect(versions).toHaveValue(newVersion!); expect(stt).toBe(4);
  await page.screenshot({ path: `${evidence}/unknown-rerun-retained-results.png`, fullPage: true });
  await clickAppAction(page, '지금 잠그기'); await expect(page.getByRole('main')).toHaveCount(0); await page.reload(); await unlock(page); expect(stt).toBe(4);
  await page.getByRole('button', { name: /^열기 / }).click(); await stages.getByRole('button', { name: '2 전사', exact: true }).click(); await expect(versions).toHaveValue(newVersion!);
  await first.getByRole('button', { name: '최근 요청 다시 시도', exact: true }).click(); dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: '전사 모델', exact: true })).toBeDisabled(); await expect(dialog).toContainText('gpt-transcribe'); await expect(dialog).toContainText('ko, en'); await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '전사 실행', exact: true }).click(); await expect(first.getByRole('button', { name: '다시 전사', exact: true })).toBeEnabled(); expect(stt).toBe(5); await expect(versions).toHaveValue(newVersion!);
  const retryVersion = await versions.locator('option').last().getAttribute('value'); await versions.selectOption(retryVersion!); await expect(page.getByText(texts[4], { exact: true }).first()).toBeVisible(); expect(stt).toBe(5);
  expect(sttBodies[4]).toContain('gpt-transcribe'); expect(sttBodies[4]).toContain('languages[]'); expect(sttBodies[4]).toContain('ko'); expect(sttBodies[4]).toContain('en');
  await page.getByText('전사 요청 이력', { exact: true }).click(); await expect(page.getByText('전사 요청 이력', { exact: true }).locator('..')).toContainText('Direct OpenAI');
  await page.screenshot({ path: `${evidence}/selected-retry-batch-history.png`, fullPage: true });
  const leaks = await inspectVaultSentinels(page, [...texts, 'TEST_ONLY_RETAINED_HUMAN_EDIT', 'TEST_ONLY_RETAINED_MINUTES', 'KEYLESS_BROWSER_OPENAI_TEST']); expect(leaks.records).toBeGreaterThan(0); expect(leaks.leakedSentinelIndices).toEqual([]);
  const versionCount = await versions.locator('option').count(); await first.getByRole('button', { name: '다시 전사', exact: true }).click(); dialog = page.getByRole('dialog'); await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '전사 실행', exact: true }).click();
  await expect.poll(() => lateEntered).toBe(true); await clickAppAction(page, '지금 잠그기'); await expect(page.getByRole('main')).toHaveCount(0); releaseLate(); await unlock(page);
  await page.getByRole('button', { name: /^열기 / }).click(); await stages.getByRole('button', { name: '2 전사', exact: true }).click(); await expect(versions).toHaveValue(retryVersion!); await expect(versions.locator('option')).toHaveCount(versionCount); await expect(page.getByText(texts[5], { exact: true })).toHaveCount(0); expect(stt).toBe(6);
  await page.getByRole('button', { name: '청크별 원본', exact: true }).click(); for (const text of [texts[0], texts[1], texts[2], texts[4]]) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
