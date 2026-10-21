// Synthetic vaults in visible sandboxed Chrome. No provider credentials or inference.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { clickAppAction, createVault } from './helpers';
test.use({ hasTouch: true });

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 &&
    document.querySelector('main')!.scrollWidth <= document.querySelector('main')!.clientWidth + 1)).toBe(true);
}
async function selectedTabIsVisible(tabs: Locator) {
  await expect.poll(() => tabs.evaluate(element => {
    const selected = element.querySelector('[aria-selected="true"]')!.getBoundingClientRect(), list = element.getBoundingClientRect();
    return selected.left >= list.left - 1 && selected.right <= list.right + 1;
  })).toBe(true);
}
for (const width of [360, 390, 430, 1440]) test(`mobile UI at ${width}: navigation, settings row and security labels`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
  await page.route('https://**/*', route => route.abort()); await createVault(page);
  const sidebar = page.getByRole('complementary', { name: '음성 메모 탐색' });
  const trigger = sidebar.getByRole('button', { name: '탐색 메뉴', exact: true });
  if (width < 760) {
    expect((await sidebar.boundingBox())!.height).toBeLessThanOrEqual(72);
    const brand = (await sidebar.getByRole('button', { name: 'Minutes of Meeting', exact: true }).boundingBox())!;
    const control = (await trigger.boundingBox())!;
    expect(Math.abs(brand.y + brand.height / 2 - control.y - control.height / 2)).toBeLessThanOrEqual(1);
    expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44);
    await trigger.focus(); await page.keyboard.press('Enter');
    const panel = sidebar.getByRole('navigation', { name: '빠른 탐색' });
    for (const name of ['처리 기록', '설정', '지금 잠그기']) {
      await page.keyboard.press('Tab'); await expect(panel.getByRole('button', { name, exact: true })).toBeFocused();
      expect((await panel.getByRole('button', { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath(`${width}-menu.png`) });
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click(); await page.getByRole('main').click({ position: { x: 20, y: 20 } });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  } else await expect(trigger).toBeHidden();
  await clickAppAction(page, '설정');
  const tabs = page.getByRole('tablist', { name: '설정 항목', exact: true }), buttons = tabs.getByRole('tab');
  await expect(buttons).toHaveCount(4);
  expect(await buttons.evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().y))).size)).toBe(1);
  await buttons.first().focus();
  for (const [key, index] of [['End', 3], ['Home', 0], ['ArrowLeft', 3], ['ArrowRight', 0], ['ArrowRight', 1]] as const) {
    await page.keyboard.press(key); await expect(buttons.nth(index)).toBeFocused();
    await expect(buttons.nth(index)).toHaveAttribute('aria-selected', 'true'); await selectedTabIsVisible(tabs);
  }
  await page.getByRole('tab', { name: '보안 · 잠금', exact: true }).click(); await selectedTabIsVisible(tabs);
  const facts = await page.locator('.settings-panel .facts').evaluate(element => [...element.children].map(child => {
    const r = child.getBoundingClientRect(); return { tag: child.tagName, x: r.x, y: r.y, bottom: r.bottom };
  }));
  expect(facts.map(fact => fact.tag)).toEqual(['DT', 'DD', 'DT', 'DD', 'DT', 'DD']);
  for (let index = 0; index < facts.length; index += 2) {
    if (width < 760) {
      expect(facts[index].bottom).toBeLessThanOrEqual(facts[index + 1].y);
      expect(facts[index].x).toBeCloseTo(facts[index + 1].x, 0);
    } else expect(facts[index].y).toBeCloseTo(facts[index + 1].y, 0);
  }
  await fits(page); await page.screenshot({ path: testInfo.outputPath(`${width}-security.png`), fullPage: true });
  await clickAppAction(page, '지금 잠그기'); await expect(page.getByRole('main')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '암호로 잠금 해제' })).toBeVisible();
});

test('390px reduced-height viewport keeps key and model inputs reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.route('https://**/*', route => route.abort()); await createVault(page);
  await clickAppAction(page, '설정');
  for (const [button, title] of [['API 키 추가', 'API 키 추가'], ['새 모델', '새 모델 등록']] as const) {
    await page.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await page.setViewportSize({ width: 390, height: 430 });
    const field = dialog.locator('input:not([type=checkbox]):visible').last(); await field.focus();
    const geometry = await field.evaluate(element => { const r = element.getBoundingClientRect(); return { y: r.y, bottom: r.bottom, fontSize: parseFloat(getComputedStyle(element).fontSize) }; });
    expect(geometry.y).toBeGreaterThanOrEqual(0); expect(geometry.bottom).toBeLessThanOrEqual(430); expect(geometry.fontSize).toBeGreaterThanOrEqual(16);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`390-short-${button}.png`) });
    const summary = dialog.getByText(button === 'API 키 추가' ? '보관 옵션' : '고급 설정', { exact: true });
    await summary.scrollIntoViewIfNeeded(); expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await summary.tap(); await expect(summary.locator('..')).toHaveAttribute('open', '');
    await summary.focus(); await page.keyboard.press('Space'); await expect(summary.locator('..')).not.toHaveAttribute('open');
    await page.screenshot({ path: testInfo.outputPath(`390-summary-${button}.png`) });
    await dialog.getByRole('button', { name: '닫기', exact: true }).click(); await page.setViewportSize({ width: 390, height: 844 });
  }
  await fits(page);
});
