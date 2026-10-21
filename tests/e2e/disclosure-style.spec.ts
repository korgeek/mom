import {expect,test,type Locator} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createModelPreset,exportModelProfiles} from '../../src/react-app/providers/model-profiles';
import {clickAppAction,createVault,toneWav} from './helpers';

const disclosure='details:not(.api-key-actions, .json-response-node)';
for(const width of [1440,360])test(`shared explanatory disclosures at ${width}px`,async({page})=>{
 const evidence='docs/superpowers/evidence/2026-10-19-shared-disclosures',errors:string[]=[],metrics:unknown[]=[];
 const t=(ko:string,en:string)=>width===1440?ko:en;
 page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height:width===1440?900:800});
 await page.route('https://**/*',route=>route.abort());
 await page.route('http://localhost:8000/**',route=>route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, OPTIONS'},body:JSON.stringify({text:'SYNTHETIC_DISCLOSURE_TRANSCRIPT',usage:{seconds:1}})}));
 await createVault(page);await clickAppAction(page,'설정');
 if(width===360){await page.getByRole('tab',{name:'화면 · 언어',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('button',{name:'Dark',exact:true}).click();}
 await page.getByRole('tab',{name:t('보안 · 잠금','Security & lock'),exact:true}).click();
 const reference=page.locator('xpath=//*[@id="settings-panel"]/div/div[1]/section[2]/details'),referenceTitle=reference.locator(':scope > summary'),body=reference.locator('p').first();
 await referenceTitle.focus();await page.keyboard.press('Enter');await expect(body).toBeVisible();
 const referenceStyle=await referenceTitle.evaluate(element=>{const s=getComputedStyle(element);return {size:s.fontSize,weight:s.fontWeight};});
 expect(referenceStyle).toEqual({size:'14px',weight:'600'});
 await page.keyboard.press('Space');await expect(body).toBeHidden();await page.keyboard.press('Enter');await expect(body).toBeVisible();
 const audit=async(root:Locator,state:string)=>{
  const summaries=root.locator(`${disclosure} > summary:visible`);await expect(summaries.first()).toBeVisible();
  const values=await summaries.evaluateAll(items=>items.map(element=>{const s=getComputedStyle(element);return {title:element.textContent?.trim(),size:s.fontSize,weight:s.fontWeight,height:element.getBoundingClientRect().height};}));
  expect(values.length).toBeGreaterThan(0);metrics.push({state,values});
  for(const value of values){expect(value.size,value.title).toBe(referenceStyle.size);expect(value.weight,value.title).toBe(referenceStyle.weight);if(width===360)expect(value.height,value.title).toBeGreaterThanOrEqual(44);}
 };
 await audit(page.locator('#settings-panel'),'security');
 await expect(body).toHaveCSS('font-size','12px');
 mkdirSync(evidence,{recursive:true});await referenceTitle.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/${width}-security.png`,fullPage:true});
 await page.getByRole('tab',{name:t('모델 관리','Models'),exact:true}).click();
 const manager=page.getByRole('region',{name:t('모델 관리','Models'),exact:true});await manager.getByRole('button',{name:t('새 모델','New model'),exact:true}).click();
 const editor=page.getByRole('dialog',{name:t('새 모델 등록','New model registration'),exact:true});
 await editor.getByText(t('고급 설정','Advanced settings'),{exact:true}).click();await audit(editor,'model-editor');
 await page.screenshot({path:`${evidence}/${width}-model-editor.png`,fullPage:true});await editor.getByRole('button',{name:t('닫기','Close'),exact:true}).click();
 const keys=page.getByRole('region',{name:t('API 키 관리','API key management'),exact:true});await keys.getByRole('button',{name:t('API 키 추가','Add API key'),exact:true}).click();
 const keyEditor=page.getByRole('dialog',{name:t('API 키 추가','Add API key'),exact:true});await keyEditor.getByText(t('보관 옵션','Storage options'),{exact:true}).click();await audit(keyEditor,'key-storage-options');await keyEditor.getByRole('button',{name:t('닫기','Close'),exact:true}).click();
 await manager.getByRole('button',{name:t('JSON 가져오기','Import JSON'),exact:true}).click();const importer=page.getByRole('region',{name:t('모델 가져오기','Import models'),exact:true});
 await importer.getByLabel(t('모델 JSON','Model JSON'),{exact:true}).fill(exportModelProfiles([{...createModelPreset('compatible-stt'),name:'SYNTHETIC_DISCLOSURE_STT'}]));await importer.getByRole('button',{name:t('미리보기','Preview'),exact:true}).click();await importer.getByRole('button',{name:t('가져오기','Import'),exact:true}).click();
 await manager.getByRole('button',{name:t('수정','Edit'),exact:true}).click();const savedEditor=page.getByRole('dialog',{name:t('모델 수정','Edit model'),exact:true});await savedEditor.getByRole('checkbox',{name:t('이 모델 활성화','Enable this model'),exact:true}).check();await savedEditor.getByRole('button',{name:t('저장','Save'),exact:true}).click();await expect(savedEditor).toHaveCount(0);
 await page.getByRole('button',{name:'Minutes of Meeting',exact:true}).click();await page.getByRole('main').getByRole('button',{name:t('+ 새 음성 메모','+ New voice memo'),exact:true}).click();
 await audit(page.getByRole('main'),'audio-preparation');
 await page.getByRole('tab',{name:t('파일 업로드','File upload'),exact:true}).click();const format=page.getByText(t('지원 형식 보기','Supported formats'),{exact:true});await format.click();await page.screenshot({path:`${evidence}/${width}-preparation.png`,fullPage:true});
 await page.getByLabel(t('음성 파일 선택','Audio file'),{exact:true}).setInputFiles({name:'SYNTHETIC_DISCLOSURE.wav',mimeType:'audio/wav',buffer:toneWav(1)});
 await page.getByRole('button',{name:t('전사 준비','Prepare transcription'),exact:true}).click();await page.getByRole('button',{name:t('전사하기 →','Transcribe →'),exact:true}).click();
 const model=page.getByRole('combobox',{name:t('전사 모델','Transcription model'),exact:true});await model.selectOption((await model.getByRole('option',{name:'SYNTHETIC_DISCLOSURE_STT',exact:true}).getAttribute('value'))!);
 await audit(page.getByRole('main'),'transmission');await page.getByText(t('전송 상세 보기','Transmission details'),{exact:true}).click();
 await page.getByRole('checkbox',{name:t('위 내용을 확인했어요',"I've reviewed the above"),exact:true}).check();await page.getByRole('button',{name:t('전사 실행','Transcribe'),exact:true}).click();await expect(page.locator('.saved-count')).toHaveText(t('전사 결과 1 / 1','Transcript results 1 / 1'));
 await audit(page.getByRole('main'),'transcription-history');
 await page.getByRole('button',{name:t('전사 내용 확인','View transcript'),exact:true}).click();const chunk=page.getByRole('dialog');await chunk.getByText(t('출처 · 원본 응답','Provenance · original response'),{exact:true}).click();await audit(chunk,'transcript-provenance');await expect(chunk.locator('.json-response-node > summary').first()).toHaveCSS('font-size','13px');await page.screenshot({path:`${evidence}/${width}-transcript.png`,fullPage:true});await chunk.getByRole('button',{name:t('닫기','Close'),exact:true}).click();
 await page.getByRole('button',{name:t('명세·요청 이력 보기 →','View statement & request history →'),exact:true}).click();const usage=page.getByRole('dialog',{name:t('사용량 명세 · 요청 이력','Usage statement · request history'),exact:true});
 await usage.locator('.usage-stage-details > summary').first().click();await usage.locator('.usage-attempt > summary').first().click();await audit(usage,'usage-and-request-details');await page.screenshot({path:`${evidence}/${width}-usage.png`,fullPage:true});await usage.getByRole('button',{name:t('닫기','Close'),exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);writeFileSync(`${evidence}/${width}-metrics.json`,JSON.stringify(metrics,null,2));
});
