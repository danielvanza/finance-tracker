import { defineConfig } from '@playwright/test'

// `npx playwright test`: the chat, end to end, against the real backend and Telegram bot on throwaway
// databases. Run `npm run build` first; each spec starts what it needs (see e2e/fixtures.ts).
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 200_000 },
  reporter: [['list']],
  outputDir: './node_modules/.e2e-results',
  use: { timezoneId: 'Europe/Amsterdam', locale: 'en-GB', trace: 'retain-on-failure' },
})
