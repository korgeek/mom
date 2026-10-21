import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {createModelPreset,exportModelProfiles} from '../../src/react-app/providers/model-profiles';
import { clickAppAction,createVault,toneWav,unlock} from './helpers';

test('history and explicit chunk reset preserve usage and original audio without automatic inference',async({page})=>{
 const evidence='docs/superpowers/evidence/2026-10-17-history-preparation-reset',calls:{url:string;body:string}[]=[],errors:string[]=[];
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
 const importer=page.getByRole('region',{name:'모델 가져오기',exact:true});await importer.getByLabel('모델 JSON',{exact:true}).fill(exportModelProfiles(models));await importer.getByRole('button',{name:'미리보기',exact:true}).click();await importer.getByRole('button',{name:'가져오기',exact:true}).click();
 for(const model of models){const row=manager.getByRole('listitem').filter({has:page.getByText(model.name,{exact:true})});await row.getByRole('button',{name:'수정',exact:true}).click();const editor=page.getByRole('dialog',{name:'모델 수정',exact:true});await editor.getByRole('checkbox',{name:'이 모델 활성화',exact:true}).check();await editor.getByRole('button',{name:'저장',exact:true}).click();await expect(editor).toHaveCount(0);}
 // Existing local preparation and intercepted STT are only setup for this Notes check.
 await page.getByRole('button',{name:'Minutes of Meeting',exact:true}).click();await page.getByRole('main').getByRole('button',{name:'+ 새 음성 메모',exact:true}).click();
 await page.getByLabel('메모 제목',{exact:true}).fill('SYNTHETIC_RESET_MEMO');await page.getByLabel('음성 파일 선택',{exact:true}).setInputFiles({name:'SYNTHETIC_NOTES_OPTIONS.wav',mimeType:'audio/wav',buffer:toneWav(1)});await page.getByRole('button',{name:'전사 준비',exact:true}).click();await page.getByRole('button',{name:'전사하기 →',exact:true}).click();
 const stt=page.getByRole('combobox',{name:'전사 모델',exact:true});await stt.selectOption((await stt.getByRole('option',{name:'SYNTHETIC_SETUP_STT',exact:true}).getAttribute('value'))!);await page.getByRole('checkbox',{name:'위 내용을 확인했어요',exact:true}).check();await page.getByRole('button',{name:'전사 실행',exact:true}).click();await expect(page.locator('.saved-count')).toHaveText('전사 결과 1 / 1');
 await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(2).click();
 const model=page.getByRole('combobox',{name:'정리 모델',exact:true});await model.selectOption((await model.getByRole('option',{name:'SYNTHETIC_NOTES_OPTIONS',exact:true}).getAttribute('value'))!);
 const ack=page.getByRole('checkbox',{name:'선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.',exact:true});
 await ack.check();await page.getByRole('button',{name:'정리 노트 생성',exact:true}).click();await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_INSTRUCTIONS_ONLY_RESULT');expect(calls).toHaveLength(2);
 const historyMenu=page.getByRole('complementary').getByRole('button',{name:'처리 기록',exact:true});await historyMenu.click();
 await page.getByRole('button',{name:'처리 기록 SYNTHETIC_RESET_MEMO',exact:true}).click();
 const records=page.getByRole('region',{name:'실행별 처리 기록',exact:true});await expect(records.locator('details')).toHaveCount(2);
 await page.getByRole('group',{name:'처리 종류',exact:true}).getByRole('button',{name:'STT',exact:true}).click();await expect(records.locator('details')).toHaveCount(1);
 await page.getByRole('group',{name:'처리 종류',exact:true}).getByRole('button',{name:'LLM',exact:true}).click();await expect(records.locator('details')).toHaveCount(1);
 await page.getByRole('button',{name:'음성 메모 열기',exact:true}).click();await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(1).click();
 const pencil=page.getByRole('button',{name:'청크·압축 편집',exact:true});await pencil.click();
 const settings=page.locator('details.processing-settings');await expect(settings).toHaveAttribute('open','');await expect(settings.locator('summary')).toBeFocused();await expect(settings.locator('summary')).toBeInViewport();
 const changeLength=async()=>{await page.getByRole('group',{name:'청크 길이',exact:true}).getByRole('button',{name:'10 분',exact:true}).click();await page.getByRole('button',{name:'변경 적용',exact:true}).click();};
 await changeLength();const dialog=page.getByRole('dialog',{name:'청크와 결과를 초기화할까요?',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText('이 작업은 되돌릴 수 없어요.');mkdirSync(evidence,{recursive:true});await page.screenshot({path:`${evidence}/1440-ko-reset-confirmation.png`,fullPage:true});
 await dialog.getByRole('button',{name:'취소',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(2).click();await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_INSTRUCTIONS_ONLY_RESULT');
 await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(1).click();await pencil.click();await changeLength();await dialog.getByRole('button',{name:'초기화하고 다시 준비',exact:true}).click();
 await expect(page.getByRole('status',{name:'',exact:true}).filter({hasText:'로컬 음성 준비 완료'})).toHaveCount(1);expect(calls).toHaveLength(2);
 await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(1).click();await expect(page.locator('.saved-count')).toHaveText('전사 결과 0 / 1');await expect(page.locator('.chunk-actions button').first()).toBeEnabled();
 await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(2).click();await expect(page.locator('.minutes-results')).toContainText('아직 생성한 정리 노트가 없어요');
 await historyMenu.click();await page.getByRole('button',{name:'처리 기록 SYNTHETIC_RESET_MEMO',exact:true}).click();await expect(records.locator('details')).toHaveCount(2);await expect(records).toContainText('초기화 이전');await expect(records).toContainText('결과 삭제됨');
 await page.locator('main').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:`${evidence}/1440-ko-history-detail.png`,fullPage:true});
 await page.setViewportSize({width:360,height:800});await expect(records).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth&&document.querySelector('main')!.scrollWidth<=document.querySelector('main')!.clientWidth)).toBe(true);await page.screenshot({path:`${evidence}/360-ko-history-detail.png`,fullPage:true});
 await page.reload();await unlock(page);await page.getByRole('button',{name:/^열기 SYNTHETIC_RESET_MEMO/}).click();await page.getByRole('navigation',{name:'음성 메모 단계'}).getByRole('button').nth(1).click();await expect(page.locator('.saved-count')).toHaveText('전사 결과 0 / 1');expect(calls).toHaveLength(2);
 await page.setViewportSize({width:1440,height:900});for(let i=0;i<15;i++)await page.getByRole('complementary').getByRole('button',{name:'+ 새 음성 메모',exact:true}).click();
 await page.getByRole('button',{name:'Minutes of Meeting',exact:true}).click();await expect(page.locator('.meeting-row')).toHaveCount(15);await expect(page.locator('.side-all')).toHaveText('모든 음성 메모 16개');expect(await page.locator('.side-all').evaluate(el=>el.tagName)).toBe('DIV');await page.screenshot({path:`${evidence}/1440-ko-home-page-1.png`,fullPage:true});
 await page.getByRole('button',{name:'다음 페이지',exact:true}).click();await expect(page.locator('.meeting-row')).toHaveCount(1);await expect(page.locator('.meeting-row')).toContainText('SYNTHETIC_RESET_MEMO');await page.getByRole('button',{name:'처리 기록 SYNTHETIC_RESET_MEMO',exact:true}).click();await expect(records.locator('details')).toHaveCount(2);
 await page.getByRole('button',{name:'처리 기록 목록으로',exact:true}).click();await expect(page.locator('.history-memo')).toHaveCount(1);await page.screenshot({path:`${evidence}/1440-ko-history-list.png`,fullPage:true});expect(errors).toEqual([]);expect(calls).toHaveLength(2);
});
