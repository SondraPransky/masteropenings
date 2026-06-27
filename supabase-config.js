// ════════════════════════════════════════════════════════════
//  CONFIGURATION SUPABASE — couche données (fondation, en cours)
//  La clé « publishable » est PUBLIQUE (protégée par RLS, comme l'apiKey
//  Firebase) → OK à committer. NE JAMAIS mettre ici une clé « secret ».
//
//  L'app tourne ENCORE sur Firebase. Le client `sb` est créé mais dormant ;
//  le passage Firebase→Supabase se fera fonction par fonction (migration).
// ════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://smoftbuyejoyxlonhjcu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Bn0asUgcNYPYA1wnl9bokw_k1xshFC4';

// Détection : la lib CDN @supabase/supabase-js expose le global `supabase`.
const SUPABASE_CONFIGURED =
  (typeof supabase !== 'undefined') && !!supabase.createClient;

// Client global `sb` (null si la lib n'est pas chargée).
const sb = SUPABASE_CONFIGURED
  ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
