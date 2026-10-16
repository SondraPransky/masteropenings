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
// Exportés : le proxy de la fonction Référence (lib/reference.js) construit l'URL
// de l'Edge Function et envoie la clé publishable en apikey (elle est publique).
export const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';

export const SUPABASE_CONFIGURED = (typeof supabase !== 'undefined') && !!supabase.createClient;

// ── DEV : sur localhost on saute la connexion et on coupe tout trafic Supabase ──
// (app 100% locale via localStorage). En prod (GitHub Pages) : auth normale.
// Pour tester le chemin connecté en local (gate), mettre DEV_SKIP_AUTH à false.
// `?auth=1` force le vrai parcours de connexion en local (tests E2E de la page
// de login, qui étaient sinon impossibles : la page n'apparaît jamais en local).
export const DEV_SKIP_AUTH = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  && new URLSearchParams(location.search).get('auth') !== '1';

export const sb = (SUPABASE_CONFIGURED && !DEV_SKIP_AUTH)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
