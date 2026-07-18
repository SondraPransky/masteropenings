// ══════════════════════════════════════════════════════
// lib/supabase-client.js — client Supabase PARTAGÉ
//
// `sb` est utilisé par l'auth (reste dans app.js) ET par la couche d'accès
// données (lib/supabase-data.js) → il vit ici, importé par les deux, pour
// éviter une dépendance croisée.
//
// Clé « publishable » PUBLIQUE (protégée par RLS) → OK committée. Jamais de
// clé « secret » ici. `supabase` est un global CDN (chargé dans index.html) :
// dans un module ES, un identifiant non déclaré se résout sur globalThis.
// ══════════════════════════════════════════════════════
const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';

export const SUPABASE_CONFIGURED = (typeof supabase !== 'undefined') && !!supabase.createClient;

// ── DEV : sur localhost on saute la connexion et on coupe tout trafic Supabase ──
// (app 100% locale via localStorage). En prod (GitHub Pages) : auth normale.
// Pour tester le chemin connecté en local (gate), mettre DEV_SKIP_AUTH à false.
export const DEV_SKIP_AUTH = (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

export const sb = (SUPABASE_CONFIGURED && !DEV_SKIP_AUTH)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
