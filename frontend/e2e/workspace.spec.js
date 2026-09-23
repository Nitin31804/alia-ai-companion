import { expect, test } from '@playwright/test'


test('loads the real web and API containers with privacy controls', async ({ page, request }) => {
  const health = await request.get('/health')
  expect(health.ok()).toBeTruthy()
  expect((await health.json()).status).toBe('ok')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hey. How are you, really?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connected' })).toBeVisible()

  await page.getByRole('button', { name: 'Settings and privacy' }).first().click()
  await expect(page.getByRole('heading', { name: 'Your conversations & data' })).toBeVisible()
  await expect(page.getByText('I agree to this data processing.')).toBeVisible()
  await page.screenshot({ path: 'test-results/alia-dashboard.png', fullPage: true })
})
