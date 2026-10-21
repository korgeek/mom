import { expect, test, type Page } from '@playwright/test';
import { clickAppAction, configureFixtureMinutes, selectFixtureMinutesRoute, prepareForTranscription, createVault, enterFixtureKeys, fixtureTransport, inspectVaultSentinels, routerEndpoint, routerModel, toneWav, unlock } from './helpers';

const modelB = { ...routerModel, id: 'fixture/text-b', name: 'Keyless comparison B', top_provider: { max_completion_tokens: 2048 } };
const endpointB = { ...routerEndpoint, tag: 'FixtureB/region', provider_name: 'FixtureB', max_completion_tokens: 1500 };
async function prepare(page: Page, options: { failB?: boolean; unknownPrice?: boolean } = {}) {
 const calls = await fixtureTransport(page); const requests: Record<string, unknown>[] = []; let failB = options.failB ?? false;
 // All external requests are intercepted before navigation, with only fake keys.
 await page.route('https://openrouter.ai/api/v1/**', async route => {
  const url = route.request().url(); let body: unknown = { data: [] }; let status = 200;
  if (url.endsWith('/models')) body = { data: [routerModel, modelB] };
  else if (url.endsWith('/endpoints')) body = { data: { id: url.includes('text-b') ? modelB.id : routerModel.id, endpoints: [url.includes('text-b') ? { ...endpointB, ...(options.unknownPrice ? { pricing: { prompt: '0.000001', completion: '0.000002' } } : {}) } : routerEndpoint] } };
  else if (url.endsWith('/chat/completions')) {
   const request = route.request().postDataJSON(); requests.push(request);
   const b = request.model === modelB.id; expect(request.provider.only).toEqual([b ? endpointB.tag : routerEndpoint.tag]); expect(request.provider.allow_fallbacks).toBe(false);
   if (b && failB) { status = 503; body = { error: { message: 'TEST_ONLY_B_FAILURE' } }; }
   else body = { model: request.model, provider: b ? 'FixtureB' : 'FixtureProvider', choices: [{ message: { content: `# TEST_ONLY_COMPARISON_${b ? 'B' : 'A'}\n\nGrounded fixture result.` }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20, ...(b ? {} : { cost: 0.01 }) } };
  } else { await route.fallback(); return; }
  await route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
 });
 await createVault(page); await enterFixtureKeys(page);
 await configureFixtureMinutes(page, [{ modelId: routerModel.id, endpointTag: routerEndpoint.tag }, { modelId: modelB.id, endpointTag: endpointB.tag }]);
 await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
 await page.locator('input[type=file]').setInputFiles({ name: 'TEST_ONLY_COMPARISON_SOURCE.wav', mimeType: 'audio/wav', buffer: toneWav() });
 await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('TEST_ONLY_COMPARISON_SOURCE.wav')).toBeVisible();
 await prepareForTranscription(page);
 await page.getByLabel('전사 모델').selectOption('gpt-transcribe');
 await page.getByRole('checkbox', { name: '위 내용을 확인했어요' }).check();
 await page.getByRole('button', { name: '전사 실행' }).click();
 await expect(page.getByRole('button', { name: '문장 수정 1' })).toBeVisible();
 await page.getByRole('button', { name: /정리 노트/, exact: false }).first().click();
 await selectFixtureMinutesRoute(page, routerModel.id, routerEndpoint.tag);
 await page.getByRole('button', { name: '모델 비교', exact: true }).click();
 await selectFixtureMinutesRoute(page, modelB.id, endpointB.tag, 'ko', true);
 await page.getByText('자세히 보기 · 비교 모델 요금·한도', { exact: true }).click();
 await expect(page.getByText(/공통 출력 예산: 1,500/)).toBeVisible();
 expect(requests).toHaveLength(0);
 return { requests, calls, allowB: () => { failB = false; } };
}
const transmission = '순차 요청 두 번의 전송·요금을 확인했어요';
test('two frozen requests, actual usage units, existing result editing/copy/export and encrypted reload', async ({ page, context }) => {
 const { requests, calls } = await prepare(page);
 await page.getByRole('checkbox', { name: transmission }).check();
 // Metadata refresh is an explicit central Settings action; no workflow catalog fetch.
 await page.getByRole('button', { name: '설정에서 요금·한도 확인', exact: true }).click();
 await configureFixtureMinutes(page, [{ modelId: routerModel.id, endpointTag: routerEndpoint.tag }, { modelId: modelB.id, endpointTag: endpointB.tag }]);
 await page.getByRole('button', { name: /^열기 / }).first().click();
 await page.getByRole('button', { name: /정리 노트/, exact: false }).first().click();
 await page.getByRole('button', { name: '모델 비교', exact: true }).click();
 await selectFixtureMinutesRoute(page, modelB.id, endpointB.tag, 'ko', true);
 await page.getByText('자세히 보기 · 비교 모델 요금·한도', { exact: true }).click();
 await expect(page.getByRole('checkbox', { name: transmission })).not.toBeChecked();
 await expect(page.getByRole('button', { name: '두 모델 비교 실행' })).toBeDisabled(); expect(requests).toHaveLength(0);
 await test.info().attach('comparison-ready-1440', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
 await page.getByRole('checkbox', { name: transmission }).check();
 await page.getByRole('button', { name: '두 모델 비교 실행' }).click();
 await expect(page.getByRole('button', { name: 'B 결과 사용' })).toBeEnabled();
 expect(requests).toHaveLength(2); expect(requests[0].messages).toEqual(requests[1].messages); expect(requests.map(request => request.max_tokens)).toEqual([1500, 1500]);
 await expect(page.getByRole('article', { name: 'A 결과' })).toContainText('reported · 0.010000 credits');
 await expect(page.getByRole('article', { name: 'B 결과' })).toContainText('estimated');
 await expect(page.getByRole('article', { name: 'B 결과' })).toContainText('USD');
 await page.getByRole('button', { name: 'A 결과 사용' }).click();
 await page.getByRole('button', { name: '편집', exact: true }).click();
 const edited = '# TEST_ONLY_COMPARISON_A_EDITED\n\n정확한 수정본.\n';
 await page.getByRole('textbox', { name: 'Markdown 편집기' }).fill(edited);
 await expect(page.getByRole('button', { name: 'B 결과 사용' })).toBeDisabled();
 await page.getByRole('button', { name: '정리 노트 수정 저장' }).click();
 const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '.md 다운로드' }).click();
 const download = await downloaded; const { readFile } = await import('node:fs/promises'); expect(await readFile((await download.path())!, 'utf8')).toBe(edited);
 await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
 await page.getByRole('button', { name: 'Markdown 복사' }).click();
 await expect(page.getByRole('status')).toContainText('복사'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(edited);
 await page.getByRole('button', { name: 'B 결과 사용' }).click();
 await expect(page.locator('.minutes-output')).toContainText('TEST_ONLY_COMPARISON_B');
 expect(requests).toHaveLength(2); expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(1);
 const vault = await inspectVaultSentinels(page, ['TEST_ONLY_COMPARISON_SOURCE.wav', 'KEYLESS_BROWSER_OPENAI_TEST', 'KEYLESS_BROWSER_ROUTER_TEST', edited, 'TEST_ONLY_COMPARISON_B']); expect(vault.leakedSentinelIndices).toEqual([]);
 await test.info().attach('comparison-results-1440', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
 await clickAppAction(page, '지금 잠그기'); await expect(page.getByRole('region', { name: '모델 비교 결과' })).toHaveCount(0);
 await expect(page.getByLabel('암호', { exact: true })).toBeEnabled();
 await page.reload(); await unlock(page); await page.getByRole('button', { name: /^열기 / }).first().click();
 await page.getByRole('button', { name: /정리 노트/, exact: false }).first().click();
 await page.getByRole('button', { name: '모델 비교', exact: true }).click(); await page.getByLabel('저장된 비교').selectOption({ index: 1 });
 await expect(page.getByRole('button', { name: 'A 결과 사용' })).toBeEnabled(); await expect(page.getByRole('button', { name: 'B 결과 사용' })).toBeEnabled(); expect(requests).toHaveLength(2);
});
test('unknown estimate acknowledgment, second failure retained, explicit member-only retry with original messages', async ({ page }) => {
 const { requests, allowB } = await prepare(page, { failB: true, unknownPrice: true });
 await page.getByRole('checkbox', { name: transmission }).check(); await expect(page.getByRole('button', { name: '두 모델 비교 실행' })).toBeDisabled();
 await page.getByRole('checkbox', { name: '전체 예상 비용이 확인 불가임을 확인했어요' }).check();
 await page.getByRole('button', { name: '두 모델 비교 실행' }).click();
 await expect(page.getByRole('article', { name: 'A 결과' })).toContainText('저장됨'); await expect(page.getByRole('article', { name: 'B 결과' })).toContainText('실패');
 expect(requests).toHaveLength(2);
 await test.info().attach('comparison-second-failure-1440', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
 await page.getByLabel('추가 작성 지침').fill('TEST_ONLY_LATER_INSTRUCTIONS');
 await page.getByRole('button', { name: 'B 요청 검토' }).click();
 await expect(page.getByRole('button', { name: 'B만 다시 요청' })).toBeDisabled();
 await page.getByRole('checkbox', { name: '이 멤버 재시도의 전송·추가 요금을 확인했어요' }).check();
 await page.getByRole('checkbox', { name: '전체 예상 비용이 확인 불가임을 확인했어요' }).check(); allowB();
 await page.getByRole('button', { name: 'B만 다시 요청' }).click();
 await expect(page.getByRole('button', { name: 'B 결과 사용' })).toBeEnabled();
 expect(requests.map(request => request.model)).toEqual([routerModel.id, modelB.id, modelB.id]); expect(requests[2].messages).toEqual(requests[0].messages); expect(requests[2].max_tokens).toBe(1500);
});
