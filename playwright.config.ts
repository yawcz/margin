import { defineConfig, devices } from '@playwright/test';
const port = 4318;
export default defineConfig({
  testDir: './tests',
  testMatch: '*.browser.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && node --import tsx tests/browser-server.ts',
    url: `http://127.0.0.1:${port}`,
    env: { PORT: String(port) },
    reuseExistingServer: false,
    timeout: 180000, // Includes a full tsc + vite build on a cold cache.
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
