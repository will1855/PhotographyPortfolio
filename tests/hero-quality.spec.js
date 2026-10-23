const {test,expect}=require('@playwright/test');
const pixel='<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2560"><rect width="3840" height="2560" fill="#303030"/></svg>';
test('large and high-density screens select one sharp hero resource matching the preload',async({browser})=>{
 for(const deviceScaleFactor of [1,2]){
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor});
  const page=await context.newPage(),requests=[];
  await page.route('**/storage/v1/object/public/**',async route=>{requests.push(route.request().url());await route.fulfill({contentType:'image/svg+xml',body:pixel})});
  await page.goto('http://localhost:3000/');await page.locator('.jelly-lettering').waitFor();
  const image=page.locator('.hero-slide.active img');
  await expect.poll(()=>image.evaluate(img=>img.currentSrc)).toMatch(/-hero-v1-(2560|3840)\.webp/);
  const selection=await image.evaluate(img=>({src:img.currentSrc,srcset:img.srcset,sizes:img.sizes}));
  const preload=await page.locator('link[rel="preload"][as="image"]').evaluate(link=>({srcset:link.imageSrcset,sizes:link.imageSizes}));
  expect(preload).toEqual({srcset:selection.srcset,sizes:selection.sizes});
  await page.waitForTimeout(1100); // Former second-download upgrade delay.
  expect(requests.filter(url=>url===selection.src)).toHaveLength(1);
  const hero=await page.evaluate(()=>window.INITIAL_DATA.sections.flatMap(s=>s.heroes||[]).find(h=>h.srcset.includes(document.querySelector('.hero-slide.active img').currentSrc)));
  expect(requests).not.toContain(hero.full_url);
  expect(requests).not.toContain(hero.thumb_url);
  if(deviceScaleFactor===2&&selection.srcset.includes('3840w'))expect(selection.src).toContain('3840.webp');
  await context.close();
 }
});
test('client-created slideshow uses the same high-resolution sources and About does not preload a hero',async({page})=>{
 await page.route('**/storage/v1/object/public/**',route=>route.fulfill({contentType:'image/svg+xml',body:pixel}));
 await page.goto('/about');expect(await page.locator('link[rel="preload"][as="image"]').count()).toBe(0);
 await page.getByRole('link',{name:'Home',exact:true}).click();
 await expect(page.locator('.hero-slide.active img')).toHaveAttribute('srcset',/-hero-v1-2560/);
 await expect(page.locator('.hero-slide.active img')).toHaveAttribute('sizes',/min-aspect-ratio/);
});
