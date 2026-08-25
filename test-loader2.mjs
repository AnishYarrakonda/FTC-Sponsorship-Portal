import { chromium } from 'playwright-core';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(6000); // Wait for loader to finish
  const html = await page.content();
  if (html.includes('Simplified')) {
    console.log('STUCK! "Simplified" is still in the DOM.');
  } else {
    console.log('SUCCESS! Loader disappeared.');
  }
  const isLoaderVisible = await page.evaluate(() => {
    return !!document.querySelector('.fixed.inset-0.z-\\[100\\]');
  });
  console.log('Loader element present in DOM:', isLoaderVisible);
  await browser.close();
})();
