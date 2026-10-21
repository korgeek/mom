import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { clickAppAction, createVault, unlock } from './helpers';

const evidence = '.superpowers/sdd/remaining-work/task-minutes-language-consumer-native';
for (const scenario of [{ language: 'ko' as const, width: 1440, height: 900 }, { language: 'en' as const, width: 360, height: 800 }]) test.describe(`${scenario.language} ${scenario.width} notes language`, () => {
  test.use({ viewport: { width: scenario.width, height: scenario.height }, hasTouch: scenario.width === 360 });
  test('visible language picker, slow keyboard Apply, encrypted reload and unapplied draft discard', async ({ page }) => {
    const errors: string[] = [], intercepted: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // Fresh disposable context; no keys, audio or paid request. The ordinary
    // public model catalog is intercepted before navigation as an empty fixture.
    await page.route('https://**/*', async route => {
      const url = route.request().url(); intercepted.push(url);
      if (url === 'https://openrouter.ai/api/v1/models') await route.fulfill({ contentType: 'application/json', body: '{"data":[]}' });
      else await route.abort();
    });
    await createVault(page);
    if (scenario.language === 'en') {
      await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click(); await page.getByRole('button', { name: 'English', exact: true }).click(); await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
    }
    const t = (ko: string, en: string) => scenario.language === 'ko' ? ko : en;
    await page.getByRole('main').getByRole('button', { name: t('+ 새 음성 메모', '+ New voice memo'), exact: true }).click();
    await page.getByRole('navigation', { name: t('음성 메모 단계', 'Memo steps') }).getByRole('button').nth(2).click();
    const select = page.getByRole('combobox', {name:t('출력 언어','Output language'),exact:true});
    await expect(select).toHaveValue('__app'); await select.selectOption('__custom');
    const input = page.getByLabel(t('정리 노트 언어', 'Notes language'), { exact: true }); await expect(input).toBeEnabled(); await input.fill(''); await input.pressSequentially('zh-Hant-native', { delay: 80 });
    await expect(input).toHaveValue('zh-Hant-native'); await expect(input).toBeEnabled(); await expect(select).toHaveValue('__custom');
    await expect(page.getByText(t('수정 중인 언어는 초안으로 유지돼요. 적용하면 이 메모의 언어 설정을 저장해요.', 'This language edit is retained as a draft. Apply to save this memo’s language setting.'), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: t('언어 적용', 'Apply language'), exact: true }).click(); await expect(input).toHaveValue('zh-Hant-native');
    await mkdir(evidence, { recursive: true });
    const geometry = await page.evaluate(() => ({ documentWidth: document.documentElement.clientWidth, documentScroll: document.documentElement.scrollWidth, mainWidth: document.querySelector('main')!.clientWidth, mainScroll: document.querySelector('main')!.scrollWidth }));
    expect(geometry.documentScroll).toBeLessThanOrEqual(geometry.documentWidth + 1); expect(geometry.mainScroll).toBeLessThanOrEqual(geometry.mainWidth + 1);
    await page.screenshot({ path: `${evidence}/${scenario.width}-${scenario.language}-applied.png`, fullPage: true });
    await page.getByRole('button', { name: t('지금 잠그기', 'Lock now'), exact: true }).first().click(); await expect(page.getByRole('heading', { name: t('암호로 잠금 해제', 'Unlock with your passphrase') })).toBeVisible(); await expect(page.getByText(/zh-Hant-native/)).toHaveCount(0);
    await page.reload(); await unlock(page); await page.getByRole('button', { name: /^열기 / }).first().click(); await page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button').nth(2).click();
    await expect(page.getByLabel('정리 노트 언어', {exact:true})).toHaveValue('zh-Hant-native'); await expect(page.getByRole('combobox',{name:'출력 언어',exact:true})).toHaveValue('__custom');
    await page.getByLabel('정리 노트 언어', { exact: true }).fill('UNAPPLIED_NATIVE_DRAFT'); await page.getByRole('button', { name: '지금 잠그기', exact: true }).first().click(); await expect(page.getByRole('heading', { name: '암호로 잠금 해제' })).toBeVisible(); await expect(page.getByText(/UNAPPLIED_NATIVE_DRAFT/)).toHaveCount(0);
    await unlock(page); await page.getByRole('button', { name: /^열기 / }).first().click(); await page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button').nth(2).click(); await expect(page.getByLabel('정리 노트 언어', { exact: true })).toHaveValue('zh-Hant-native');
    expect(intercepted.every(url => url === 'https://openrouter.ai/api/v1/models')).toBe(true); expect(errors).toEqual([]);
    await writeFile(`${evidence}/${scenario.width}-${scenario.language}-events.json`, JSON.stringify({ geometry, slowKeyboardDelayMs: 80, publicCatalogFixtures: intercepted.length, providerRequestsSent: 0, keysEntered: 0, audioFiles: 0, errors }, null, 2));
  });
});
