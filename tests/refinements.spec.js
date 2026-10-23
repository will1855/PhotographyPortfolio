const {test,expect}=require('@playwright/test');

test('work captions fit desktop and mobile and images have responsive sources',async({page})=>{
 for(const width of [1280,820,390]){
  await page.setViewportSize({width,height:850});
  await page.goto('/?section=mywork');
  await expect(page.locator('.work-item-caption').first()).toBeAttached();
  await page.waitForTimeout(100); // Allow the layout-fit animation frame.
  const outside=await page.locator('.work-item-caption').evaluateAll(elements=>elements.filter(e=>{
   const range=document.createRange();range.selectNodeContents(e);const r=range.getBoundingClientRect();
   return r.left < -1 || r.right > document.documentElement.clientWidth+1;
  }).map(e=>e.textContent));
  expect(outside).toEqual([]);
  const image=page.locator('#gallery img').first();
  await expect(image).toHaveAttribute('srcset',/600w.*1600w/);
  await expect(image).toHaveAttribute('sizes',/90vw/);
 }
});

test('paired rows preserve captions and stack on mobile',async({page,request})=>{
 const data=await (await request.get('/api/images?section=archive')).json();
 const items=data.slice(0,2).map((image,i)=>({id:'paired-'+i,type:'image',imageId:image.id,width:42,offset:8,gap:20,caption:'Paired photo '+(i+1),captionPosition:'right',pairWithPrevious:i===1}));
 await page.route('**/api/layout?section=mywork',route=>route.fulfill({json:{layout:{version:2,items}}}));
 await page.setViewportSize({width:1280,height:850});await page.goto('/?section=mywork');
 const row=page.locator('.work-row--pair');await expect(row.locator('.work-item')).toHaveCount(2);
 let boxes=await row.locator('.work-item').evaluateAll(items=>items.map(e=>e.getBoundingClientRect().toJSON()));
 expect(Math.abs(boxes[0].top-boxes[1].top)).toBeLessThan(2);expect(boxes[1].left).toBeGreaterThan(boxes[0].right);
 await expect(row.locator('.work-item-caption')).toHaveText(['Paired photo 1','Paired photo 2']);
 await page.setViewportSize({width:390,height:850});
 boxes=await row.locator('.work-item').evaluateAll(items=>items.map(e=>e.getBoundingClientRect().toJSON()));
 expect(boxes[1].top).toBeGreaterThan(boxes[0].bottom);
 expect(boxes.every(r=>r.left>=0&&r.right<=390)).toBeTruthy();
});

test('configuration outage keeps visible navigation and a usable About shell',async({page})=>{
 await page.route('http://localhost:3000/',async route=>{
  const response=await route.fetch();const body=(await response.text()).replace(/<script>window\.INITIAL_DATA = [\s\S]*?<\/script>/,'');
  await route.fulfill({response,body});
 });
 await page.route('**/api/site-config',route=>route.abort());await page.goto('/');
 await expect(page.locator('#site-nav svg')).toBeVisible();
 await expect(page.locator('#site-nav')).toHaveAttribute('data-blob-ready','true');
 await page.getByRole('link',{name:'About',exact:true}).click();
 await expect(page.locator('#contact-form')).toBeVisible();
 await expect(page.locator('#site-nav svg')).toBeVisible();
});

test('About form still submits with the new layout without sending a real inquiry',async({page})=>{
 let payload;
 await page.route('**/api/contact',async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{ok:true}})});
 await page.goto('/about');await expect(page.locator('.about-layout')).toBeVisible();
 await page.getByLabel('Name',{exact:true}).fill('Local test');await page.getByLabel('Email',{exact:true}).fill('test@example.com');await page.getByLabel('Message',{exact:true}).fill('Intercepted locally');
 await page.getByRole('button',{name:'Send Message',exact:true}).click();await expect(page.locator('#form-status')).toContainText('successfully');
 expect(payload).toEqual({name:'Local test',email:'test@example.com',message:'Intercepted locally'});
});

test('editor can pair, save and unpair without a database migration',async({page,request})=>{
 const config=await (await request.get('/api/site-config')).json();
 const images=await (await request.get('/api/images?section=archive')).json();
 const items=images.slice(0,2).map((image,i)=>({id:'editor-'+i,type:'image',imageId:image.id,width:42,offset:8,gap:20,caption:image.title||'Photo',captionPosition:'below'}));
 let saved;
 await page.route('**/api/admin/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{ok:true}});
  if(path.endsWith('/sections'))return route.fulfill({json:config.sections});
  if(path.endsWith('/images'))return route.fulfill({json:images});
  if(path.endsWith('/layout')){saved=route.request().postDataJSON();return route.fulfill({json:{ok:true}})}
  return route.fulfill({json:[]});
 });
 await page.route('**/api/layout?*',route=>route.fulfill({json:{layout:{version:2,items}}}));
 await page.goto('/admin');await page.locator('[data-panel="work"]').click();
 const arrangement=page.getByLabel('Row arrangement for image 2');
 await arrangement.selectOption('pair');
 await expect(page.locator('.work-preview-row--pair')).toHaveCount(1);
 await page.locator('#work-save-btn').click();
 await expect.poll(()=>saved?.layout.items[1].pairWithPrevious).toBe(true);
 expect(saved.layout.version).toBe(2);
 await page.getByLabel('Row arrangement for image 2').selectOption('single');
 await expect(page.locator('.work-preview-row--pair')).toHaveCount(0);
});

test('liquid navigation hides fallback labels even with a previously cached module',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#site-nav .blob-svg')).toBeVisible();
 const geometry=()=>page.locator('#site-nav .blob-link').evaluateAll(links=>links.map(link=>{
  const text=link.querySelector('.sr-only');const style=getComputedStyle(text);
  return {width:link.getBoundingClientRect().width,hidden:style.position==='absolute'&&style.overflow==='hidden'};
 }));
 const ready=await geometry();expect(ready.every(link=>link.hidden)).toBe(true);
 // The previous release's cached module draws the SVG but never sets this flag.
 await page.locator('#site-nav').evaluate(nav=>nav.removeAttribute('data-blob-ready'));
 expect(await geometry()).toEqual(ready);
 await page.getByRole('link',{name:'About',exact:true}).click();
 await expect(page.locator('.about-biography')).toBeVisible();
 expect((await geometry()).every(link=>link.hidden)).toBe(true);
});
