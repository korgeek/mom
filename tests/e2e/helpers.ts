import { expect, type Page } from '@playwright/test';
export const passphrase='synthetic river cedar calm moon';
export const fixtureText='TEST_ONLY_PROVIDER_RESULT: 다음 주 테스트 결과를 공유합니다.';
export const fixtureMarkdown='# TEST_ONLY_PROVIDER_RESULT\n\n## 요약\n다음 주 테스트 결과를 공유합니다.\n';
export const routerModel={id:'fixture/text-model',name:'Keyless test model',context_length:32000,top_provider:{max_completion_tokens:4096},architecture:{input_modalities:['text'],output_modalities:['text'],tokenizer:'FixtureBPE'},supported_parameters:['max_tokens'],pricing:{prompt:'0.000001',completion:'0.000002',request:'0'}};
export const routerEndpoint={tag:'FixtureProvider/explicit-region',provider_name:'FixtureProvider',context_length:32000,max_prompt_tokens:28000,max_completion_tokens:4096,supported_parameters:['max_tokens'],pricing:routerModel.pricing};
// The same action lives in the desktop sidebar or mobile navigation disclosure.
export async function clickAppAction(page: Page, name: string) {
 const sidebar=page.locator('.sidebar');
 const action=sidebar.getByRole('button',{name,exact:true}).filter({visible:true});
 if(await action.isVisible()){await action.click();return;}
 await sidebar.getByRole('button',{name:/탐색 메뉴|Navigation menu/u}).click();
 await sidebar.getByRole('navigation',{name:/빠른 탐색|Quick navigation/u}).getByRole('button',{name,exact:true}).click();
}
export async function fixtureTransport(page:Page, options:{sttFailure?:boolean;delaySTT?:Promise<void>}={}) {
 const calls:{url:string;body:string|null}[]=[];
 await page.addInitScript(()=>{
  const state=window as unknown as {workerDiagnostics:unknown[]};state.workerDiagnostics=[];
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker {
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);
    this.addEventListener('message',event=>{if(event.data?.error)state.workerDiagnostics.push({url:String(url),error:event.data.error});});
    this.addEventListener('error',event=>state.workerDiagnostics.push({url:String(url),message:event.message}));
   }
  };
 });
 await page.route('https://**/*',async route=>{
  const request=route.request(),url=request.url();
  if(!url.startsWith('https://api.openai.com/')&&!url.startsWith('https://openrouter.ai/')) { await route.abort();return; }
  calls.push({url,body:request.postData()});
  let body:unknown={data:[]},status=200;
  if(url.endsWith('/audio/transcriptions')) {if(options.delaySTT)await options.delaySTT; if(options.sttFailure){status=429;body={error:{message:'SYNTHETIC_PRIVATE_UPSTREAM_DETAIL'}};}else body={text:fixtureText,usage:{type:'duration',seconds:1}};}
  else if(url.endsWith('/chat/completions')) {const sent=request.postDataJSON();expect(sent.provider.only).toEqual([routerEndpoint.tag]);expect(sent.provider.allow_fallbacks).toBe(false);body={model:routerModel.id,choices:[{message:{content:fixtureMarkdown},finish_reason:'stop'}],usage:{prompt_tokens:50,completion_tokens:20}};}
  else if(url.endsWith('/endpoints')) body={data:{id:routerModel.id,endpoints:[routerEndpoint]}};
  else if(url==='https://api.openai.com/v1/models') body={data:[{id:'gpt-transcribe',owned_by:'TEST_ONLY_OPENAI_OWNER'}]};
  else if(url.startsWith('https://openrouter.ai/api/v1/models')) body={data:[routerModel]};
  await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
 });return calls;
}
export async function createVault(page:Page){
 await page.goto('/');await expect(page.getByRole('heading',{name:'새 보관함 만들기'})).toBeVisible();
 await page.getByLabel('암호',{exact:true}).fill(passphrase);await page.getByLabel('암호 확인',{exact:true}).fill(passphrase);
 await page.getByRole('button',{name:'보관함 만들기',exact:true}).click();await expect(page.getByRole('heading',{name:'음성 메모'})).toBeVisible();
}
export async function unlock(page:Page){await page.getByLabel('암호',{exact:true}).fill(passphrase);await page.getByRole('button',{name:'잠금 해제',exact:true}).click();await expect(page.getByRole('heading',{name:'음성 메모'})).toBeVisible();}
export function toneWav(seconds = 1){
 const data=Buffer.alloc(44 + 32000 * seconds),view=new DataView(data.buffer,data.byteOffset,data.byteLength);data.write('RIFF');view.setUint32(4,data.length-8,true);data.write('WAVE',8);data.write('fmt ',12);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);data.write('data',36);view.setUint32(40,32000 * seconds,true);for(let i=0;i<16000 * seconds;i++)view.setInt16(44+2*i,Math.round(1500*Math.sin(i*.1)),true);return data;
}
export async function enterFixtureKeys(page:Page){
 await clickAppAction(page,'설정');
 const openai=page.locator('section').filter({has:page.getByLabel('OpenAI API 키')});
 const router=page.locator('section').filter({has:page.getByLabel('OpenRouter API 키')});
 await page.getByLabel('OpenAI API 키').fill('KEYLESS_BROWSER_OPENAI_TEST');
 await openai.getByRole('button',{name:'키 저장',exact:true}).click();
 await expect(openai.getByText('저장됨 · 연결 미확인')).toBeVisible();
 await page.getByLabel('OpenRouter API 키').fill('KEYLESS_BROWSER_ROUTER_TEST');
 await router.getByRole('button',{name:'키 저장',exact:true}).click();
 await expect(router.getByText('저장됨 · 연결 미확인')).toBeVisible();
 await configureFixtureSTT(page);
 await page.getByRole('button',{name:'Minutes of Meeting',exact:true}).click();
}

// Explicit discovery/enable/default setup never acknowledges transmission or starts STT.
export async function configureFixtureSTT(page:Page,language:'ko'|'en'='ko') {
 const t=(ko:string,en:string)=>language==='ko'?ko:en;
 await clickAppAction(page,t('설정','Settings'));
 await page.getByRole('tab',{name:t('모델','Models'),exact:true}).click();
 const advanced=page.getByText(t('추가 정보 · 고급 모델 관리','Additional information · advanced model management'),{exact:true});
 if(await advanced.locator('..').getAttribute('open')===null)await advanced.click();
 const manager=page.getByRole('region',{name:t('중앙 모델 관리','Central model management')});
 await manager.getByRole('tab',{name:t('전사','STT'),exact:true}).click();
 await manager.getByRole('button',{name:t('OpenAI 목록 조회','Discover OpenAI'),exact:true}).click();
 const speech=fixtureModelRow(page,'openai','stt','gpt-transcribe',null);
 const speechEnabled=speech.getByRole('checkbox',{name:t('이 경로 활성화','Enable this route'),exact:true});
 // These controlled checkboxes reflect the encrypted save receipt, so check()
 // cannot require an immediate DOM toggle. One click, then await that receipt.
 if(!await speechEnabled.isChecked())await speechEnabled.click();
 await expect(speechEnabled).toBeChecked();
 const speechDetails=speech.getByText(t('자세히 보기 · 메타데이터','Details · metadata'),{exact:true});
 if(await speechDetails.locator('..').getAttribute('open')===null)await speechDetails.click();
 const chooseDefault=speech.getByRole('button',{name:t('단계 기본 모델로','Use as stage default'),exact:true});
 if(await chooseDefault.count())await chooseDefault.click();
 await expect(speech.getByRole('button',{name:t('이 단계 기본 모델','Default for this stage'),exact:true})).toBeVisible();
}

// Match actual route identity, never an alias or a row's current position.
export function fixtureRouteKey(modelId:string,endpointTag:string|null,stage:'stt'|'minutes'='minutes',provider:'openai'|'openrouter'='openrouter') {
 return JSON.stringify([provider,provider,modelId,stage,endpointTag]);
}
export function fixtureModelRow(page:Page,provider:'openai'|'openrouter',stage:'stt'|'minutes',modelId:string,endpointTag:string|null) {
 return page.getByRole('listitem',{name:`${provider} · ${stage} · ${provider} · ${modelId} · ${endpointTag??'none'}`,exact:true});
}
// Public discovery -> exact endpoint -> enable -> prospective default are real
// user actions against intercepted TEST_ONLY catalog responses, not state seeding.
export async function configureFixtureMinutes(page:Page,routes:readonly {modelId:string;endpointTag:string}[]=[{modelId:routerModel.id,endpointTag:routerEndpoint.tag}],language:'ko'|'en'='ko') {
 const t=(ko:string,en:string)=>language==='ko'?ko:en;
 await clickAppAction(page,t('설정','Settings'));
 await page.getByRole('tab',{name:t('모델','Models'),exact:true}).click();
 const advanced=page.getByText(t('추가 정보 · 고급 모델 관리','Additional information · advanced model management'),{exact:true});
 if(await advanced.locator('..').getAttribute('open')===null)await advanced.click();
 const manager=page.getByRole('region',{name:t('중앙 모델 관리','Central model management')});
 await manager.getByRole('tab',{name:t('정리 노트','Notes'),exact:true}).click();
 await manager.getByRole('button',{name:t('OpenRouter 목록 조회','Discover OpenRouter'),exact:true}).click();
 const full=manager.getByRole('button',{name:t('전체 모델 보기','Show all models'),exact:true});
 if(await full.count())await full.click();
 for(const route of routes){
  await fixtureModelRow(page,'openrouter','minutes',route.modelId,null).getByRole('button',{name:t('엔드포인트 불러오기','Load endpoints'),exact:true}).click();
  const exact=fixtureModelRow(page,'openrouter','minutes',route.modelId,route.endpointTag);
  const enabled=exact.getByRole('checkbox',{name:t('이 경로 활성화','Enable this route'),exact:true});
  if(!await enabled.isChecked())await enabled.click();
  await expect(enabled).toBeChecked();
 }
 const first=fixtureModelRow(page,'openrouter','minutes',routes[0].modelId,routes[0].endpointTag);
 const firstDetails=first.getByText(t('자세히 보기 · 메타데이터','Details · metadata'),{exact:true});
 if(await firstDetails.locator('..').getAttribute('open')===null)await firstDetails.click();
 if(await first.getByRole('button',{name:t('단계 기본 모델로','Use as stage default'),exact:true}).count()){
  await first.getByRole('button',{name:t('단계 기본 모델로','Use as stage default'),exact:true}).click();
 }
 await expect(first.getByRole('button',{name:t('이 단계 기본 모델','Default for this stage'),exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Minutes of Meeting',exact:true}).click();
}
export async function selectFixtureMinutesRoute(page:Page,modelId:string,endpointTag:string,language:'ko'|'en'='ko',memberB=false) {
 const t=(ko:string,en:string)=>language==='ko'?ko:en;
 const summary=page.getByText(memberB?t('자세히 보기 · B 모델 변경','Details · change member B'):t('자세히 보기 · 모델 변경','Details · change model'),{exact:true});
 const details=summary.locator('..');
 if(await details.getAttribute('open')===null)await summary.click();
 const select=page.getByRole('combobox',{name:memberB?t('B 모델','Member B model'):t('정리 모델','Notes model'),exact:true});
 const key=fixtureRouteKey(modelId,endpointTag);
 await select.selectOption(key);await expect(select).toHaveValue(key);
}
export async function inspectVaultSentinels(page:Page,sentinels:readonly string[]){
 return page.evaluate(async needles=>{
  const databases=await indexedDB.databases();
  if(!databases.some(db=>db.name==='mom-encrypted-vault-v1'))throw new Error('Expected test vault absent');
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('mom-encrypted-vault-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Test vault read failed'));});
  const leaks=new Set<number>();let records=0;
  const inspect=(value:unknown):void=>{
   if(value instanceof ArrayBuffer){inspect(new TextDecoder().decode(value));return;}
   if(ArrayBuffer.isView(value)){inspect(new TextDecoder().decode(value));return;}
   if(typeof value==='string'){needles.forEach((needle,index)=>{if(value.includes(needle))leaks.add(index);});return;}
   if(value&&typeof value==='object')Object.entries(value).forEach(([key,child])=>{inspect(key);inspect(child);});
  };
  try{for(const name of db.objectStoreNames){const values=await new Promise<unknown[]>((resolve,reject)=>{const transaction=db.transaction(name,'readonly'),request=transaction.objectStore(name).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Test ciphertext inspection failed'));});records+=values.length;values.forEach(inspect);}}finally{db.close();}
  return {records,leakedSentinelIndices:[...leaks]};
 },[...sentinels]);
}

// Real local preparation is a separate user action; this helper never acknowledges or starts paid STT.
export async function prepareForTranscription(page: Page, language: 'ko' | 'en' = 'ko') {
 const t = (ko: string, en: string) => language === 'ko' ? ko : en;
 await page.getByRole('button', { name: t('전사 준비', 'Prepare transcription'), exact: true }).click();
 await expect(page.getByText(t('로컬 음성 준비 완료', 'Local audio preparation complete'), { exact: true })).toBeVisible();
 await page.getByRole('button', { name: t('전사하기 →', 'Transcribe →'), exact: true }).click();
}
