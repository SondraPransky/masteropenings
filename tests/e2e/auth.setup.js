import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';

const authFile = 'tests/e2e/.auth/user.json';

// Connexion via un COMPTE DE TEST jetable, fourni en variables d'environnement
// (E2E_EMAIL / E2E_PASSWORD — voir .env.example). Sauvegarde la session Supabase
// pour que les tests *.authed.spec.js la réutilisent sans se reconnecter.
setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Tests authentifiés : renseigne E2E_EMAIL et E2E_PASSWORD (compte de test jetable) ' +
      'dans un fichier .env à la racine. Voir .env.example.'
    );
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-pwd').fill(password);
  await page.getByRole('button', { name: /Se connecter/ }).click();
  // Connexion réussie → le nom d'utilisateur apparaît dans la nav.
  await expect(page.locator('#nav-user')).toBeVisible({ timeout: 15_000 });

  fs.mkdirSync('tests/e2e/.auth', { recursive: true });
  await page.context().storageState({ path: authFile });
});
