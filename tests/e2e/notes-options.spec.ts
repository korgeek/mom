import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {createModelPreset,exportModelProfiles} from '../../src/react-app/providers/model-profiles';
import { clickAppAction,createVault,toneWav,unlock} from './helpers';

test('notes length presets and instructions-only output explain readiness and dispatch the saved choices',async({page})=>{
 const evidence='docs/superpowers/evidence/2026-10-19-notes-output-limits',calls:{url:string;body:string}[]=[],errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://**/*',route=>route.request().url()==='https://openrouter.ai/api/v1/models'?route.fulfill({contentType:'application/json',body:'{"data":[]}'}):route.abort());
 await page.route('http://localhost:8000/**',async route=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  calls.push({url:route.request().url(),body:route.request().postData()??''});
  await route.fulfill({headers,contentType:'application/json',body:route.request().url().endsWith('/chat/completions')?JSON.stringify({choices:[{message:{content:'SYNTHETIC_INSTRUCTIONS_ONLY_RESULT'},finish_reason:'stop'}]}):'{"text":"SYNTHETIC_SELECTED_SPEECH"}'});
 });
 await createVault(page);await clickAppAction(page, '설정');
 const manager=page.getByRole('region',{name:'모델 관리',exact:true});await manager.getByRole('button',{name:'JSON 가져오기',exact:true}).click();
 const models=[{...createModelPreset('compatible-stt'),name:'SYNTHETIC_SETUP_STT'},{...createModelPreset('compatible-text'),name:'SYNTHETIC_NOTES_OPTIONS',llm:{tokenField:'max_tokens' as const,contextTokens:64000,maxTokens:16384}}];
 const preset=createModelPreset('openai-text'),legacy={...preset,name:'SYNTHETIC_LEGACY_LUNA',llm:{...preset.llm,maxTokens:4096}};
 const importer=page.getByRole('region',{name:'모델 가져오기',exact:true});await importer.getByLabel('모델 JSON',{exact:true}).fill(exportModelProfiles([...models,legacy]));await importer.getByRole('button',{name:'미리보기',exact:true}).click();await importer.getByRole('button',{name:'가져오기',exact:true}).click();
 const legacyRow=manager.getByRole('listitem').filter({has:page.getByText(legacy.name,{exact:true})});await legacyRow.getByRole('button',{name:'수정',exact:true}).click();
 const legacyEditor=page.getByRole('dialog',{name:'모델 수정',exact:true});await legacyEditor.getByText('고급 설정',{exact:true}).click();
 const ceiling=legacyEditor.getByRole('spinbutton',{name:'모델 최대 출력 토큰',exact:true});await expect(ceiling).toHaveValue('4096');
 await legacyEditor.getByRole('button',{name:'예시 모델 출력 한도 적용',exact:true}).click();await expect(ceiling).toHaveValue('128000');
 mkdirSync(evidence,{recursive:true});await ceiling.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/1440-ko-model-ceiling.png`,fullPage:true});
 await page.setViewportSize({width:360,height:800});await ceiling.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/360-ko-model-ceiling.png`,fullPage:true});await page.setViewportSize({width:1440,height:900});
 await legacyEditor.getByRole('button',{name:'저장',exact:true}).click();await expect(legacyEditor).toHaveCount(0);expect(calls).toHaveLength(0);
 for(const model of models){const row=manager.getByRole('listitem').filter({has:page.getByText(model.name,{exact:true})});await row.getByRole('button',{name:'수정',exact:true}).click();const editor=page.getByRole('dialog',{name:'모델 수정',exact:true});await editor.getByRole('checkbox',{name:'이 모델 활성화',exact:true}).check();await editor.getByRole('button',{name:'저장',exact:true}).click();await expect(editor).toHaveCount(0);}
 // Existing local preparation and intercepted STT are only setup for this Notes check.
 await page.getByRole('button',{name:'Minutes of Meeting',exact:true}).click();await page.getByRole('main').getByRole('button',{name:'+ 새 음성 메모',exact:true}).click();
 await page.getByLabel('음성 파일 선택',{exact:true}).setInputFiles({name:'SYNTHETIC_NOTES_OPTIONS.wav',mimeType:'audio/wav',buffer:toneWav(1)});await page.getByRole('button',{name:'전사 준비',exact:true}).click();await page.getByRole('button',{name:'전사하기 →',exact:true}).click();
 const stt=page.getByRole('combobox',{name:'전사 모델',exact:true});await stt.selectOption((await stt.getByRole('option',{name:'SYNTHETIC_SETUP_STT',exact:true}).getAttribute('value'))!);await page.getByRole('checkbox',{name:'위 내용을 확인했어요',exact:true}).check();await page.getByRole('button',{name:'전사 실행',exact:true}).click();await expect(page.locator('.saved-count')).toHaveText('전사 결과 1 / 1');
 await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(2).click();
 const model=page.getByRole('combobox',{name:'정리 모델',exact:true});await model.selectOption((await model.getByRole('option',{name:'SYNTHETIC_NOTES_OPTIONS',exact:true}).getAttribute('value'))!);
 const length=page.getByRole('combobox',{name:'정리 분량',exact:true}),generate=page.getByRole('button',{name:'정리 노트 생성',exact:true}),guidance=page.getByRole('status',{name:'생성 가능 여부',exact:true});
 const ack=page.getByRole('checkbox',{name:'선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.',exact:true});
 await expect(length).toHaveValue('4096');await expect(guidance).toHaveText('전송 확인에 체크하면 생성할 수 있어요.');await ack.check();await expect(generate).toBeEnabled();
 for(const value of ['8192','16384']){await length.selectOption(value);await expect(length).toHaveValue(value);await expect(ack).not.toBeChecked();}
 await length.selectOption('__custom');const custom=page.getByRole('spinbutton',{name:'직접 입력 · 토큰',exact:true});await custom.fill('999999');await expect(page.getByRole('button',{name:'분량 적용',exact:true})).toBeDisabled();await expect(generate).toBeDisabled();
 await custom.fill('8192');await page.getByRole('button',{name:'분량 적용',exact:true}).click();await expect(length).toHaveValue('8192');
 await page.getByRole('button',{name:'추가 지침만 사용',exact:true}).click();await expect(guidance).toHaveText('추가 지침을 입력하거나 포함할 항목을 하나 이상 선택하세요.');await expect(generate).toBeDisabled();
 const instructions=page.getByRole('textbox',{name:'추가 작성 지침',exact:true});await instructions.fill('SYNTHETIC_INSTRUCTIONS: Write a single paragraph without headings.');
 await expect(guidance).toHaveText('전송 확인에 체크하면 생성할 수 있어요.');expect(await page.locator('.section-order input:checked').count()).toBe(0);
 mkdirSync(evidence,{recursive:true});await page.locator('main').evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:`${evidence}/1440-ko-settings.png`,fullPage:true});
 await length.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/1440-ko-budget.png`,fullPage:true});
 await page.setViewportSize({width:360,height:800});await length.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/360-ko-budget.png`,fullPage:true});await page.setViewportSize({width:1440,height:900});
 await ack.check();await expect(generate).toBeEnabled();await generate.click();await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_INSTRUCTIONS_ONLY_RESULT');
 expect(calls).toHaveLength(2);const request=JSON.parse(calls[1].body),input=JSON.parse(request.messages[1].content);expect(request.max_tokens).toBe(8192);expect(input.output).toMatchObject({sections:[],instructions:'SYNTHETIC_INSTRUCTIONS: Write a single paragraph without headings.'});expect(JSON.stringify(input)).toContain('SYNTHETIC_SELECTED_SPEECH');expect(request).not.toHaveProperty('input_audio');
 await page.setViewportSize({width:360,height:800});await page.locator('main').evaluate(element=>{element.scrollTop=0;});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth&&document.querySelector('main')!.scrollWidth<=document.querySelector('main')!.clientWidth)).toBe(true);await page.screenshot({path:`${evidence}/360-ko-result.png`,fullPage:true});
 await page.reload();await unlock(page);await page.getByRole('button',{name:/^열기 /}).first().click();await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(2).click();await page.getByRole('button',{name:'정리 설정 펼치기',exact:true}).click();await expect(length).toHaveValue('8192');await expect(instructions).toHaveValue('SYNTHETIC_INSTRUCTIONS: Write a single paragraph without headings.');await expect(page.getByRole('button',{name:'추가 지침만 사용',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_INSTRUCTIONS_ONLY_RESULT');expect(calls).toHaveLength(2);await clickAppAction(page,'설정');await legacyRow.getByRole('button',{name:'수정',exact:true}).click();await legacyEditor.getByText('고급 설정',{exact:true}).click();await expect(ceiling).toHaveValue('128000');await expect(legacyEditor.getByRole('textbox',{name:'이름',exact:true})).toHaveValue(legacy.name);expect(calls).toHaveLength(2);expect(errors).toEqual([]);
});
