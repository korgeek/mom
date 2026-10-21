import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './tests/e2e', timeout: 60000, expect: { timeout: 15000 },
 fullyParallel: false, workers: 1, retries: 0,
 reporter: [['list']],
 use: { baseURL: 'http://127.0.0.1:4174', viewport: { width:1440,height:900 },
  headless: false, channel:'chrome', actionTimeout:15000, launchOptions:{chromiumSandbox:true},
  screenshot:'only-on-failure', trace:'retain-on-failure', video:'off' },
 webServer: { command:'WRANGLER_LOG_PATH=/tmp/mom-e2e-wrangler.log npx vite preview --host 127.0.0.1 --port 4174',url:'http://127.0.0.1:4174',reuseExistingServer:false,timeout:30000 },
});
