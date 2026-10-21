// Real local preparation and disposable encrypted vaults. Provider responses are synthetic and intercepted.
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createModelPreset, exportModelProfiles } from '../../src/react-app/providers/model-profiles';
import { clickAppAction, createVault, toneWav } from './helpers';

const evidence = '.superpowers/mobile-stages/qa/after';
const speech = 'SYNTHETIC_MOBILE_SPEECH: Review the release on Monday.';
const editedSpeech = 'SYNTHETIC_MOBILE_EDIT: Review the release on Tuesday.';
const markdown = '# SYNTHETIC_MOBILE_NOTES\n\nReview the release on Tuesday.\n';
const notesConsent = '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.';

async function capture(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 &&
    document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth + 1)).toBe(true);
}
async function newMemo(page: Page, seconds = 6) {
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await expect(page.getByRole('region', { name: '메모 정보', exact: true })).toBeVisible();
  await page.getByLabel('메모 제목', { exact: true }).fill('SYNTHETIC_MOBILE_STAGES');
  await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_STAGE_AUDIO.wav', mimeType: 'audio/wav', buffer: toneWav(seconds) });
  await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect(page.getByText('로컬 음성 준비 완료', { exact: true })).toBeVisible();
}
async function registerSyntheticModels(page: Page) {
  await clickAppAction(page, '설정');
  const manager = page.getByRole('region', { name: '모델 관리', exact: true });
  await manager.getByRole('button', { name: 'JSON 가져오기', exact: true }).click();
  const stt = createModelPreset('compatible-stt');
  const models = [{ ...stt, name: 'SYNTHETIC_MOBILE_STT', modelId: 'synthetic-mobile-stt', stt: { ...stt.stt!, languageMode: 'multiple' as const, termMode: 'prompt' as const } },
    { ...createModelPreset('compatible-text'), name: 'SYNTHETIC_MOBILE_LLM', modelId: 'synthetic-mobile-llm', llm: { tokenField: 'max_tokens' as const, maxTokens: 4096, contextTokens: 32000 } }];
  const importer = page.getByRole('region', { name: '모델 가져오기', exact: true });
  await importer.getByLabel('모델 JSON', { exact: true }).fill(exportModelProfiles(models));
  await importer.getByRole('button', { name: '미리보기', exact: true }).click();
  await importer.getByRole('button', { name: '가져오기', exact: true }).click();
  for (const model of models) {
    const row = manager.getByRole('listitem').filter({ has: page.getByText(model.name, { exact: true }) });
    await row.getByRole('button', { name: '수정', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '모델 수정', exact: true });
    await editor.getByRole('checkbox', { name: '이 모델 활성화', exact: true }).check();
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
}
async function selectSTT(page: Page) {
  const model = page.getByRole('combobox', { name: '전사 모델', exact: true });
  await model.selectOption({ label: 'SYNTHETIC_MOBILE_STT' });
  await page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true }).check();
  await page.getByRole('button', { name: '전사 실행', exact: true }).click();
}

for (const width of [360, 390, 430, 1440]) test(`${width}px stage navigation and memo appearance remain reachable`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
  await page.route('https://**/*', route => route.abort());
  await createVault(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  const memo = page.getByRole('region', { name: '메모 정보', exact: true });
  await expect(memo).toBeVisible();
  const steps = page.getByRole('navigation', { name: '음성 메모 단계', exact: true });
  await expect(steps.getByRole('button')).toHaveCount(3);
  const stepBoxes = await steps.getByRole('button').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  expect(Math.max(...stepBoxes.map(box => box.y)) - Math.min(...stepBoxes.map(box => box.y))).toBeLessThanOrEqual(1);
  if (width < 760) {
    expect(Math.max(...stepBoxes.map(box => box.width)) - Math.min(...stepBoxes.map(box => box.width))).toBeLessThanOrEqual(1);
    for (const box of stepBoxes) expect(box.height).toBeGreaterThanOrEqual(44);
  }
  for (let index = 0; index < 3; index++) {
    await steps.getByRole('button').nth(index).focus();
    await expect(steps.getByRole('button').nth(index)).toBeFocused();
  }
  await expect(memo.getByLabel('메모 제목', { exact: true })).toBeVisible();
  await expect(memo.getByRole('group', { name: '사용 언어 · 복수 선택', exact: true })).toBeVisible();
  const appearance = memo.locator('.metadata-appearance-toggle');
  const icon = memo.locator('.metadata-appearance-options .icon-button').first();
  if (width < 760) {
    await expect(appearance).toHaveAttribute('aria-expanded', 'false');
    await expect(icon).toBeHidden();
  } else {
    await expect(appearance).toBeHidden();
    await expect(icon).toBeVisible();
    const after = await page.evaluate(() => Object.fromEntries(['.step-bar', '.preparation-metadata', '.title-input', '.preparation-metadata [role=group]', '.preparation-work', '.audio-input', '.preparation-actions'].map(selector => {
      const node = document.querySelector(selector)!, r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return [selector, { x: r.x, y: r.y, width: r.width, height: r.height, display: s.display, color: s.color, fontSize: s.fontSize, background: s.backgroundColor }];
    })));
    await mkdir(evidence, { recursive: true });
    await writeFile(`${evidence}/1440-geometry.json`, JSON.stringify(after, null, 2));
    expect(after['.preparation-work'].x).toBeGreaterThan(after['.preparation-metadata'].x + after['.preparation-metadata'].width);
  }
  await page.locator('main').evaluate(node => { node.scrollTop = 0; });
  await fits(page); await capture(page, `${width}-ko-preparation-new`);
  if (width < 760) {
    await appearance.focus(); await page.keyboard.press('Enter');
    await expect(appearance).toHaveAttribute('aria-expanded', 'true'); await expect(icon).toBeVisible();
    await capture(page, `${width}-ko-appearance-expanded`);
    await page.keyboard.press('Space'); await expect(appearance).toHaveAttribute('aria-expanded', 'false');
    await expect(icon).toBeHidden();
    if (width === 360) {
      await clickAppAction(page, '설정');
      await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
      await page.getByRole('button', { name: /^Open /u }).click();
      const englishSteps = page.getByRole('navigation', { name: 'Memo steps', exact: true });
      await expect(englishSteps.getByRole('button')).toHaveText(['1Prepare audio', '2Transcribe', '3Organize memo']);
      const layout = await englishSteps.getByRole('button').evaluateAll(buttons => buttons.map(button => ({
        top: button.getBoundingClientRect().top, width: button.getBoundingClientRect().width, fits: button.scrollWidth <= button.clientWidth + 1,
      })));
      expect(layout.every(button => button.fits)).toBe(true);
      expect(Math.max(...layout.map(button => button.top)) - Math.min(...layout.map(button => button.top))).toBeLessThanOrEqual(1);
      expect(Math.max(...layout.map(button => button.width)) - Math.min(...layout.map(button => button.width))).toBeLessThanOrEqual(1);
      await fits(page); await capture(page, '360-en-preparation-new');
    }
  } else {
    await icon.focus(); await expect(icon).toBeFocused(); await page.setViewportSize({ width: 360, height: 844 });
    await expect(icon).toBeVisible(); await expect(icon).toBeFocused();
    await expect(appearance).toHaveAttribute('aria-expanded', 'true');
    await capture(page, '360-ko-appearance-focus-retained-after-resize');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_RESIZE_AUDIO.wav', mimeType: 'audio/wav', buffer: toneWav(6) });
    await page.getByRole('button', { name: '전사 준비', exact: true }).click();
    await expect(page.getByText('로컬 음성 준비 완료', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
    await steps.getByRole('button').first().click();
    const processing = page.locator('details.processing-settings > summary');
    await processing.focus(); await expect(processing).toBeFocused();
    await page.setViewportSize({ width: 360, height: 844 });
    await expect(processing).toBeVisible(); await expect(processing).toBeFocused();
    await expect(page.getByRole('button', { name: '음성 준비 상세 접기', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await capture(page, '360-ko-preparation-focus-retained-after-resize');
  }
});

test('360px completed execution stays open until forward navigation; transcript and Markdown stay usable', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const calls: { url: string; body: string }[] = [];
  let release!: () => void; const response = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://**/*', route => route.abort());
  await page.route('http://localhost:8000/**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }); return; }
    calls.push({ url: route.request().url(), body: route.request().postData() ?? '' });
    const isSTT = route.request().url().endsWith('/audio/transcriptions');
    if (isSTT) await response;
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(isSTT ? { text: speech } : { choices: [{ message: { content: markdown }, finish_reason: 'stop' }] }) }).catch(() => {});
  });
  await createVault(page); await registerSyntheticModels(page); await newMemo(page);
  const steps = page.getByRole('navigation', { name: '음성 메모 단계', exact: true });
  await expect(page.getByRole('region', { name: '전사 준비', exact: true })).toBeVisible();
  await capture(page, '360-ko-preparation-complete-open');
  await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
  await steps.getByRole('button').nth(0).click();
  const showPreparation = page.getByRole('button', { name: '음성 준비 상세 펼치기', exact: true });
  await expect(showPreparation).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: '전사 준비', exact: true })).toBeHidden();
  await expect(page.getByLabel('메모 제목', { exact: true })).toBeVisible();
  await capture(page, '360-ko-preparation-revisit-collapsed');
  await showPreparation.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '전사 준비', exact: true })).toBeVisible();
  await steps.getByRole('button').nth(1).click();
  try {
    await selectSTT(page); await expect.poll(() => calls.length).toBe(1);
    await expect(page.locator('.stt-results')).toContainText('처리 중');
    await expect(page.getByRole('button', { name: '전사 취소', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '전사 상세 펼치기', exact: true })).toHaveCount(0);
    await capture(page, '360-ko-transcription-requesting');
    release();
    await expect(page.locator('.saved-count')).toHaveText('전사 결과 1 / 1');
    await expect(page.locator('.stt-setup')).toBeVisible(); await expect(page.locator('.stt-results')).toBeVisible();
    await expect(page.getByText(speech, { exact: true })).toBeVisible();
    await capture(page, '360-ko-transcription-complete-open');
  } finally { release(); }
  await page.getByRole('button', { name: '이 전사문으로 메모 정리', exact: true }).click();
  await steps.getByRole('button').nth(1).click();
  const showSTT = page.getByRole('button', { name: '전사 상세 펼치기', exact: true });
  await expect(showSTT).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.stt-setup')).toBeHidden(); await expect(page.locator('.stt-results')).toBeHidden();
  await expect(page.getByText(speech, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '문장 수정 1', exact: true }).click();
  await page.getByRole('textbox', { name: '전사 수정', exact: true }).fill(editedSpeech);
  await showSTT.click();
  const hideSTT = page.getByRole('button', { name: '전사 상세 접기', exact: true });
  await expect(hideSTT).toHaveAttribute('aria-expanded', 'true');
  await hideSTT.click();
  await expect(page.getByRole('textbox', { name: '전사 수정', exact: true })).toHaveValue(editedSpeech);
  await capture(page, '360-ko-transcription-collapsed-with-edit');
  await page.getByRole('button', { name: '전사 수정 저장', exact: true }).click();
  await expect(page.getByText(editedSpeech, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이 전사문으로 메모 정리', exact: true }).click();
  await page.getByRole('combobox', { name: '정리 모델', exact: true }).selectOption({ label: 'SYNTHETIC_MOBILE_LLM' });
  await page.getByRole('checkbox', { name: notesConsent, exact: true }).check();
  await page.getByRole('button', { name: '정리 노트 생성', exact: true }).click();
  await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_MOBILE_NOTES');
  expect(calls).toHaveLength(2); expect(calls[1].body).toContain(editedSpeech); expect(calls[1].body).not.toContain(speech);
  await expect(page.getByRole('button', { name: 'Markdown 복사', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '.md 다운로드', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '편집', exact: true }).click();
  const editedMarkdown = `${markdown}\n## SYNTHETIC_EDIT\nApproved fixture edit.\n`;
  await page.getByRole('textbox', { name: 'Markdown 편집기', exact: true }).fill(editedMarkdown);
  await page.getByRole('button', { name: '정리 노트 수정 저장', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '.md 다운로드', exact: true }).click();
  const download = await downloading; expect(download.suggestedFilename()).toMatch(/\.md$/u);
  expect(await readFile((await download.path())!, 'utf8')).toBe(editedMarkdown);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  await page.getByRole('button', { name: 'Markdown 복사', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /복사/u })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(editedMarkdown);
  await fits(page); await capture(page, '360-ko-notes-edited-export');
  await steps.getByRole('button').nth(1).click();
  await page.getByRole('button', { name: '전사 상세 펼치기', exact: true }).click();
  await page.getByRole('button', { name: '청크·압축 편집', exact: true }).click();
  await expect(page.getByRole('region', { name: '전사 준비', exact: true })).toBeVisible();
  await expect(page.locator('details.processing-settings')).toHaveAttribute('open', '');
  await expect(page.locator('details.processing-settings > summary')).toBeFocused();
  await capture(page, '360-ko-reset-editor-forced-open');
  expect(calls).toHaveLength(2); expect(errors).toEqual([]);
});

test('390px partial and failed STT remain expanded after forward navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls: string[] = []; let release!: () => void; const response = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://**/*', route => route.abort());
  await page.route('http://localhost:8000/**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }); return; }
    calls.push(route.request().url());
    if (calls.length === 1) await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ text: speech }) });
    else { await response; await route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":{"message":"SYNTHETIC_RATE_LIMIT"}}' }).catch(() => {}); }
  });
  await createVault(page); await registerSyntheticModels(page); await newMemo(page, 301);
  await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
  try {
    await selectSTT(page); await expect.poll(() => calls.length).toBe(2);
    await expect(page.locator('.saved-count')).toHaveText('전사 결과 1 / 2');
    await expect(page.locator('.stt-setup')).toBeVisible(); await expect(page.locator('.stt-results')).toBeVisible();
    await expect(page.getByRole('button', { name: '전사 취소', exact: true })).toBeVisible();
    await capture(page, '390-ko-transcription-partial-requesting'); release();
    await expect(page.locator('.chunk-status')).toContainText(['저장됨', '실패']);
    await expect(page.getByRole('button', { name: '실패한 청크만 다시 실행', exact: true })).toBeVisible();
  } finally { release(); }
  const steps = page.getByRole('navigation', { name: '음성 메모 단계', exact: true });
  await steps.getByRole('button').nth(2).click(); await steps.getByRole('button').nth(1).click();
  await expect(page.locator('.stt-setup')).toBeVisible(); await expect(page.locator('.stt-results')).toBeVisible();
  await expect(page.getByRole('button', { name: '실패한 청크만 다시 실행', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '전사 상세 펼치기', exact: true })).toHaveCount(0);
  await expect(page.getByText(speech, { exact: true })).toBeVisible();
  await fits(page); await capture(page, '390-ko-transcription-partial-failed-revisit');
  expect(calls).toHaveLength(2);
});
