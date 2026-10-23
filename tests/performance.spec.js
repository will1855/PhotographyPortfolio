const {test,expect}=require('@playwright/test');
const pixel='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#303030"/></svg>';
async function mockPhotos(page,urls){await page.route('**/storage/v1/object/public/**',async route=>{urls.push(route.request().url());await route.fulfill({contentType:'image/svg+xml',body:pixel})})}
test('homepage never upgrades to originals and nav hover downloads only metadata',async({page})=>{
 const urls=[];await mockPhotos(page,urls);
 await page.goto('/');await expect(page.locator('.jelly-lettering')).toBeVisible();
 expect(await page.evaluate(()=>window.INITIAL_DATA.initial_images)).toBeUndefined();
 const originals=await page.evaluate(()=>window.INITIAL_DATA.sections.flatMap(s=>s.heroes||[]).map(h=>h.full_url));
 await page.waitForTimeout(1400); // Cover the former 800ms original-image upgrade.
 expect(urls.filter(url=>originals.includes(url))).toEqual([]);
 const before=urls.length;
 await page.getByRole('link',{name:'My Work',exact:true}).hover();await page.waitForTimeout(250);
 expect(urls.length).toBe(before);
});
test('repeated Work and About switches reuse metadata and never fetch an About document',async({page})=>{
 const urls=[];await mockPhotos(page,urls);let layoutRequests=0,aboutRequests=0;
 await page.route('**/api/layout?section=*',async route=>{layoutRequests++;await route.fulfill({json:{layout:null}})});
 await page.route('**/about',route=>{aboutRequests++;return route.abort()});
 await page.goto('/');
 await page.getByRole('link',{name:'My Work',exact:true}).click();await expect(page.locator('.work-item').first()).toBeAttached();
 await page.getByRole('link',{name:'About',exact:true}).click();await expect(page.locator('.about-biography')).toBeVisible();
 await page.getByRole('link',{name:'My Work',exact:true}).click();await expect(page.locator('.work-item').first()).toBeAttached();
 expect(layoutRequests).toBe(1);expect(aboutRequests).toBe(0);
 await page.goBack();await expect(page.locator('.about-biography')).toBeVisible();
});
test('metadata requests coalesce, retry failures and expire without persistent storage',async({page})=>{
 await page.goto('/about');let requests=0;
 await page.route('**/api/cache-test',async route=>{requests++;await new Promise(r=>setTimeout(r,80));await route.fulfill({status:requests===1?503:200,json:{ok:true}})});
 const result=await page.evaluate(async()=>{
  const {pageData}=await import('/js/pageData.js?v=1');
  const first=await Promise.allSettled([pageData('/api/cache-test'),pageData('/api/cache-test')]);
  await pageData('/api/cache-test');await pageData('/api/cache-test');
  const now=Date.now;try{Date.now=()=>now()+61000;await pageData('/api/cache-test')}finally{Date.now=now}
  return first.map(r=>r.status);
 });
 expect(result).toEqual(['rejected','rejected']);expect(requests).toBe(3);
});
test('logo hover deforms locally, settles and honours reduced motion',async({page})=>{
 await page.goto('/');const path=page.locator('.jelly-lettering [data-letter="w"] path').first();await expect(path).toBeAttached();
 const resting=await path.getAttribute('d');const box=await path.boundingBox();
 await page.mouse.move(box.x+box.width*.6,box.y+box.height*.4);
 await expect.poll(()=>path.getAttribute('d')).not.toBe(resting);
 await page.mouse.move(1,700);await expect.poll(()=>path.getAttribute('d')).toBe(resting);
 await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.move(box.x+box.width*.6,box.y+box.height*.4);
 await page.waitForTimeout(150);expect(await path.getAttribute('d')).toBe(resting);
});
