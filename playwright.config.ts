import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, SESSION_FILE } from './e2e/env.js';

const SIZES = {
  desktop: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
  mobile: devices['Pixel 7'],
};

export default defineConfig({
  testDir: './e2e',
  outputDir: '.local/playwright/results',
  // Um banco e um servidor só: sem paralelismo.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { outputFolder: '.local/playwright/report', open: 'never' }]],
  // Baselines geradas no container oficial do Playwright (Linux); ver CONTRIBUTING.
  snapshotPathTemplate: '{testDir}/snapshots/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001 } },
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /\.setup\.ts$/ },
    ...(['desktop', 'mobile'] as const).flatMap((size) =>
      (['light', 'dark'] as const).map((colorScheme) => ({
        name: `${size}-${colorScheme}`,
        testMatch: /\.spec\.ts$/,
        dependencies: ['setup'],
        use: { ...SIZES[size], colorScheme, storageState: SESSION_FILE },
      })),
    ),
  ],
  webServer: {
    command: 'npx tsx e2e/serve.ts',
    url: `${BASE_URL}/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
