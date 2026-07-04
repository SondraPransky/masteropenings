import { test, expect } from '@playwright/test';

// Réutilise la session sauvegardée par auth.setup.js (compte de test).
// Valable prof OU élève : confirme que l'app reconnaît un utilisateur connecté.
test.describe('Session authentifiée', () => {
  test('utilisateur connecté : nav visible, hors page de login', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#nav-user')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#btn-logout')).toBeVisible();
    await expect(page.locator('#page-login')).toBeHidden();
  });

  // ── À étoffer (avec un compte PROF de test) ───────────────────────────────
  //  test('onglet Modules → bouton « 📤 Partager » sur une carte', ...)
  //  test('onglet Élèves → bouton « ➕ Ajouter un élève »', ...)
  //  test('parcours révision élève → une ligne dans `results`', ...)
});
