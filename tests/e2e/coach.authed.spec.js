import { test, expect } from '@playwright/test';

// Nécessite E2E_EMAIL = compte PROF (session réutilisée depuis auth.setup.js).
// Exerce les parcours qui ont régressé aujourd'hui (📤 Partager, ➕ Ajouter un élève).
test.describe('Espace prof (authentifié)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#page-coach')).toBeVisible({ timeout: 15_000 });
  });

  test('tableau de bord coach + navigation latérale', async ({ page }) => {
    await expect(page.locator('#csnav-modules')).toBeVisible();
    await expect(page.locator('#csnav-eleves')).toBeVisible();
    await expect(page.locator('#csnav-classes')).toBeVisible();
  });

  test('onglet Modules : « 📤 Partager » sur une carte (ou état vide)', async ({ page }) => {
    await page.locator('#csnav-modules').click();
    const partager = page.locator('#csec-modules .mcard').first().getByRole('button', { name: /Partager/ });
    const emptyBtn = page.getByRole('button', { name: /premier module/i });
    // Soit un module existe (bouton Partager visible), soit l'état vide s'affiche.
    await expect(partager.or(emptyBtn).first()).toBeVisible({ timeout: 10_000 });
  });

  test('onglet Élèves : « ➕ Ajouter un élève » ouvre le formulaire cours particulier', async ({ page }) => {
    await page.locator('#csnav-eleves').click();
    await page.getByRole('button', { name: /Ajouter un élève/ }).first().click();
    // addStudent() bascule sur Classes en mode « cours particulier ».
    await expect(page.locator('#cls-form-title')).toContainText('Nouvel élève');
    await expect(page.locator('#inp-cls-individual')).toBeChecked();
    await expect(page.locator('#inp-cls-students')).toBeVisible();
  });
});
