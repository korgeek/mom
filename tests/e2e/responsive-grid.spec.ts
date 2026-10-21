// Disposable encrypted vaults, real local preparation and intercepted synthetic inference only.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createModelPreset, exportModelProfiles } from '../../src/react-app/providers/model-profiles';
import { clickAppAction, createVault, toneWav } from './helpers';

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 &&
    document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth + 1)).toBe(true);
}

async function alignToSteps(page: Page, left: Locator, right: Locator, split: 1 | 2) {
  await expect(page.locator('.step-bar button')).toHaveCount(3);
  await expect(left).toBeVisible(); await expect(right).toBeVisible();
  const steps = await page.locator('.step-bar button').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width };
  }));
  const a = (await left.boundingBox())!, b = (await right.boundingBox())!;
  expect(Math.max(...steps.map(step => step.width)) - Math.min(...steps.map(step => step.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(a.x - steps[0].left)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.x + a.width - steps[split - 1].right)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.x - steps[split].left)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.x + b.width - steps[2].right)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  const name = (await left.getAttribute('class'))?.split(' ').at(-1) ?? 'row';
  await writeFile(test.info().outputPath(`${name}-geometry.json`), JSON.stringify({ viewport: page.viewportSize(), steps, left: a, right: b }, null, 2));
  await fits(page);
}

async function syntheticModels(page: Page) {
  await clickAppAction(page, '설정');
  const manager = page.getByRole('region', { name: '모델 관리', exact: true });
  await manager.getByRole('button', { name: 'JSON 가져오기', exact: true }).click();
  const models = [
    { ...createModelPreset('compatible-stt'), name: 'SYNTHETIC_GRID_STT', modelId: 'synthetic-grid-stt' },
    { ...createModelPreset('compatible-text'), name: 'SYNTHETIC_GRID_LLM', modelId: 'synthetic-grid-llm', llm: { tokenField: 'max_tokens' as const, maxTokens: 4096, contextTokens: 32000 } },
  ];
  const importer = page.getByRole('region', { name: '모델 가져오기', exact: true });
  await importer.getByLabel('모델 JSON', { exact: true }).fill(exportModelProfiles(models));
  await importer.getByRole('button', { name: '미리보기', exact: true }).click();
  await importer.getByRole('button', { name: '가져오기', exact: true }).click();
  for (const model of models) {
    await manager.getByRole('listitem').filter({ has: page.getByText(model.name, { exact: true }) }).getByRole('button', { name: '수정', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '모델 수정', exact: true });
    await editor.getByRole('checkbox', { name: '이 모델 활성화', exact: true }).check();
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
}

for (const width of [1101, 1180, 1440]) test(`${width}px workflow rows share the step columns without coupling row heights`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route('https://**/*', route => route.abort());
  await page.route('http://localhost:8000/**', route => route.fulfill({
    contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(route.request().url().endsWith('/audio/transcriptions')
      ? { text: 'SYNTHETIC_GRID_TRANSCRIPT: Review the proposed release.' }
      : { choices: [{ message: { content: '# SYNTHETIC_GRID_NOTES\n\nReview the proposed release.' }, finish_reason: 'stop' }] }),
  }));
  await createVault(page); await syntheticModels(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await expect(page.locator('.step-bar button')).toHaveCount(3);
  await alignToSteps(page, page.locator('.preparation-metadata'), page.locator('.preparation-work'), 1);
  await page.screenshot({ path: testInfo.outputPath(`${width}-preparation.png`), fullPage: true });
  await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_GRID.wav', mimeType: 'audio/wav', buffer: toneWav(2) });
  await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect(page.getByRole('button', { name: '전사하기 →', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
  await alignToSteps(page, page.locator('.stt-setup'), page.locator('.stt-results'), 1);
  await page.getByRole('combobox', { name: '전사 모델', exact: true }).selectOption({ label: 'SYNTHETIC_GRID_STT' });
  await page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true }).check();
  await page.getByRole('button', { name: '전사 실행', exact: true }).click();
  await expect(page.locator('.saved-count')).toHaveText('전사 결과 1 / 1');
  await alignToSteps(page, page.locator('.review-grid > div'), page.locator('.review-grid > aside'), 2);
  const independent = await page.locator('.review-grid').evaluate(node => node.getBoundingClientRect().top >= document.querySelector('.stt-grid')!.getBoundingClientRect().bottom);
  expect(independent).toBe(true);
  await page.locator('main').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath(`${width}-transcript.png`), fullPage: true });
  await page.getByRole('button', { name: '이 전사문으로 메모 정리', exact: true }).click();
  await alignToSteps(page, page.locator('.minutes-setup'), page.locator('.minutes-results'), 1);
  await page.getByRole('combobox', { name: '정리 모델', exact: true }).selectOption({ label: 'SYNTHETIC_GRID_LLM' });
  await page.getByRole('checkbox', { name: '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.', exact: true }).check();
  await page.getByRole('button', { name: '정리 노트 생성', exact: true }).click();
  await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_GRID_NOTES');
  await alignToSteps(page, page.locator('.minutes-setup'), page.locator('.minutes-results'), 1);
  await page.locator('main').evaluate(node => { node.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath(`${width}-notes.png`), fullPage: true });
});

test.describe('wide touch viewport', () => {
  test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });
  test('keeps touch controls usable after expanding beyond the compact header', async ({ page }) => {
    await page.route('https://**/*', route => route.abort());
    await createVault(page);
    await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
    const icon = page.locator('.metadata-appearance-options .icon-button').first();
    await expect(icon).toBeVisible();
    expect((await icon.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.getByLabel('메모 제목', { exact: true }).evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    await fits(page);
  });
});

test('360px English stages retain completed-detail disclosure and focused controls across resize', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route('https://**/*', route => route.abort());
  await createVault(page);
  await clickAppAction(page, '설정');
  await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: '+ New voice memo', exact: true }).click();
  const steps = page.getByRole('navigation', { name: 'Memo steps', exact: true }).getByRole('button');
  await expect(steps).toHaveCount(3);
  expect(await steps.evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1))).toBe(true);
  await page.getByLabel('Audio file', { exact: true }).setInputFiles({ name: 'SYNTHETIC_GRID_FOCUS.wav', mimeType: 'audio/wav', buffer: toneWav(2) });
  await page.getByRole('button', { name: 'Prepare transcription', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transcribe →', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Transcribe →', exact: true }).click();
  await steps.first().click();
  const show = page.getByRole('button', { name: 'Show preparation details', exact: true });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.preparation-work')).toBeHidden();
  await show.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.preparation-work')).toBeVisible();
  await page.getByRole('button', { name: 'Hide preparation details', exact: true }).click();
  await expect(page.locator('.preparation-work')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  const processing = page.locator('details.processing-settings > summary');
  await processing.focus();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(processing).toBeVisible(); await expect(processing).toBeFocused();
  await fits(page);
  await page.screenshot({ path: testInfo.outputPath('360-en-completed-focus.png'), fullPage: true });
});

for (const width of [390, 759, 760, 768, 820, 960, 961, 1024, 1100]) test(`${width}px compact navigation preserves usable content, steps and settings tabs`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width < 760 ? 844 : 1024 });
  await page.route('https://**/*', route => route.abort());
  await createVault(page);
  await expect(page.getByRole('button', { name: '탐색 메뉴', exact: true })).toBeVisible();
  const sidebar = (await page.locator('.sidebar').boundingBox())!;
  expect(sidebar.width).toBeGreaterThanOrEqual(width - 1);
  expect(sidebar.height).toBeLessThanOrEqual(72);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await expect(page.locator('.step-bar button')).toHaveCount(3);
  const steps = await page.locator('.step-bar button').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { top: r.top, width: r.width, height: r.height, fits: node.scrollWidth <= node.clientWidth + 1 };
  }));
  expect(steps).toHaveLength(3);
  expect(steps.every(step => step.fits && step.height >= 44)).toBe(true);
  expect(Math.max(...steps.map(step => step.top)) - Math.min(...steps.map(step => step.top))).toBeLessThanOrEqual(1);
  expect(Math.max(...steps.map(step => step.width)) - Math.min(...steps.map(step => step.width))).toBeLessThanOrEqual(1);
  const memo = (await page.locator('.preparation-metadata').boundingBox())!, work = (await page.locator('.preparation-work').boundingBox())!;
  expect(work.y).toBeGreaterThanOrEqual(memo.y + memo.height);
  expect(Math.abs(work.width - memo.width)).toBeLessThanOrEqual(1);
  const title = page.getByLabel('메모 제목', { exact: true });
  await title.fill('SYNTHETIC_GRID_LONG_TITLE_'.repeat(4));
  expect((await title.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await fits(page);
  await page.screenshot({ path: testInfo.outputPath(`${width}-preparation.png`), fullPage: true });
  const navigation = page.getByRole('navigation', { name: '음성 메모 단계', exact: true });
  for (const [index, left, right] of [[1, '.stt-setup', '.stt-results'], [2, '.minutes-setup', '.minutes-results']] as const) {
    await navigation.getByRole('button').nth(index).click();
    await expect(page.locator(left)).toBeVisible(); await expect(page.locator(right)).toBeVisible();
    const a = (await page.locator(left).boundingBox())!, b = (await page.locator(right).boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    await fits(page);
    await page.screenshot({ path: testInfo.outputPath(`${width}-stage-${index + 1}.png`), fullPage: true });
  }
  await clickAppAction(page, '설정');
  const tabs = page.getByRole('tablist', { name: '설정 항목', exact: true });
  const boxes = await tabs.getByRole('tab').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })));
  expect(Math.max(...boxes.map(box => box.top)) - Math.min(...boxes.map(box => box.top))).toBeLessThanOrEqual(1);
  expect(boxes.every(box => box.height >= 44)).toBe(true);
  await tabs.getByRole('tab').first().focus(); await page.keyboard.press('End');
  await expect(tabs.getByRole('tab').last()).toBeFocused();
  await expect(tabs.getByRole('tab').last()).toBeInViewport();
  await fits(page);
  await page.screenshot({ path: testInfo.outputPath(`${width}-settings.png`), fullPage: true });
});
