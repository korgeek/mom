import { test,expect } from '@playwright/test';
import { clickAppAction, prepareForTranscription,createVault,fixtureTransport,enterFixtureKeys,toneWav,passphrase,fixtureText,unlock } from './helpers';
test('provider failure exposes safe status and never retries automatically after reload',async({page})=>{
 const calls=await fixtureTransport(page,{sttFailure:true});await createVault(page);await enterFixtureKeys(page);
 await page.getByRole('main').getByRole('button',{name:/새 음성 메모/}).click();
 await page.locator('input[type=file]').setInputFiles({name:'synthetic-failure.wav',mimeType:'audio/wav',buffer:toneWav()});
 await prepareForTranscription(page);
 await page.getByLabel('전사 모델').selectOption('gpt-transcribe');
 await page.getByRole('checkbox',{name:'위 내용을 확인했어요'}).check();
 await page.getByRole('button',{name:'전사 실행'}).click();
 await expect(page.getByText(/실패|요청 제한/).first()).toBeVisible();
 expect(await page.locator('body').innerText()).not.toContain('SYNTHETIC_PRIVATE_UPSTREAM_DETAIL');
 expect(calls.filter(call=>call.url.endsWith('/audio/transcriptions'))).toHaveLength(1);
 await page.reload();await page.getByLabel('암호',{exact:true}).fill(passphrase);await page.getByRole('button',{name:'잠금 해제',exact:true}).click();
 await expect(page.getByRole('heading',{name:'음성 메모'})).toBeVisible();
 expect(calls.filter(call=>call.url.endsWith('/audio/transcriptions'))).toHaveLength(1);
});
test('matching original reselection after native reload retains completed results and rejects changed bytes',async({page})=>{
 const calls=await fixtureTransport(page);await createVault(page);await enterFixtureKeys(page);
 await page.getByRole('main').getByRole('button',{name:/새 음성 메모/}).click();
 const original=toneWav();
 await page.locator('input[type=file]').setInputFiles({name:'KEYLESS_MATCHED_SOURCE.wav',mimeType:'audio/wav',buffer:original});
 await prepareForTranscription(page);
 await page.getByLabel('전사 모델').selectOption('gpt-transcribe');
 await page.getByRole('checkbox',{name:'위 내용을 확인했어요'}).check();
 await page.getByRole('button',{name:'전사 실행'}).click();
 await expect(page.getByText(fixtureText).first()).toBeVisible();
 await clickAppAction(page, '지금 잠그기');await page.reload();await unlock(page);
 await page.getByRole('button',{name:/^열기 /}).click();
 await page.getByRole('button',{name:/음성 준비$/}).first().click();
 const changed=Buffer.from(original);changed[100]^=1;
 await page.locator('input[type=file]').setInputFiles({name:'KEYLESS_MATCHED_SOURCE.wav',mimeType:'audio/wav',buffer:changed});
 await expect(page.getByRole('alert')).toContainText('암호화된 원본과 일치하지');
 await page.locator('input[type=file]').setInputFiles({name:'KEYLESS_MATCHED_SOURCE.wav',mimeType:'audio/wav',buffer:original});
 await expect(page.getByRole('status').filter({ hasText: '원본 파일 일치' })).toContainText('원본 파일 일치');
 await expect(page.locator('audio')).toHaveAttribute('src',/^blob:/);
 await page.getByRole('button',{name:/전사$/}).first().click();
 await expect(page.getByText(fixtureText).first()).toBeVisible();
 expect(calls.filter(call=>call.url.endsWith('/audio/transcriptions'))).toHaveLength(1);
});
test('native encrypted promotion failure blocks inference and retains source through lock recovery',async({page})=>{
 const calls=await fixtureTransport(page);await createVault(page);await enterFixtureKeys(page);
 await page.getByRole('main').getByRole('button',{name:/새 음성 메모/}).click();
 await page.locator('input[type=file]').setInputFiles({name:'synthetic-storage-recovery.wav',mimeType:'audio/wav',buffer:toneWav()});
 await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('synthetic-storage-recovery.wav')).toBeVisible();
  await page.evaluate(()=>{
  const original=IDBDatabase.prototype.transaction;let aborted=false;
  IDBDatabase.prototype.transaction=function(storeNames,mode,options){
   const transaction=original.call(this,storeNames,mode,options);
   if(!aborted&&mode==='readwrite'&&transaction.objectStoreNames.contains('records')&&transaction.objectStoreNames.contains('header')){aborted=true;queueMicrotask(()=>transaction.abort());}
   return transaction;
  };
 });
 await page.getByRole('button',{name:'전사 준비',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();
 expect(calls.filter(call=>call.url.endsWith('/audio/transcriptions'))).toHaveLength(0);
 await clickAppAction(page, '지금 잠그기');
 await expect(page.getByRole('heading',{name:'암호로 잠금 해제'})).toBeVisible();
 await page.getByLabel('암호',{exact:true}).fill(passphrase);await page.getByRole('button',{name:'잠금 해제',exact:true}).click();
 await expect(page.getByRole('heading',{name:'음성 메모'})).toBeVisible();
 await page.getByRole('button',{name:/^열기 /}).click();
 await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('synthetic-storage-recovery.wav')).toBeVisible();
 expect(calls.filter(call=>call.url.endsWith('/audio/transcriptions'))).toHaveLength(0);
});
