import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { clickAppAction, createVault, fixtureModelRow, fixtureRouteKey, inspectVaultSentinels, routerEndpoint, routerModel, unlock } from './helpers';

const model = { ...routerModel, id: 'fixture/settings-model', name: 'TEST_ONLY_SETTINGS_LONG_MODEL_NAME_FOR_PHONE_CONTAINMENT' };
const endpoints = [
  { ...routerEndpoint, tag: 'FixtureSettingsOne/explicit-region', provider_name: 'FixtureSettingsOne' },
  { ...routerEndpoint, tag: 'FixtureSettingsTwo/explicit-region', provider_name: 'FixtureSettingsTwo', pricing: { prompt: '0.000003', completion: '0.000004', request: '0' } },
];
const unknown = { ...routerModel, id: 'fixture/settings-unknown', name: 'TEST_ONLY_UNKNOWN_PRICING', pricing: {} };
const aliases = ['TEST_ONLY_ENCRYPTED_SETTINGS_ALPHA', 'TEST_ONLY_ENCRYPTED_SETTINGS_BETA'];
const fakeKey = 'KEYLESS_SETTINGS_ROUTER_TEST';
const evidence = '.superpowers/sdd/remaining-work/task-model-settings-consumer-browser';

async function interceptedDiscovery(page: Page) {
  const calls: { url: string; authorizationPresent: boolean }[] = [];
  await page.route('https://**/*', async route => {
    const url = route.request().url();
    calls.push({ url, authorizationPresent: route.request().headers().authorization !== undefined });
    if (url === 'https://openrouter.ai/api/v1/models') {
      const extra = Array.from({ length: 25 }, (_, i) => ({ ...routerModel, id: `fixture/settings-extra-${i}`, name: `TEST_ONLY_EXTRA_${i}` }));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [model, unknown, ...extra] }) });
    } else if (url === `https://openrouter.ai/api/v1/models/${model.id}/endpoints`) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { id: model.id, endpoints } }) });
    } else {
      await route.abort();
    }
  });
  return calls;
}

for (const { language, width, height } of [{ language: 'ko' as const, width: 1440, height: 900 }, { language: 'en' as const, width: 360, height: 800 }]) {
  test.describe(`${language} ${width} connected model Settings`, () => {
    test.use({ viewport: { width, height }, hasTouch: width === 360 });
    test('explicit public discovery, factual filters, exact aliased defaults and encrypted reload', async ({ page }) => {
      const t = (ko: string, en: string) => language === 'ko' ? ko : en;
      const calls = await interceptedDiscovery(page), errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await createVault(page);
      const chooseLanguage = async () => {
        if (language === 'en') {
          await clickAppAction(page, '설정');
          await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
          await page.getByRole('button', { name: 'English', exact: true }).click();
        }
      };
      await chooseLanguage();
      const openSettings = async () => {
        await clickAppAction(page, t('설정', 'Settings'));
        await page.getByRole('tab', { name: t('모델', 'Models'), exact: true }).click();
        await page.getByText(t('추가 정보 · 고급 모델 관리', 'Additional information · advanced model management'), { exact: true }).click();
      };
      const manager = page.getByRole('region', { name: t('중앙 모델 관리', 'Central model management') });
      const search = manager.getByRole('searchbox', { name: t('모델 검색', 'Search models'), exact: true });
      const capture = async (state: string) => {
        const bounds = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, mainWidth: document.querySelector('main')?.clientWidth, mainScroll: document.querySelector('main')?.scrollWidth }));
        expect(bounds.documentWidth).toBeLessThanOrEqual(width + 1);
        if (bounds.mainWidth !== undefined) expect(bounds.mainScroll).toBeLessThanOrEqual(bounds.mainWidth + 1);
        await mkdir(evidence, { recursive: true });
        await writeFile(`${evidence}/${width}-${language}-${state}.json`, JSON.stringify(bounds, null, 2));
        await page.screenshot({ path: `${evidence}/${width}-${language}-${state}.png`, fullPage: true });
      };
      await clickAppAction(page, t('설정', 'Settings'));
      await page.getByRole('tab', { name: t('연결 설정', 'Connections'), exact: true }).click();
      await expect(page.getByText(t('OpenRouter 전사 · 정리 노트', 'OpenRouter transcription · notes'), { exact: true })).toBeVisible();
      const key = page.getByLabel(`OpenRouter API ${t('키', 'key')}`), connection = page.locator('section').filter({ has: key });
      await key.fill(fakeKey); await connection.getByRole('button', { name: t('키 저장', 'Save key'), exact: true }).click();
      await expect(connection.getByText(t('저장됨 · 연결 미확인', 'Saved · connection unverified'))).toBeVisible();
      await expect(key).toHaveValue('');
      await openSettings();
      await expect(manager.getByRole('button', { name: t('OpenAI 목록 조회', 'Discover OpenAI'), exact: true })).toBeDisabled();
      await manager.getByRole('tab', { name: t('전사', 'STT'), exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(manager.getByRole('tab', { name: t('정리 노트', 'Notes'), exact: true })).toBeFocused();
      expect(calls).toEqual([]);
      await manager.getByRole('button', { name: t('OpenRouter 목록 조회', 'Discover OpenRouter'), exact: true }).click();
      await manager.getByRole('button', { name: t('전체 모델 보기', 'Show all models'), exact: true }).click();
      await expect(manager.getByRole('listitem')).toHaveCount(20);
      expect(calls).toEqual([{ url: 'https://openrouter.ai/api/v1/models', authorizationPresent: false }]);
      await manager.getByRole('combobox', { name: t('제공사', 'Provider'), exact: true }).selectOption('openrouter');
      await manager.getByRole('combobox', { name: t('카탈로그 소유자 / 네임스페이스', 'Catalog owner / namespace'), exact: true }).selectOption('unknown');
      const price = manager.getByRole('combobox', { name: t('카탈로그 요금', 'Catalog price'), exact: true });
      await price.selectOption('unknown'); await expect(manager.getByRole('listitem')).toHaveCount(20);
      await search.fill(unknown.id); await expect(manager.getByRole('listitem')).toHaveCount(1);
      const unknownRow = fixtureModelRow(page, 'openrouter', 'minutes', unknown.id, null);
      await expect(unknownRow).toContainText(t('요금 확인 불가', 'Unknown pricing'));
      await expect(unknownRow.getByRole('checkbox')).toBeDisabled();
      await price.selectOption('all'); await search.fill(model.id);
      await expect(manager.getByRole('listitem')).toHaveCount(1);
      const candidate = fixtureModelRow(page, 'openrouter', 'minutes', model.id, null);
      await expect(candidate.getByRole('checkbox')).not.toBeChecked();
      await expect(candidate.getByRole('checkbox')).toBeDisabled();
      await candidate.getByRole('button', { name: t('엔드포인트 불러오기', 'Load endpoints'), exact: true }).click();
      await expect(manager.getByRole('listitem')).toHaveCount(3);
      await price.selectOption('priced'); await expect(manager.getByRole('listitem')).toHaveCount(2);
      await manager.getByRole('spinbutton', { name: t('최소 컨텍스트 토큰', 'Minimum context tokens'), exact: true }).fill('32000');
      await manager.getByRole('spinbutton', { name: t('최소 출력 토큰', 'Minimum output tokens'), exact: true }).fill('4096');
      await expect(manager.getByRole('listitem')).toHaveCount(2);
      for (let index = 0; index < endpoints.length; index++) {
        const row = fixtureModelRow(page, 'openrouter', 'minutes', model.id, endpoints[index].tag);
        const details = row.getByText(t('자세히 보기 · 메타데이터', 'Details · metadata'), { exact: true });
        await details.focus(); await page.keyboard.press('Enter');
        await expect(details.locator('..')).toHaveAttribute('open', '');
        await expect(row).toContainText('https://openrouter.ai/api/v1/models');
        await expect(row).toContainText(`https://openrouter.ai/api/v1/models/${model.id}/endpoints`);
        await expect(row).toContainText('USD'); await expect(row).toContainText('32000');
        await expect(row).toContainText(t('확인 시각', 'Checked at'));
        await expect(row).toContainText(t('표시 요금 · 실제 청구 아님', 'Advertised rates · not actual billing'));
        await row.getByRole('checkbox').click(); await expect(row.getByRole('checkbox')).toBeChecked();
        await row.getByRole('textbox', { name: t('표시 별칭', 'Display alias'), exact: true }).pressSequentially(aliases[index], { delay: 20 });
        await row.getByRole('button', { name: t('별칭 저장', 'Save alias'), exact: true }).click();
        await expect(row.getByRole('heading', { name: aliases[index], exact: true })).toBeVisible();
      }
      const first = fixtureModelRow(page, 'openrouter', 'minutes', model.id, endpoints[0].tag);
      await first.getByRole('button', { name: t('단계 기본 모델로', 'Use as stage default'), exact: true }).click();
      await expect(first.getByRole('button', { name: t('이 단계 기본 모델', 'Default for this stage'), exact: true })).toBeVisible();
      await capture('central-exact-alias-default');
      expect(calls).toHaveLength(2); expect(calls.every(call => !call.authorizationPresent)).toBe(true);
      await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
      await page.getByRole('main').getByRole('button', { name: t('+ 새 음성 메모', '+ New voice memo'), exact: true }).click();
      await page.getByRole('navigation', { name: t('음성 메모 단계', 'Memo steps') }).getByRole('button', { name: t('3 메모 정리', '3 Organize memo'), exact: true }).click();
      const summary = page.getByText(t('자세히 보기 · 모델 변경', 'Details · change model'), { exact: true });
      await summary.focus(); await page.keyboard.press('Enter');
      const selected = page.getByRole('combobox', { name: t('정리 모델', 'Notes model'), exact: true });
      await expect(selected).toHaveValue(fixtureRouteKey(model.id, endpoints[0].tag));
      await expect(selected.locator('option')).toHaveCount(3);
      await expect(selected).toContainText(aliases[0]); await expect(selected).toContainText(aliases[1]);
      await expect(selected).not.toContainText(unknown.id); await expect(selected).not.toContainText('settings-extra');
      await selected.selectOption(fixtureRouteKey(model.id, endpoints[1].tag));
      await expect(selected).toHaveValue(fixtureRouteKey(model.id, endpoints[1].tag));
      await capture('workflow-two-exact-routes');
      const encrypted = await inspectVaultSentinels(page, [...aliases, fakeKey]);
      expect(encrypted.records).toBeGreaterThan(0); expect(encrypted.leakedSentinelIndices).toEqual([]);
      await clickAppAction(page, t('지금 잠그기', 'Lock now'));
      await expect(page.getByRole('main')).toHaveCount(0);
      await expect(page.getByText(aliases[0], { exact: true })).toHaveCount(0);
      await expect(page.getByRole('listitem')).toHaveCount(0);
      await page.reload(); await unlock(page); await chooseLanguage();
      expect(calls).toHaveLength(2);
      await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
      await page.getByRole('button', { name: language === 'ko' ? /^열기 / : /^Open / }).click();
      await page.getByRole('navigation', { name: t('음성 메모 단계', 'Memo steps') }).getByRole('button', { name: t('3 메모 정리', '3 Organize memo'), exact: true }).click();
      await page.getByText(t('자세히 보기 · 모델 변경', 'Details · change model'), { exact: true }).click();
      await expect(selected).toHaveValue(fixtureRouteKey(model.id, endpoints[1].tag));
      await expect(selected).toContainText(aliases[0]); await expect(selected).toContainText(aliases[1]);
      await expect(page.getByText(t('설정에서 이 경로를 활성화하고 메타데이터를 새로 확인한 뒤 전송하세요.', 'Enable this exact route and refresh its metadata in Settings before sending.'), { exact: true })).toBeVisible();
      await openSettings(); await manager.getByRole('tab', { name: t('정리 노트', 'Notes'), exact: true }).click();
      await expect(manager.getByRole('listitem')).toHaveCount(2);
      await first.getByText(t('자세히 보기 · 메타데이터', 'Details · metadata'), { exact: true }).click();
      await expect(first.getByRole('button', { name: t('이 단계 기본 모델', 'Default for this stage'), exact: true })).toBeVisible();
      expect(calls).toHaveLength(2);
      await manager.getByRole('button', { name: t('OpenRouter 목록 조회', 'Discover OpenRouter'), exact: true }).click();
      await search.fill(model.id); await expect(manager.getByRole('listitem')).toHaveCount(3);
      expect(calls).toHaveLength(4); expect(calls.every(call => !call.authorizationPresent)).toBe(true);
      await expect(first.getByRole('checkbox')).toBeChecked();
      await expect(first.getByRole('heading', { name: aliases[0], exact: true })).toBeVisible();
      await capture('explicit-refresh-after-reload');
      expect(errors).toEqual([]);
    });
  });
}
