import { test,expect, type Page } from '@playwright/test';
import { createModelPreset, exportModelProfiles } from '../../src/react-app/providers/model-profiles';
import { clickAppAction, prepareForTranscription,createVault,fixtureTransport,passphrase,toneWav,fixtureText } from './helpers';

async function unlockVault(page: Page) {
 await page.getByLabel('암호', { exact: true }).fill(passphrase);
 await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
}

test('creates a real vault and removes sensitive DOM before locked reload',async({page})=>{
 await fixtureTransport(page);await createVault(page);
 await page.getByRole('main').getByRole('button',{name:/새 음성 메모/}).click();
 await page.getByLabel('메모 제목').fill('KEYLESS_BROWSER_PRIVATE_TITLE');
 await page.getByLabel('메모 제목').blur();
 await clickAppAction(page, '화면 잠금');
 await expect(page.getByRole('heading',{name:'화면이 잠겼어요'})).toBeVisible();
 await expect(page.getByLabel('암호',{exact:true})).toBeEnabled();
 expect(await page.locator('body').innerText()).not.toContain('KEYLESS_BROWSER_PRIVATE_TITLE');
 expect(await page.locator('input,textarea').evaluateAll(nodes=>nodes.map(node=>(node as HTMLInputElement).value).join(' '))).not.toContain('KEYLESS_BROWSER_PRIVATE_TITLE');
 await page.reload();await unlockVault(page);await expect(page.getByText('KEYLESS_BROWSER_PRIVATE_TITLE').first()).toBeVisible();
});
test('native Web Locks permit one unlocked tab and release ownership after lock',async({page,context})=>{
 await fixtureTransport(page);await createVault(page);
 await clickAppAction(page, '설정');
 await page.getByRole('tab',{name:'보안 · 잠금'}).click();
 await expect(page.getByRole('button',{name:'표준 · 작업 이어가기',exact:true})).toHaveAttribute('aria-pressed','true');
 const second=await context.newPage();await fixtureTransport(second);await second.goto('/');
 await second.getByLabel('암호',{exact:true}).fill(passphrase);await second.getByRole('button',{name:'잠금 해제',exact:true}).click();
 await expect(second.getByRole('alert')).toBeVisible();await expect(second.getByRole('heading',{name:'암호로 잠금 해제'})).toBeVisible();
 await page.bringToFront();await page.locator('.sidebar').getByRole('button',{name:'화면 잠금',exact:true}).click();
 await expect(page.getByRole('heading',{name:'화면이 잠겼어요'})).toBeVisible();
 await expect(page.getByLabel('암호',{exact:true})).toBeEnabled();
 await second.bringToFront();await unlockVault(second);
 await expect(second.getByRole('heading',{name:'설정',exact:true})).toBeVisible();await second.close();
});
test('locking an in-flight request fences a late response and never replays it after reload',async({page})=>{
 let release!:()=>void;
 const delayed=new Promise<void>(resolve=>{release=resolve;});
 const calls:string[]=[];
 await page.route('https://**/*',route=>route.abort());
 await page.route('http://localhost:8000/**',async route=>{
  calls.push(route.request().url());await delayed;
  try {await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({text:fixtureText})});}
  catch { /* The explicit strict policy cancels this test-only request. */ }
 });
 await createVault(page);await clickAppAction(page,'설정');
 const manager=page.getByRole('region',{name:'모델 관리',exact:true});
 await manager.getByRole('button',{name:'JSON 가져오기',exact:true}).click();
 const model={...createModelPreset('compatible-stt'),name:'SYNTHETIC_LATE_LOCK_STT',modelId:'synthetic-late-lock-stt'};
 const importer=page.getByRole('region',{name:'모델 가져오기',exact:true});
 await importer.getByLabel('모델 JSON',{exact:true}).fill(exportModelProfiles([model]));
 await importer.getByRole('button',{name:'미리보기',exact:true}).click();
 await importer.getByRole('button',{name:'가져오기',exact:true}).click();
 await manager.getByRole('listitem').filter({has:page.getByText(model.name,{exact:true})}).getByRole('button',{name:'수정',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'모델 수정',exact:true});
 await editor.getByRole('checkbox',{name:'이 모델 활성화',exact:true}).check();
 await editor.getByRole('button',{name:'저장',exact:true}).click();
 await expect(editor).toHaveCount(0);
 await page.getByRole('tab',{name:'보안 · 잠금',exact:true}).click();
 await page.getByRole('button',{name:'엄격 · 잠글 때 작업 중지',exact:true}).click();
 await page.getByRole('button',{name:'Minutes of Meeting',exact:true}).click();
 await page.getByRole('main').getByRole('button',{name:/새 음성 메모/}).click();
 await page.locator('input[type=file]').setInputFiles({name:'KEYLESS_INFLIGHT_SOURCE.wav',mimeType:'audio/wav',buffer:toneWav()});
 await prepareForTranscription(page);
 await page.getByRole('combobox',{name:'전사 모델',exact:true}).selectOption({label:model.name});
 await page.getByRole('checkbox',{name:'위 내용을 확인했어요'}).check();
 await page.getByRole('button',{name:'전사 실행'}).click();
 await expect.poll(()=>calls.filter(url=>url.endsWith('/audio/transcriptions')).length).toBe(1);
 await clickAppAction(page, '화면 잠금');
 await expect(page.getByRole('heading',{name:'화면이 잠겼어요'})).toBeVisible();
 await expect(page.getByLabel('암호',{exact:true})).toBeEnabled();
 release();
 expect(await page.locator('body').innerText()).not.toContain(fixtureText);
 expect(await page.locator('body').innerText()).not.toContain('KEYLESS_INFLIGHT_SOURCE.wav');
 await page.reload();await unlockVault(page);
 await expect(page.locator('.saved-count')).toHaveText('전사 결과 0 / 1');
 expect(calls.filter(url=>url.endsWith('/audio/transcriptions'))).toHaveLength(1);
 expect(await page.locator('body').innerText()).not.toContain(fixtureText);
});
