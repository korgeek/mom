// Real encrypted disposable vault; all provider traffic uses explicitly synthetic intercepted responses.
import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { clickAppAction, createVault, passphrase, toneWav, inspectVaultSentinels } from './helpers';
const evidence = '.superpowers/sdd/2026-10-15-model-registration/evidence';
async function capture(page: Page, name: string) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1); }
async function models(page: Page, en = false) { await clickAppAction(page, en ? 'Settings' : '설정'); await page.getByRole('tab', { name: en ? 'Models' : '모델', exact: true }).click(); return page.getByRole('region', { name: en ? 'Model registration' : '모델 등록', exact: true }); }
async function saveKey(panel: ReturnType<Page['getByRole']>, en = false) { await panel.getByLabel(en ? 'Registration API key' : '등록 API 키', { exact: true }).fill('SYNTHETIC_BROWSER_REGISTRATION_SECRET'); await panel.getByRole('button', { name: en ? 'Save key' : '키 저장', exact: true }).click(); await expect(panel.getByText(en ? 'Key saved.' : '키를 저장했어요.', { exact: true })).toBeVisible(); await expect(panel.getByLabel(en ? 'Registration API key' : '등록 API 키', { exact: true })).toHaveValue(''); }
test('desktop Korean STT and LLM registration, real request assembly, encrypted reload, failures and lock', async ({ page }) => {
    const calls: string[] = [];
    let failed = false;
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://**/*', async (route) => { const req = route.request(); if (new URL(req.url()).origin === new URL(test.info().project.use.baseURL!).origin) { await route.continue(); return; } calls.push(req.url()); expect(req.headers().authorization).toBe('Bearer SYNTHETIC_BROWSER_REGISTRATION_SECRET'); let body: unknown; if (req.url().endsWith('/audio/transcriptions')) {
        expect(req.headers()['content-type']).toContain('multipart/form-data');
        expect(req.postData()).toContain('fixture-whisper');
        body = { text: 'SYNTHETIC_STT_RESPONSE', usage: { seconds: 1 } };
    }
    else {
        expect(req.url()).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(req.postDataJSON().messages[1].content).toContain('합성 테스트');
        body = failed ? { error: { message: 'SYNTHETIC_BROWSER_REGISTRATION_SECRET' } } : { model: 'fixture-text', choices: [{ message: { content: '# SYNTHETIC_MINUTES' }, finish_reason: 'stop' }] };
    } await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); });
    await createVault(page);
    let panel = await models(page);
    await panel.getByRole('button', { name: '모델 등록', exact: true }).click();
    await panel.getByLabel('이름', { exact: true }).fill('SYNTHETIC_STT_REGISTRATION');
    await panel.getByLabel('모델 ID', { exact: true }).fill('fixture-whisper');
    await capture(page, '1440-ko-stt-form');
    await panel.getByLabel('요청 템플릿 미리보기').scrollIntoViewIfNeeded();
    await capture(page, '1440-ko-stt-preview');
    await expect(panel.getByRole('button', { name: '키 저장', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: '등록 저장', exact: true }).click();
    await expect(panel.getByText('등록을 암호화 저장했어요.', { exact: true })).toBeVisible();
    await saveKey(panel);
    await panel.getByLabel('테스트 음성 (30초 · 5 MiB 이하)', { exact: true }).setInputFiles({ name: 'SYNTHETIC_AUDIO.wav', mimeType: 'audio/wav', buffer: toneWav() });
    await expect(panel.getByText('32,044 bytes · 1.00 s')).toBeVisible();
    await panel.getByRole('button', { name: '테스트 호출', exact: true }).click();
    await expect(panel.getByRole('region', { name: '테스트 결과', exact: true })).toContainText('테스트 결과: 성공');
    await expect(panel.getByText('암호화 저장됨', { exact: false })).toBeVisible();
    await capture(page, '1440-ko-stt-result');
    await panel.getByRole('button', { name: '닫기', exact: true }).click();
    await panel.getByRole('tab', { name: 'LLM', exact: true }).click();
    await panel.getByRole('button', { name: '모델 등록', exact: true }).click();
    await panel.getByRole('combobox', { name: '주소 도움값', exact: true }).selectOption('openrouter');
    await panel.getByLabel('이름', { exact: true }).fill('SYNTHETIC_LLM_REGISTRATION');
    await panel.getByLabel('모델 ID', { exact: true }).fill('fixture-text');
    await panel.getByRole('button', { name: '등록 저장', exact: true }).click();
    await expect(panel.getByText('등록을 암호화 저장했어요.', { exact: true })).toBeVisible();
    await saveKey(panel);
    await panel.getByRole('checkbox', { name: /OpenRouter 전송/ }).check();
    await panel.getByRole('button', { name: '테스트 호출', exact: true }).click();
    await expect(panel.getByRole('region', { name: '테스트 결과', exact: true })).toContainText('테스트 결과: 성공');
    await capture(page, '1440-ko-llm-result');
    failed = true;
    await panel.getByRole('button', { name: '테스트 호출', exact: true }).click();
    await expect(panel.getByRole('region', { name: '테스트 결과', exact: true })).toContainText('테스트 결과: 실패');
    await capture(page, '1440-ko-llm-failed');
    expect(await panel.innerText()).not.toContain('SYNTHETIC_BROWSER_REGISTRATION_SECRET');
    expect(calls).toHaveLength(3);
    await page.reload();
    await page.getByLabel('암호', { exact: true }).fill(passphrase);
    await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
    panel = await models(page);
    await expect(panel.getByText('SYNTHETIC_STT_REGISTRATION', { exact: true })).toBeVisible();
    await panel.getByRole('tab', { name: 'LLM', exact: true }).click();
    await expect(panel.getByText('SYNTHETIC_LLM_REGISTRATION', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '수정 · 테스트', exact: true }).click();
    await expect(panel.getByRole('region', { name: '테스트 결과', exact: true })).toContainText('테스트 결과: 실패');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect(page.getByRole('heading', { name: '암호로 잠금 해제' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain('SYNTHETIC_LLM_REGISTRATION');
    await capture(page, '1440-ko-locked');
    expect((await inspectVaultSentinels(page, ['SYNTHETIC_BROWSER_REGISTRATION_SECRET', 'SYNTHETIC_STT_REGISTRATION', 'SYNTHETIC_LLM_REGISTRATION', 'SYNTHETIC_STT_RESPONSE'])).leakedSentinelIndices).toEqual([]);
    expect(errors).toEqual([]);
});
test('360x800 English long previews, local model aliases and keyboard navigation', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.route('https://**/*', r => r.abort());
    await createVault(page);
    await clickAppAction(page, '설정');
    await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    const panel = await models(page, true);
    await panel.getByRole('tab', { name: 'STT', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(panel.getByRole('tab', { name: 'LLM', exact: true })).toBeFocused();
    await panel.getByRole('button', { name: 'Register model', exact: true }).click();
    await panel.getByRole('combobox', { name: 'Address preset', exact: true }).selectOption('custom');
    await panel.getByRole('combobox', { name: 'Authentication', exact: true }).selectOption('none');
    await panel.getByLabel('Name', { exact: true }).fill('SYNTHETIC_LOCAL_LLM');
    await panel.getByLabel('Model ID', { exact: true }).fill('local-alias-' + 'long'.repeat(35));
    await expect(panel.getByLabel('Request template preview')).toContainText('http://localhost:8000/v1/chat/completions');
    await capture(page, '360-en-llm-form');
    await panel.getByLabel('Request template preview').scrollIntoViewIfNeeded();
    await capture(page, '360-en-llm-preview');
    await panel.getByRole('button', { name: 'Save registration', exact: true }).click();
    await expect(panel.getByText('Registration saved with encryption.', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await capture(page, '360-en-llm-list');
    await panel.getByRole('tab', { name: 'STT', exact: true }).click();
    await panel.getByRole('button', { name: 'Register model', exact: true }).click();
    await panel.getByLabel('Name', { exact: true }).fill('SYNTHETIC_OPENAI_STT');
    await panel.getByLabel('Model ID', { exact: true }).fill('whisper-local');
    await capture(page, '360-en-stt-form');
});
test('shipped CSP permits custom HTTPS and loopback test calls while blocking external HTTP',async({page})=>{
 const urls=['https://custom-model.example.test/v1','http://127.0.0.1:8000/v1','http://localhost:8000/v1'];const calls:string[]=[];
 for(const base of urls)await page.route(base+'/chat/completions',async route=>{calls.push(route.request().url());expect(route.request().headers().authorization).toBeUndefined();await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'SYNTHETIC_CUSTOM_ROUTE_RESULT'},finish_reason:'stop'}]})});});
 const response=await page.goto('/');expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");expect(response?.headers()['content-security-policy']).toContain("connect-src 'self' https: http://localhost:* http://127.0.0.1:*");
 await createVault(page);const panel=await models(page);await panel.getByRole('tab',{name:'LLM',exact:true}).click();await panel.getByRole('button',{name:'모델 등록',exact:true}).click();await panel.getByLabel('이름',{exact:true}).fill('SYNTHETIC_CUSTOM_API');await panel.getByLabel('모델 ID',{exact:true}).fill('local-model-alias');await panel.getByRole('combobox',{name:'인증',exact:true}).selectOption('none');
 for(const base of urls){await panel.getByLabel('Base URL',{exact:true}).fill(base);await panel.getByRole('button',{name:'등록 저장',exact:true}).click();await expect(panel.getByText('등록을 암호화 저장했어요.',{exact:true})).toBeVisible();await panel.getByRole('button',{name:'테스트 호출',exact:true}).click();await expect(panel.getByRole('region',{name:'테스트 결과',exact:true})).toContainText('테스트 결과: 성공');}
 expect(calls).toEqual(urls.map(base=>base+'/chat/completions'));
 await panel.getByLabel('Base URL',{exact:true}).fill('http://external.example.test/v1');await expect(panel.getByRole('button',{name:'등록 저장',exact:true})).toBeDisabled();
 await panel.getByLabel('Base URL',{exact:true}).fill('http://[::1]:8000/v1');await expect(panel.getByRole('button',{name:'테스트 호출',exact:true})).toBeDisabled();await expect(panel.getByRole('alert')).toContainText('localhost');await panel.getByRole('alert').scrollIntoViewIfNeeded();await capture(page,'1440-ko-ipv6-localhost-guidance');
});
