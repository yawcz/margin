import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.browser.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4318', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && node --import tsx tests/browser-server.ts',
    url: 'http://127.0.0.1:4318',
    reuseExistingServer: false,
    timeout: 60000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'phone', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'tablet', use: { ...devices['iPad Mini'], browserName: 'chromium' } },
  ],
});
