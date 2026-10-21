import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scanPublicText } from '../scripts/check-public-artifacts.mjs';
test('ships the complete Lucide and Feather license notice', async () => {
 const source = await readFile(new URL('../node_modules/lucide-react/LICENSE', import.meta.url), 'utf8');
 const distributed = await readFile(new URL('../public/licenses/lucide-react-1.61.0-LICENSE.txt', import.meta.url), 'utf8');
 assert.equal(distributed, source);
 const notices = await readFile(new URL('../public/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8');
 assert.match(notices, /\/licenses\/lucide-react-1\.61\.0-LICENSE\.txt/);
});
test('ships the same MoM license in the repository and browser distribution',async()=>{
 const source=await readFile(new URL('../LICENSE',import.meta.url),'utf8');
 const distributed=await readFile(new URL('../public/licenses/MoM-SOURCE-AVAILABLE-LICENSE.txt',import.meta.url),'utf8');
 assert.equal(distributed,source);
 const headers=await readFile(new URL('../public/_headers',import.meta.url),'utf8');
 assert.match(headers,/\/licenses\/\*\.txt\n\s+Content-Type: text\/plain; charset=utf-8/);
});
test('rejects likely credentials, provider relays and test payloads in public code',()=>{
 const candidate='sk-'+'testonly'.repeat(6);
 assert.equal(scanPublicText(candidate).includes('credential-pattern'),true);
 assert.equal(scanPublicText('https://unapproved.example.test/api/chat').includes('unapproved-provider-url'),true);
 assert.equal(scanPublicText('visual-project').includes('fixture-payload'),true);
});
test('permits direct approved destinations and key getter code without values',()=>{
 assert.deepEqual(scanPublicText('https://api.openai.com/v1/audio/transcriptions https://openrouter.ai/api/v1/models https://developers.openai.com/api/docs/pricing getProviderKey(providerId)'),[]);
});
test('does not print any matched sensitive value in the report',()=>{
 const candidate='sk-'+'testonly'.repeat(6);
 const report=scanPublicText(candidate).join(' ');
 assert.equal(report.includes(candidate),false);
});
