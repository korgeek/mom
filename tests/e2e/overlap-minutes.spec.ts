import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createModelPreset, exportModelProfiles } from '../../src/react-app/providers/model-profiles';
import { clickAppAction, createVault, toneWav, unlock } from './helpers';

test('normal overlap goes straight to notes, while actual missing speech still requires consent', async ({ page, baseURL }) => {
  const evidence = process.env.MOM_OVERLAP_EVIDENCE ?? 'docs/superpowers/evidence/2026-10-19-overlap-minutes';
  mkdirSync(evidence, { recursive: true });
  const errors: string[] = [], external: string[] = [], notes: { messages: { content: string }[] }[] = [];
  let sttCalls = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => { if (new URL(route.request().url()).origin === new URL(baseURL!).origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.route('http://localhost:8000/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().url().endsWith('/chat/completions')) {
      notes.push(JSON.parse(route.request().postData()!));
      return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: `# SYNTHETIC_NOTES_${notes.length}` }, finish_reason: 'stop' }] }) });
    }
    sttCalls++;
    if (sttCalls === 2) return route.abort('failed');
    return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ text: `SYNTHETIC_CHUNK_${sttCalls}: Please release on Friday. ${sttCalls === 4 ? 'Cancel the Friday release.' : ''}` }) });
  });
  await createVault(page); await clickAppAction(page, '설정');
  const manager = page.getByRole('region', { name: '모델 관리', exact: true });
  await manager.getByRole('button', { name: 'JSON 가져오기', exact: true }).click();
  const models = [
    { ...createModelPreset('compatible-stt'), name: 'SYNTHETIC_OVERLAP_STT' },
    { ...createModelPreset('compatible-text'), name: 'SYNTHETIC_OVERLAP_NOTES', llm: { tokenField: 'max_tokens' as const, contextTokens: 64000, maxTokens: 8192 } },
  ];
  const importer = page.getByRole('region', { name: '모델 가져오기', exact: true });
  await importer.getByLabel('모델 JSON', { exact: true }).fill(exportModelProfiles(models));
  await importer.getByRole('button', { name: '미리보기', exact: true }).click(); await importer.getByRole('button', { name: '가져오기', exact: true }).click();
  for (const model of models) {
    await manager.getByRole('listitem').filter({ has: page.getByText(model.name, { exact: true }) }).getByRole('button', { name: '수정', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '모델 수정', exact: true });
    await editor.getByRole('checkbox', { name: '이 모델 활성화', exact: true }).check(); await editor.getByRole('button', { name: '저장', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_OVERLAP.wav', mimeType: 'audio/wav', buffer: toneWav(601) });
  await page.getByRole('button', { name: '전사 준비', exact: true }).click(); await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
  await page.getByRole('combobox', { name: '전사 모델', exact: true }).selectOption({ label: models[0].name });
  await page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true }).check(); await page.getByRole('button', { name: '전사 실행', exact: true }).click();
  await expect(page.locator('.saved-count')).toHaveText('전사 결과 1 / 3');
  const steps = page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button');
  await steps.nth(2).click();
  await page.getByRole('combobox', { name: '정리 모델', exact: true }).selectOption({ label: models[1].name });
  const send = page.getByRole('checkbox', { name: '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.', exact: true });
  const partial = page.getByRole('checkbox', { name: '누락을 표시한 부분 정리 노트 생성을 확인했어요', exact: true });
  const generate = page.getByRole('button', { name: /^(정리 노트 생성|이 설정으로 다시 생성)$/ });
  await expect(page.getByText(/선택 전사에 포함되지 않은 구간:/)).toContainText('05:00–10:01');
  await send.check(); await expect(generate).toBeDisabled(); await partial.check(); await generate.click();
  await expect(page.locator('.minutes-output')).toContainText('Incomplete transcript');
  await page.screenshot({ path: `${evidence}/1440-actual-missing.png`, fullPage: false });
  expect(notes).toHaveLength(1);
  await steps.nth(1).click(); await page.getByRole('button', { name: '전체 전사', exact: true }).click();
  const scope = page.getByRole('dialog', { name: '전체 전사', exact: true });
  await scope.getByRole('checkbox').check(); await scope.getByRole('button', { name: '전사 실행', exact: true }).click();
  await expect(page.locator('.saved-count')).toHaveText('전사 결과 3 / 3');
  await steps.nth(2).click();
  await expect(partial).toHaveCount(0); await expect(page.getByText(/선택 전사에 포함되지 않은 구간:/)).toHaveCount(0);
  await expect(page.getByRole('status', { name: '생성 가능 여부', exact: true })).toHaveText('전송 확인에 체크하면 생성할 수 있어요.');
  await send.check(); await expect(generate).toBeEnabled(); await generate.click();
  await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_NOTES_2');
  await expect(page.locator('.minutes-output')).not.toContainText('Incomplete transcript');
  const payload = JSON.parse(notes[1].messages[1].content).selectedTranscript;
  expect(payload.missingRanges).toEqual([]); expect(payload.segments).toHaveLength(3);
  expect(payload.intentionalOverlaps.map((item: { durationMs: number }) => item.durationMs)).toEqual([5000, 5000]);
  expect(payload.intentionalOverlaps.map((item: { rangeMs: number[] }) => item.rangeMs)).toEqual([[295000, 300000], [590000, 595000]]);
  expect(payload.chunks.map((chunk: { timing: string }) => chunk.timing)).toEqual(['chunk', 'chunk', 'chunk']);
  await page.screenshot({ path: `${evidence}/1440-normal-overlap-notes.png`, fullPage: false });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: `${evidence}/360-normal-overlap-notes.png`, fullPage: false });
  await steps.nth(1).click();
  const showChunks = page.getByRole('button', { name: '전사 상세 펼치기', exact: true }); if (await showChunks.isVisible()) await showChunks.click();
  await page.locator('.chunk-row').first().getByRole('button', { name: '전사 내용 확인', exact: true }).click();
  const chunk = page.getByRole('dialog', { name: '청크 #1 전사 내용', exact: true });
  await chunk.getByRole('button', { name: '청크 1 재생', exact: true }).click();
  await expect(chunk.getByRole('status', { name: '청크 1 재생 상태', exact: true })).toHaveText('재생 중');
  await chunk.getByRole('button', { name: '청크 1 일시정지', exact: true }).click();
  await expect(chunk.getByRole('status', { name: '청크 1 재생 상태', exact: true })).toHaveText('일시정지됨');
  await chunk.getByRole('button', { name: '청크 1 정지', exact: true }).click();
  expect(await chunk.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/360-chunk-playback.png`, fullPage: false });
  await chunk.getByRole('button', { name: '전체 전사에서 수정', exact: true }).click();
  const review = page.getByRole('dialog', { name: '전체 전사 확인·편집', exact: true });
  await expect(review.getByText('겹침 구간 확인', { exact: true })).toHaveCount(0);
  await review.getByRole('button', { name: '문장 수정 1', exact: true }).click();
  await review.getByRole('textbox', { name: '전사 수정', exact: true }).fill('SYNTHETIC_SELECTED_EDIT: Friday release remains cancelled.');
  await review.getByRole('button', { name: '전사 수정 저장', exact: true }).click();
  await page.screenshot({ path: `${evidence}/360-optional-edit.png`, fullPage: false });
  await review.getByRole('button', { name: '닫기', exact: true }).click(); await steps.nth(2).click();
  const expand = page.getByRole('button', { name: '정리 설정 펼치기', exact: true }); if (await expand.isVisible()) await expand.click();
  await send.check(); await generate.click(); await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_NOTES_3');
  expect(JSON.parse(notes[2].messages[1].content).selectedTranscript.segments[0].text).toContain('SYNTHETIC_SELECTED_EDIT');
  expect(sttCalls).toBe(4); expect(notes).toHaveLength(3);
  await page.reload(); await unlock(page); await page.getByRole('button', { name: /^열기 / }).first().click(); await steps.nth(2).click();
  await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_NOTES_3');
  await steps.nth(1).click(); if (await showChunks.isVisible()) await showChunks.click();
  await page.locator('.chunk-row').first().getByRole('button', { name: '전사 내용 확인', exact: true }).click();
  await expect(chunk).toContainText('SYNTHETIC_CHUNK_1');
  expect(sttCalls).toBe(4); expect(notes).toHaveLength(3); expect(errors).toEqual([]); expect(external).toEqual([]);
  writeFileSync(`${evidence}/observations.json`, JSON.stringify({ viewports: ['1440x900', '360x800'], sttCalls, notesCalls: notes.length, intentionalOverlaps: payload.intentionalOverlaps, missingRequiresConsent: true, overlapRequiresConsent: false, playbackPauseStop: true, editAndOriginalSurviveReload: true, errors, external }, null, 2));
});
