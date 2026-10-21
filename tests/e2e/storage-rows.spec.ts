import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Only the real storage component and styles are rendered; all 30 inventories are synthetic.
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import StorageManagement from './src/react-app/ui/components/StorageManagement';
function Fixture() {
 const [plan, setPlan] = useState(null);
 const projects = Array.from({length:30}, (_,i) => ({id:'synthetic-'+i, title:'SYNTHETIC_MEMO_'+(i+1)+(i===29?'_LONG_TITLE_'.repeat(30):'')}));
 const inventory = {sourceBytes:60397978,chunkBytes:29464986,draftBytes:0,projectBytes:100,encryptedBytes:89863064,vaultBytes:200,originUsage:null,originQuota:null,projects:projects.map((p,i)=>({projectId:p.id,sourceBytes:i===4?0:30198989,chunkBytes:i===4?0:14732493,draftBytes:0,projectBytes:100,encryptedBytes:44931532,retainedAudio:{sourceIds:i===4?[]:['source-'+i],chunkIds:i===4?[]:Array.from({length:13},(_,j)=>'chunk-'+i+'-'+j)},draftIds:[]}))};
 const controller = {session:'unlocked',preferences:{uiLanguage:globalThis.fixtureLocale},projects,storageInventory:inventory,audioDeletionPlan:plan,onRefreshStorage:()=>{},onPlanAudioDeletion:(scope,projectId)=>setPlan({scope,projectId,recordIds:[],draftIds:[],versionToken:'SYNTHETIC_PLAN'}),onCancelAudioDeletion:()=>setPlan(null),onConfirmAudioDeletion:()=>{throw new Error('Synthetic layout test must never confirm deletion');}};
 return <div className="mom" data-theme={globalThis.fixtureTheme} style={{display:'block',background:'var(--fill)',padding:16}}><div style={{maxWidth:1040,margin:'0 auto'}}><StorageManagement controller={controller}/></div></div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
let bundle: string;
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: fixture, loader: 'tsx', resolveDir: process.cwd() }, jsx: 'automatic', bundle: true, write: false, format: 'esm', loader: { '.wasm': 'dataurl' }, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
  bundle = result.outputFiles[0].text;
});

for (const language of ['ko', 'en'] as const) for (const width of [1280, 360]) {
  test(`30 compact storage rows: ${language}, ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__storage_layout_fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>' }));
    await page.goto('/__storage_layout_fixture');
    await page.addStyleTag({ content: readFileSync('src/react-app/ui/styles.css', 'utf8') });
    await page.addScriptTag({ type: 'module', content: `globalThis.fixtureLocale=${JSON.stringify(language)};globalThis.fixtureTheme=${JSON.stringify(language === 'ko' ? 'light' : 'dark')};\n${bundle}` });
    const rows = page.locator('.storage-meeting'); await expect(rows).toHaveCount(30);
    await page.evaluate(() => document.fonts.ready);
    const metrics = await rows.evaluateAll(elements => elements.map(row => {
      const title = row.querySelector('strong')!, stats = row.querySelector('dl')!, actions = row.querySelector('.actions')!;
      const r = row.getBoundingClientRect(), s = stats.getBoundingClientRect(), a = actions.getBoundingClientRect(), t = title.getBoundingClientRect();
      return { height: r.height, rightGap: r.right - a.right, centerDifference: Math.max(Math.abs(t.y+t.height/2-a.y-a.height/2),Math.abs(s.y+s.height/2-a.y-a.height/2)), truncated: title.scrollWidth > title.clientWidth };
    }));
    expect(metrics.every(row => row.height <= (width > 759 ? 62 : 170))).toBe(true);
    expect(metrics.every(row => Math.abs(row.rightGap) <= 1)).toBe(true);
    if (width > 759) expect(metrics.every(row => row.centerDifference <= 2)).toBe(true);
    expect(metrics.at(-1)!.truncated).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const empty = rows.nth(4); for (const button of await empty.getByRole('button').all()) await expect(button).toBeDisabled();
    const evidence = 'docs/superpowers/evidence/2026-10-19-storage-rows'; mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/${width}-${language}.png` });
    const last = rows.last(), open = last.getByRole('button', { name: language === 'ko' ? '원본 음성 삭제' : 'Delete original audio', exact: true });
    await open.click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('SYNTHETIC_MEMO_30');
    const confirm = dialog.getByRole('button', { name: language === 'ko' ? '선택한 음성 삭제' : 'Delete selected audio', exact: true });
    await expect(confirm).toBeDisabled(); await dialog.getByRole('button', { name: language === 'ko' ? '취소' : 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
    expect(errors).toEqual([]);
    writeFileSync(`${evidence}/${width}-${language}.json`, JSON.stringify({ language, width, rowCount: metrics.length, rowHeights: [...new Set(metrics.map(row => row.height))], maxRightGap: Math.max(...metrics.map(row => Math.abs(row.rightGap))), maxCenterDifference: Math.max(...metrics.map(row => row.centerDifference)), longTitleTruncated: metrics.at(-1)!.truncated, correctMemoConfirmation: true, cancelledWithoutDeletion: true, errors }, null, 2));
  });
}
