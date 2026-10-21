import { expect, test } from '@playwright/test';
import { clickAppAction, configureFixtureMinutes, fixtureModelRow, selectFixtureMinutesRoute, prepareForTranscription, createVault, enterFixtureKeys, fixtureTransport, routerEndpoint, routerModel, toneWav } from './helpers';

// Ordinary rendered fixture check. Every external request is intercepted before navigation.
test('single and A/B cards display catalog modalities and timing disclosure while notes requests stay text only', async ({ page }) => {
 const calls = await fixtureTransport(page); const requests: Record<string, unknown>[] = [];
 const a = { ...routerModel, architecture: { input_modalities: ['text', 'image', 'audio', 'file'], output_modalities: ['text', 'image'] } };
 const b = { ...routerModel, id: 'fixture/modalities-b', name: 'TEST_ONLY_MODALITIES_B', architecture: { input_modalities: ['text', 'audio'], output_modalities: ['text', 'audio'] } };
 const endpointB = { ...routerEndpoint, tag: 'FixtureB/region', provider_name: 'FixtureB' };
 await page.route('https://openrouter.ai/api/v1/**', async route => {
  const url = route.request().url(); let body: unknown;
  if (url.endsWith('/models')) body = { data: [a, b] };
  else if (url.endsWith('/endpoints')) body = { data: { id: url.includes('modalities-b') ? b.id : a.id, endpoints: [url.includes('modalities-b') ? endpointB : routerEndpoint] } };
  else if (url.endsWith('/chat/completions')) {
   const sent = route.request().postDataJSON(); requests.push(sent);
   body = { model: sent.model, provider: sent.model === b.id ? 'FixtureB' : 'FixtureProvider', choices: [{ message: { content: '# TEST_ONLY_MODALITIES_RESULT' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20 } };
  } else { await route.abort(); return; }
  await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
 });
 await createVault(page); await enterFixtureKeys(page);
 await configureFixtureMinutes(page, [{ modelId: a.id, endpointTag: routerEndpoint.tag }, { modelId: b.id, endpointTag: endpointB.tag }]);
 await clickAppAction(page, '설정');
 await page.getByRole('tab', { name: '모델', exact: true }).click();
 const manager = page.getByRole('region', { name: '중앙 모델 관리' });
 await manager.getByRole('tab', { name: '정리 노트', exact: true }).click();
 for (const [model, endpoint] of [[a, routerEndpoint], [b, endpointB]] as const) {
  const routeRow = fixtureModelRow(page, 'openrouter', 'minutes', model.id, endpoint.tag);
  await routeRow.getByText('자세히 보기 · 메타데이터', { exact: true }).click();
  await expect(routeRow).toContainText(model.architecture.input_modalities.join(', '));
  await expect(routeRow).toContainText(model.architecture.output_modalities.join(', '));
  await expect(routeRow).toContainText('https://openrouter.ai/api/v1/models');
  await expect(routeRow).toContainText('USD');
  await expect(routeRow).toContainText(model.id); await expect(routeRow).toContainText(endpoint.tag);
 }
 await test.info().attach('modalities-central-settings-1440', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
 await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
 await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
 await page.locator('input[type=file]').setInputFiles({ name: 'TEST_ONLY_MODALITIES_SOURCE.wav', mimeType: 'audio/wav', buffer: toneWav() });
 await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('TEST_ONLY_MODALITIES_SOURCE.wav')).toBeVisible();
 await prepareForTranscription(page);
 await page.getByLabel('전사 모델').selectOption('gpt-transcribe');
 await page.getByRole('checkbox', { name: '위 내용을 확인했어요' }).check();
 await page.getByRole('button', { name: '전사 실행' }).click();
 await expect(page.getByRole('button', { name: '문장 수정 1' })).toBeVisible();
 await page.getByRole('button', { name: /정리 노트/, exact: false }).first().click();
 await selectFixtureMinutesRoute(page, a.id, routerEndpoint.tag);
 await page.getByText('자세히 보기 · 모델 요금·한도', { exact: true }).click();
 const single = page.getByRole('region', { name: '모델 상세' });
 await expect(single).toContainText('text, image, audio, file'); await expect(single).toContainText('text, image');
 await expect(single).toContainText('실행 후 실측'); await expect(single).toContainText('선택 엔드포인트의 실제 지원을 보장하지 않아요');
 await expect(single).toContainText('MoM 정리 노트 요청은 텍스트만 보내요');
 expect(requests).toHaveLength(0);
 const singleScreenshot = test.info().outputPath('modalities-single-1440.png');
 await single.screenshot({ path: singleScreenshot });
 await test.info().attach('modalities-single-1440', { path: singleScreenshot, contentType: 'image/png' });
 await page.getByRole('button', { name: '모델 비교', exact: true }).click();
 await selectFixtureMinutesRoute(page, b.id, endpointB.tag, 'ko', true);
 await page.getByText('자세히 보기 · 비교 모델 요금·한도', { exact: true }).click();
 const cards = page.getByRole('region', { name: '모델 상세' });
 await expect(cards).toHaveCount(2); await expect(cards.nth(0)).toContainText('text, image, audio, file'); await expect(cards.nth(1)).toContainText('text, audio');
 for (const card of await cards.all()) await expect(card).toContainText('실행 후 실측');
 expect(requests).toHaveLength(0);
 for (const [index, label] of ['A', 'B'].entries()) {
  const comparisonScreenshot = test.info().outputPath(`modalities-comparison-${label}-1440.png`);
  await cards.nth(index).screenshot({ path: comparisonScreenshot });
  await test.info().attach(`modalities-comparison-${label}-1440`, { path: comparisonScreenshot, contentType: 'image/png' });
 }
 await page.getByRole('checkbox', { name: '순차 요청 두 번의 전송·요금을 확인했어요' }).check();
 await page.getByRole('button', { name: '두 모델 비교 실행' }).click();
 await expect(page.getByRole('button', { name: 'B 결과 사용' })).toBeEnabled();
 expect(requests).toHaveLength(2);
 for (const request of requests) {
  expect((request.messages as { content: unknown }[]).every(message => typeof message.content === 'string')).toBe(true);
  expect(request).not.toHaveProperty('modalities');
 }
 await expect(page.getByRole('article', { name: 'A 결과' })).toContainText(/경과: \d+\.\d{2} s/);
 await expect(page.getByRole('article', { name: 'B 결과' })).toContainText(/경과: \d+\.\d{2} s/);
 expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(1);
});
