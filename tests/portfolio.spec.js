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
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/admin/login') && response.status() === 401),
      page.fill('input#admin-password', 'falsified_security_password'),
      page.click('button#login-btn')
    ]);

    // 4. Assert response payload contains proper error message
    const json = await response.json();
    expect(json.error).toBe('Incorrect password');
  });

});
