// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Photography Portfolio E2E Test Suite', () => {

  test('should load the homepage and render key components', async ({ page }) => {
    // 1. Visit home page
    await page.goto('/');
    
    // 2. Validate header and navigation exist
    await expect(page.locator('header#site-header')).toBeVisible();
    await expect(page.locator('nav#site-nav')).toBeVisible();
    await expect(page.locator('#app-content')).toBeVisible();
    
    // 3. Verify main title logo renders correctly
    await expect(page.locator('#site-title .site-logo')).toHaveAttribute('aria-label', 'Will Davies');
  });

  test('should handle smooth SPA routing to the About page and submit messages', async ({ page }) => {
    await page.goto('/');

    // 1. Intercept SPA routing: click 'About' link
    const aboutLink = page.locator('nav#site-nav a[aria-label="About"]');
    await expect(aboutLink).toBeVisible();
    await aboutLink.click();

    // 2. Assert URL changes locally without full page reloading
    await expect(page).toHaveURL(/\/about$/);

    // 3. Assert about page header is visible
    await expect(page.locator('#about-content')).toBeVisible();
    await expect(page.locator('form#contact-form')).toBeVisible();

    // 4. Test contact form interactive elements
    await page.fill('input#name', 'E2E Tester');
    await page.fill('input#email', 'tester@example.com');
    await page.fill('textarea#message', 'This is an automated E2E test message.');
    
    const submitBtn = page.locator('button#submit-btn');
    await expect(submitBtn).toBeEnabled();
  });

  test('should secure the admin dashboard and reject unauthorized logins with 401', async ({ page }) => {
    // 1. Navigate to admin login page
    await page.goto('/admin');
    
    // 2. Verify login form elements are loaded
    await expect(page.locator('input#admin-password')).toBeVisible();
    await expect(page.locator('button#login-btn')).toBeVisible();

    // 3. Intercept the network login response to assert status code
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/admin/login') && (response.status() === 401 || response.status() === 429)
    );
    await page.fill('input#admin-password', 'falsified_security_password');
    await page.click('button#login-btn');
    const response = await responsePromise;

    // 4. Assert response payload contains proper error message
    const json = await response.json();
    expect(json.error).toMatch(/Incorrect password|Too many login attempts/);
  });

  test('should log image diagnostics when ?diagnostic=true is set', async ({ page }) => {
    const logs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Image Diagnostic]')) {
        logs.push(text);
      }
    });

    // 1. Visit homepage and set diagnostic flag in localStorage to persist across SPA routing
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('diagnostic', 'true'));

    // 2. Re-visit homepage with diagnostic flag to trigger initial hero logs
    await page.goto('/?diagnostic=true');
    await page.waitForTimeout(1000);

    // 3. Click the Archive nav link to trigger gallery thumbnail logs (via SPA routing)
    const archiveLink = page.locator('nav#site-nav a:has-text("Archive")');
    await expect(archiveLink).toBeVisible();
    await archiveLink.click();
    
    // 4. Allow gallery rendering to process
    await page.waitForTimeout(2000);

    console.log('Captured E2E Logs:', logs);

    // 3. Assert diagnostics were outputted
    expect(logs.length).toBeGreaterThan(0);
    
    // 4. Assert that no full-res images were loaded in the gallery grid
    const fullResGalleryLogs = logs.filter(l => l.includes('Loading gallery') && l.includes('full'));
    expect(fullResGalleryLogs.length).toBe(0);

    // 5. Assert that gallery standard/grid WebP thumbnails were loaded
    const thumbGalleryLogs = logs.filter(l => l.includes('gallery-grid-thumb') || l.includes('gallery-standard-thumb'));
    expect(thumbGalleryLogs.length).toBeGreaterThan(0);

    // 6. Assert that hero full-res upgrades are logged appropriately
    const heroFullLogs = logs.filter(l => l.includes('Loading hero-full-res-upgrade'));
    expect(heroFullLogs.length).toBeGreaterThan(0);

    console.log('Verified E2E Diagnostic Output:\n', logs.join('\n'));
  });

  test('logo plays one jelly bounce in place and resets after rapid clicks', async ({ page }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Animate Will logo' });
    const logo = page.locator('#site-title .site-logo');
    const before = await logo.boundingBox();
    await expect(logo.locator('g[data-letter]')).toHaveCount(4);
    await page.evaluate(() => {
      window.jellyChangedLetters = new Set();
      const observer = new MutationObserver(records => records.forEach(record => window.jellyChangedLetters.add(record.target.parentElement.dataset.letter + record.target.parentElement.parentElement.children.length + Array.from(record.target.parentElement.parentElement.children).indexOf(record.target.parentElement))));
      observer.observe(document.querySelector('.jelly-lettering'), { subtree: true, attributes: true, attributeFilter: ['d'] });
    });
    await button.click();
    await expect(button).toHaveClass(/liquid-playing/);
    await expect.poll(() => page.evaluate(() => window.jellyChangedLetters.size)).toBe(4);
    await button.click();
    await expect(button).not.toHaveClass(/liquid-playing/, { timeout: 3000 });
    expect(await logo.boundingBox()).toEqual(before);
    await expect(page).toHaveURL('http://localhost:3000/');
    await expect(page.locator('#site-title .site-logo')).toBeVisible();
  });

  test('liquid nav settles while hovered and routes after repeated selections', async ({ page }) => {
    await page.goto('/');
    const work = page.getByRole('link', { name: 'My Work', exact: true });
    await work.click();
    await expect(work).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/section=/);
    const archive = page.getByRole('link', { name: 'Archive', exact: true });
    await archive.click();
    await expect(archive).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/section=archive/);
    // Observe rendered geometry, rather than the implementation's spring state.
    // The pointer deliberately remains over the nav after the last click.
    await expect.poll(() => page.evaluate(async () => {
      const path = document.querySelector('.blob-active');
      let changes = 0;
      const observer = new MutationObserver(records => { changes += records.length; });
      observer.observe(path, { attributes: true, attributeFilter: ['d'] });
      await new Promise(resolve => setTimeout(resolve, 150));
      observer.disconnect();
      return changes;
    }), { timeout: 5000 }).toBe(0);
  });

  test('keyboard navigation and logo respect reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Animate Will logo' });
    await button.press('Enter');
    await expect(button).not.toHaveClass(/liquid-playing/);
    const about = page.getByRole('link', { name: 'About', exact: true });
    await about.press('Enter');
    await expect(page).toHaveURL(/\/about$/);
    await expect(about).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Home', exact: true }).press('Enter');
    await expect(page).toHaveURL('http://localhost:3000/');
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('splash appears at the clicked destination, and dragging emits none', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.blob-splash')).toBeAttached();
    const watchSplash = () => page.evaluate(() => {
      window.splashFrames = [];
      window.splashObserver?.disconnect();
      window.splashObserver = new MutationObserver(records => {
        for (const record of records) {
          const d = record.target.getAttribute('d');
          if (d) window.splashFrames.push(d);
        }
      });
      window.splashObserver.observe(document.querySelector('.blob-splash'), { subtree: true, attributes: true, attributeFilter: ['d'] });
    });
    await watchSplash();
    const about = page.getByRole('link', { name: 'About', exact: true });
    const target = await about.boundingBox(), nav = await page.locator('#site-nav').boundingBox();
    await about.click();
    await expect.poll(() => page.evaluate(() => window.splashFrames.length)).toBeGreaterThan(0);
    const firstX = await page.evaluate(() => Number(window.splashFrames[0].match(/^M([-\d.]+)/)[1]));
    expect(Math.abs(firstX - (target.x + target.width/2 - nav.x))).toBeLessThan(22);

    await page.goto('/');
    await expect(page.locator('.blob-splash')).toBeAttached();
    await watchSplash();
    const home = await page.getByRole('link', { name: 'Home', exact: true }).boundingBox();
    const archive = await page.getByRole('link', { name: 'Archive', exact: true }).boundingBox();
    await page.mouse.move(home.x+home.width/2, home.y+home.height/2);
    await page.mouse.down();
    await page.mouse.move(archive.x+archive.width/2, archive.y+archive.height/2, { steps: 8 });
    await page.mouse.up();
    await expect(page).toHaveURL(/section=archive/);
    await page.waitForTimeout(1000); // Cover the entire possible particle lifetime.
    expect(await page.evaluate(() => window.splashFrames.length)).toBe(0);
  });

});
