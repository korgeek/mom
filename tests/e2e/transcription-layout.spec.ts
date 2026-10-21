import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createModelPreset, exportModelProfiles } from '../../src/react-app/providers/model-profiles';
import { clickAppAction, createVault, toneWav, unlock } from './helpers';

test('STT columns align with the three memo steps and stack on narrow screens', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await createVault(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await expect(page.getByRole('tab', { name: '파일 업로드', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button').nth(1).click();
  for (const width of [1440, 1100, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('.stt-grid').evaluate(grid => {
      const box = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
      return { steps: [...document.querySelectorAll('.step-bar button')].map(box), setup: box(grid.querySelector('.stt-setup')!), results: box(grid.querySelector('.stt-results')!), overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('main')!.scrollWidth > document.querySelector('main')!.clientWidth };
    });
    expect(layout.overflow).toBe(false);
    if (width > 1100) {
      expect(Math.abs(layout.setup.left - layout.steps[0].left)).toBeLessThan(1);
      expect(Math.abs(layout.setup.width - layout.steps[0].width)).toBeLessThan(1);
      expect(Math.abs(layout.results.left - layout.steps[1].left)).toBeLessThan(1);
      expect(Math.abs(layout.results.right - layout.steps[2].right)).toBeLessThan(1);
    } else {
      expect(layout.results.top).toBeGreaterThan(layout.setup.bottom);
      expect(Math.abs(layout.results.left - layout.setup.left)).toBeLessThan(1);
      expect(Math.abs(layout.results.width - layout.setup.width)).toBeLessThan(1);
    }
    await info.attach(`stt-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await info.attach(`stt-${width}-bounds`, { body: JSON.stringify(layout), contentType: 'application/json' });
  }
  expect(errors).toEqual([]);
});

test('visible STT selection and right-side execution require fresh consent before a synthetic request', async ({ page }) => {
  const evidence = 'docs/superpowers/evidence/2026-10-17-input-hints-notes-layout';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const calls: string[] = [];
  let release!: () => void; const response = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://**/*', route => route.request().url() === 'https://openrouter.ai/api/v1/models'
    ? route.fulfill({ contentType: 'application/json', body: '{"data":[]}' }) : route.abort());
  // No server or key: only this explicitly synthetic local endpoint is intercepted.
  await page.route('http://localhost:8000/**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }); return; }
    calls.push(route.request().postData() ?? ''); await response;
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: route.request().url().includes('/chat/completions') ? JSON.stringify({choices:[{message:{content:'# SYNTHETIC_NOTES_RESULT\n\nSynthetic fixture notes.'},finish_reason:'stop'}]}) : '{"text":"SYNTHETIC_LAYOUT_RESPONSE"}' }).catch(() => {});
  });
  await createVault(page); await expect(page).toHaveTitle('MoM');
  await expect(page.getByRole('complementary').getByText('Minutes of Meeting', { exact: true })).toBeVisible();
  await clickAppAction(page, '설정');
  const manager = page.getByRole('region', { name: '모델 관리', exact: true });
  await manager.getByRole('button', { name: 'JSON 가져오기', exact: true }).click();
  const models = ['A', 'B'].map(name => { const model=createModelPreset('compatible-stt'); return {...model,name:`SYNTHETIC_STT_${name}`,modelId:`synthetic-stt-${name.toLowerCase()}`,stt:{...model.stt!,languageMode:name==='B'?'single' as const:'none' as const,termMode:name==='B'?'prompt' as const:'none' as const}}; });
  const textModel={...createModelPreset('compatible-text'),name:'SYNTHETIC_NOTES_MODEL',modelId:'synthetic-notes',llm:{tokenField:'max_tokens' as const,contextTokens:8192,maxTokens:512}};
  const importer = page.getByRole('region', { name: '모델 가져오기', exact: true });
  await importer.getByLabel('모델 JSON', { exact: true }).fill(exportModelProfiles([...models,textModel]));
  await importer.getByRole('button', { name: '미리보기', exact: true }).click();
  await importer.getByRole('button', { name: '가져오기', exact: true }).click();
  for (const model of [...models,textModel]) {
    const row = manager.getByRole('listitem').filter({ has: page.getByText(model.name, { exact: true }) });
    await row.getByRole('button', { name: '수정', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '모델 수정', exact: true });
    await editor.getByRole('checkbox', { name: '이 모델 활성화', exact: true }).check();
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_STT_LAYOUT.wav', mimeType: 'audio/wav', buffer: toneWav(6) });
  await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect(page.getByRole('button', { name: '전사하기 →', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
  const select = page.getByRole('combobox', { name: '전사 모델', exact: true });
  const confirmation = page.getByRole('region', { name: '전송 전 확인', exact: true });
  const acknowledge = confirmation.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true });
  const submit = confirmation.getByRole('button', { name: '전사 실행', exact: true });
  await expect(page.locator('.stt-results')).toContainText('전사 대기 중');
  await expect(page.locator('.saved-count')).toHaveText('전사 결과 0 / 1');
  await expect(select).toBeVisible(); expect(await select.locator('xpath=ancestor::details').count()).toBe(0);
  await expect(page.getByText('취소해도 이미 전송된 요청에는 요금이 발생할 수 있어요. 결과를 받지 못해 다시 시도하면 중복 과금될 수 있어요.', { exact: true })).toBeVisible();
  await expect(page.getByText(/저장 완료는 암호화 저장이 끝난 결과만 뜻해요/)).toHaveCount(0);
  for (const model of models) await expect(select.getByRole('option', { name: model.name, exact: true })).toHaveCount(1);
  await expect(confirmation.getByText('상세 보기', {exact:true})).toHaveCount(0);
  await expect(confirmation.getByText(/제공사 요금이 발생할 수 있어요/)).toBeVisible();
  const values = await Promise.all(models.map(model => select.locator('option').filter({ hasText: model.name }).getAttribute('value')));
  await select.selectOption(values[0]!); await expect(submit).toBeDisabled();
  await expect(confirmation.getByText(/선택한 음성과 전사 설정을 localhost:8000에 전송/)).toBeVisible();
  await acknowledge.check(); await expect(submit).toBeEnabled();
  await select.selectOption(values[1]!); await expect(acknowledge).not.toBeChecked(); await expect(submit).toBeDisabled();
  await expect(confirmation.getByText('http://localhost:8000/v1/audio/transcriptions', {exact:true})).toBeVisible();
  await confirmation.getByRole('button',{name:'전사 입력 수정',exact:true}).click();
  await confirmation.getByLabel('사용 언어 · 쉼표로 구분',{exact:true}).fill('ko');
  await confirmation.getByLabel('용어 · 한 줄에 하나',{exact:true}).fill('SYNTHETIC_TERM\nMoM');
  await confirmation.getByLabel('맥락',{exact:true}).fill('Synthetic meeting context');
  await expect(submit).toBeDisabled();
  await confirmation.getByRole('button',{name:'입력 설정 적용',exact:true}).click();
  await expect(confirmation.locator('.stt-transmission-facts')).toContainText('SYNTHETIC_TERM, MoM');
  await expect(confirmation.locator('.stt-transmission-facts')).toContainText('Synthetic meeting context');
  await page.reload(); await expect(page.getByText(/SYNTHETIC_TERM|Synthetic meeting context/)).toHaveCount(0); await unlock(page);
  await page.getByRole('button',{name:/^열기 /}).first().click();
  await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(1).click();
  await expect(confirmation.locator('.stt-transmission-facts')).toContainText('SYNTHETIC_TERM, MoM');
  await expect(confirmation.locator('.stt-transmission-facts')).toContainText('Synthetic meeting context');
  expect(calls).toEqual([]);
  mkdirSync(evidence, { recursive: true });
  const checkLayout = async (width: number) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
    const positions = await select.evaluate(element => {
      const model = element.getBoundingClientRect(), action = document.querySelector('.stt-execution-row > button')!.getBoundingClientRect();
      const setup = document.querySelector('.stt-setup')!.getBoundingClientRect(), results = document.querySelector('.stt-results')!.getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.chunk-actions button')].map(button => button.getBoundingClientRect().top);
      return { difference: Math.abs(model.right - action.right), checkLeft: document.querySelector('.stt-execution-row input')!.getBoundingClientRect().left, actionLeft: action.left,
        setup: { left: setup.left, right: setup.right, top: setup.top, bottom: setup.bottom, width: setup.width }, results: { left: results.left, top: results.top, width: results.width }, buttons };
    });
    expect(positions.difference).toBeLessThan(1);
    expect(positions.checkLeft).toBeLessThan(positions.actionLeft);
    expect(Math.max(...positions.buttons) - Math.min(...positions.buttons)).toBeLessThan(1);
    if (width > 960) {
      expect(positions.results.left).toBeGreaterThan(positions.setup.right);
      expect(Math.abs(positions.results.top - positions.setup.top)).toBeLessThan(1);
    } else {
      expect(positions.results.top).toBeGreaterThan(positions.setup.bottom);
      expect(Math.abs(positions.results.width - positions.setup.width)).toBeLessThan(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth)).toBe(true);
    await confirmation.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${width}-ko-confirmation.png`, fullPage: true });
  };
  await checkLayout(1440); await checkLayout(360); await page.setViewportSize({ width: 1440, height: 900 });
  try {
    await acknowledge.check(); await submit.click(); await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toContain('synthetic-stt-b');
    expect(calls[0]).toContain('SYNTHETIC_TERM, MoM'); expect(calls[0]).toContain('Synthetic meeting context');
    await expect(select).toBeDisabled(); await expect(acknowledge).toBeDisabled(); await expect(submit).toBeDisabled();
    await expect(confirmation.getByText(/선택한 음성과 전사 설정을 localhost:8000에 전송/)).toBeVisible();
    await expect(confirmation.getByText(/0개 청크/)).toHaveCount(0);
    await page.screenshot({ path: `${evidence}/1440-ko-requesting.png`, fullPage: true });
    release();
    await expect(page.locator('.saved-count')).toHaveText('전사 결과 1 / 1');
  } finally { release(); }
  await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(2).click();
  const notesSelect=page.getByRole('combobox',{name:'정리 모델',exact:true});
  await expect(notesSelect).toBeVisible(); expect(await notesSelect.locator('xpath=ancestor::details').count()).toBe(0);
  const notesId=await notesSelect.getByRole('option',{name:'SYNTHETIC_NOTES_MODEL',exact:true}).getAttribute('value');
  await notesSelect.selectOption(notesId!);
  const outputLanguage=page.getByRole('combobox',{name:'출력 언어',exact:true});
  await outputLanguage.selectOption('en'); await expect(outputLanguage).toHaveValue('en');
  await expect(page.locator('.minutes-setup')).not.toContainText('확인 불가');
  await page.getByRole('combobox',{name:'정리 분량',exact:true}).selectOption('__custom');
  const outputBudget=page.getByRole('spinbutton',{name:'직접 입력 · 토큰',exact:true});
  await outputBudget.fill('384'); await page.getByRole('button',{name:'분량 적용',exact:true}).click();
  await expect(outputBudget).toHaveValue('384');
  const generate=page.getByRole('button',{name:'정리 노트 생성',exact:true});
  await expect(generate).toBeDisabled();
  await expect(page.locator('.minutes-results')).toContainText('아직 생성한 정리 노트가 없어요');
  await page.locator('main').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:`${evidence}/1440-ko-notes-empty.png`,fullPage:true});
  await page.getByRole('checkbox',{name:'선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.',exact:true}).check();
  await expect(generate).toBeEnabled(); await generate.click();
  await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_NOTES_RESULT');
  await expect(page.locator('.minutes-output')).toBeInViewport();
  expect(calls).toHaveLength(2); expect(calls[1]).toContain('SYNTHETIC_LAYOUT_RESPONSE'); expect(calls[1]).toContain('synthetic-notes'); expect(JSON.parse(calls[1]).max_tokens).toBe(384); expect(JSON.parse(calls[1]).messages.map((item:{content:string})=>item.content).join('')).toContain('"language":"en"');
  for(const width of [1440,360]) {
    await page.setViewportSize({width,height:width===360?800:900});
    await page.locator('main').evaluate(element=>{element.scrollTop=0;});
    await page.evaluate(()=>window.scrollTo(0,0));
    const layout=await page.locator('.minutes-setup').evaluate(element=>{const left=element.getBoundingClientRect(),right=document.querySelector('.minutes-results')!.getBoundingClientRect();return {left:{top:left.top,bottom:left.bottom,right:left.right,width:left.width},right:{top:right.top,left:right.left,width:right.width},overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth||document.querySelector('main')!.scrollWidth>document.querySelector('main')!.clientWidth};});
    expect(layout.overflow).toBe(false);
    if(width>960){expect(layout.right.left).toBeGreaterThan(layout.left.right);expect(Math.abs(layout.left.top-layout.right.top)).toBeLessThan(1);}else{expect(layout.right.top).toBeGreaterThan(layout.left.bottom);expect(Math.abs(layout.right.width-layout.left.width)).toBeLessThan(1);}
    await page.screenshot({path:`${evidence}/${width}-ko-notes-result.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
});
