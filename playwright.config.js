import { defineConfig, devices } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

// Mini-chargeur .env (sans dépendance) : renseigne E2E_EMAIL / E2E_PASSWORD
// pour les tests authentifiés. Le fichier .env est gitignoré.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.E2E_PORT) || 5175;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/static-server.mjs',
    url: BASE,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
    timeout: 30_000,
  },
  projects: [
    // Tests PUBLICS (page de login) — aucun compte requis. → `npm run test:e2e:public`
    { name: 'public', testMatch: /\.public\.spec\.js/, use: { ...devices['Desktop Chrome'] } },

    // Connexion via un compte de test (E2E_EMAIL / E2E_PASSWORD) → sauvegarde la session.
    { name: 'setup', testMatch: /auth\.setup\.js/, use: { ...devices['Desktop Chrome'] } },

    // Tests AUTHENTIFIÉS — réutilisent la session sauvegardée par `setup`.
    {
      name: 'authed',
      testMatch: /\.authed\.spec\.js/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/user.json' },
    },
  ],
});
