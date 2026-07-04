import { test, expect } from '@playwright/test';

// Page de connexion — AUCUN compte requis, AUCUN mot de passe saisi.
// Ces tests tournent sans identifiants (`npm run test:e2e:public`).
test.describe('Page de connexion (visiteur non connecté)', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/', { waitUntil: 'domcontentloaded' }); });

  test('affiche le formulaire de connexion', async ({ page }) => {
    await expect(page.locator('#page-login')).toBeVisible();
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-pwd')).toBeVisible();
    await expect(page.getByRole('button', { name: /Se connecter/ })).toBeVisible();
    // Non connecté → le nom d'utilisateur reste masqué dans la nav.
    await expect(page.locator('#nav-user')).toBeHidden();
  });

  test('bascule vers l’onglet « Créer un compte »', async ({ page }) => {
    await page.locator('#btn-tab-register').click();
    await expect(page.locator('#reg-email')).toBeVisible();
    await expect(page.locator('#reg-pseudo')).toBeVisible();
    await expect(page.locator('#login-email')).toBeHidden();
  });

  test('soumission vide → message d’erreur', async ({ page }) => {
    await page.getByRole('button', { name: /Se connecter/ }).click();
    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.locator('#login-error')).toContainText('Remplissez');
  });

  test('« Mot de passe oublié ? » sans email → invite à saisir l’email', async ({ page }) => {
    await page.getByRole('button', { name: /Mot de passe oublié/ }).click();
    await expect(page.locator('#login-error')).toContainText('Entrez');
  });
});
