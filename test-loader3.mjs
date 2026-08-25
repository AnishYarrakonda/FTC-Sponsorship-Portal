import { chromium } from 'playwright-core';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(6000);
  await browser.close();
})();
