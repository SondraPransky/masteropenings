import { defineConfig } from 'vite';
import { copyFileSync } from 'node:fs';

// EECoach — build Vite (modules ES).
// base './' = chemins relatifs → déployable sous un sous-répertoire (GitHub Pages projet).
// Les vendors chess.js + @supabase/supabase-js restent chargés en CDN (globals
// window.Chess / window.supabase) : dans un module ES, un identifiant non déclaré
// se résout sur globalThis, donc `new Chess()` / `supabase.createClient` fonctionnent
// sans import ni interop. On pourra les npm-ifier plus tard.
//
// home.html + data.js = page marketing AUTONOME (ne charge pas app.js). On la laisse
// hors du pipeline HTML de Vite (son <script src="data.js"> classique n'est pas un
// module) et on la copie telle quelle dans dist/ après le build.
export default defineConfig({
  base: './',
  server: { port: 5174 },
  preview: { port: 5174 },
  build: {
    outDir: 'dist',
    target: 'es2020',
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'copie-page-marketing',
      closeBundle() {
        copyFileSync('home.html', 'dist/home.html');
        copyFileSync('data.js', 'dist/data.js');
      },
    },
  ],
});
