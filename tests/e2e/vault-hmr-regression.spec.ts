import { clickAppAction } from './helpers';
// A separate Vite server and disposable vault reproduce development hot updates.
import { expect, test } from '@playwright/test';
import { createServer } from 'vite';

test('hot updates reuse the React root and release the prior vault owner before reopening or resetting', async ({ page },testInfo) => {
  const server=await createServer({root:process.cwd(),mode:'development',logLevel:'error',server:{host:'127.0.0.1',port:0}});
  await server.listen();
  const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('Missing Vite fixture address');
  const errors:string[]=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const phrase='SYNTHETIC_HMR_REOPEN_A1!';
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByLabel('암호',{exact:true}).fill(phrase);await page.getByLabel('암호 확인',{exact:true}).fill(phrase);
    await page.getByRole('button',{name:'보관함 만들기',exact:true}).click();
    await expect(page.getByRole('heading',{name:'음성 메모',exact:true})).toBeVisible();
    await page.evaluate(async()=>{
      const path='/@vite/client',client=await import(/* @vite-ignore */path);
      const marker=document.createElement('output');marker.id='synthetic-hmr-probe';marker.dataset.updates='0';document.body.append(marker);
      client.createHotContext('/synthetic-hmr-probe').on('vite:afterUpdate',()=>{marker.dataset.updates=String(Number(marker.dataset.updates)+1);});
    });
    const entry=server.moduleGraph.getModuleById(process.cwd()+'/src/react-app/main.tsx');if(!entry)throw Error('Missing entry module');
    for(let update=1;update<=2;update++){
      await server.reloadModule(entry);
      await expect(page.locator('#synthetic-hmr-probe')).toHaveAttribute('data-updates',String(update));
      expect(errors.filter(message=>message.includes('createRoot'))).toEqual([]);
      await expect(page.getByRole('heading',{name:'암호로 잠금 해제',exact:true})).toBeVisible();
      await page.getByLabel('암호',{exact:true}).fill(phrase);await page.getByRole('button',{name:'잠금 해제',exact:true}).click();
      await expect(page.getByRole('heading',{name:'음성 메모',exact:true})).toBeVisible();
    }
    await clickAppAction(page, '지금 잠그기');
    await page.getByRole('button',{name:'이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('textbox').fill('delete');
    await page.screenshot({path:testInfo.outputPath('hmr-reset-confirmation.png'),fullPage:true});
    await dialog.getByRole('button',{name:'보관함 데이터 영구 삭제',exact:true}).click();
    await expect(page.getByRole('heading',{name:'새 보관함 만들기',exact:true})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('hmr-reset-complete.png'),fullPage:true});
  } finally {await server.close();}
});
