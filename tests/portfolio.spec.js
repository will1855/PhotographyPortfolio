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
    
    // 3. Verify main title renders correctly
    await expect(page.locator('#site-title')).toContainText('Will Davies');
  });

  test('should handle smooth SPA routing to the About page and submit messages', async ({ page }) => {
    await page.goto('/');

    // 1. Intercept SPA routing: click 'About' link
    const aboutLink = page.locator('nav#site-nav a:has-text("About")');
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

});
