// ══════════════════════════════════════════════════════
// Edge Function : student-brief — SYNTHÈSE RÉDIGÉE de l'assistant faiblesses.
//
// Reçoit le rapport STRUCTURÉ d'un élève (sorties de répertoire récurrentes +
// fautes tactiques, calculé côté client par lib/weakness-core.js) et demande à
// Claude un court bilan pédagogique en français, destiné au COACH (jamais montré
// tel quel à l'élève — décision 04/08). La clé API vit dans le secret Supabase,
// jamais côté client (patron lichess-ref).
//
// ⚠ Service PAYANT à l'usage → la fonction se déploie AVEC vérification JWT
// (« Verify JWT » COCHÉ, contrairement à lichess-ref) : seul un compte connecté
// peut appeler, donc dépenser. Le bouton « Générer le bilan » est côté coach.
//
// Déploiement (une fois, côté Supabase — c'est TOI qui gères Supabase) :
//   1. Créer une clé API sur console.anthropic.com, puis poser le secret :
//        supabase secrets set ANTHROPIC_API_KEY=sk-ant-… --project-ref smoftbuyejoyxlonhjcu
//   2. Déployer la fonction (SANS --no-verify-jwt) :
//        supabase functions deploy student-brief --project-ref smoftbuyejoyxlonhjcu
//   (ou via le dashboard : nouvelle fonction `student-brief`, « Verify JWT » coché,
//    coller ce fichier, poser le secret ANTHROPIC_API_KEY dans Settings → Secrets.)
//
// Coût : 1 appel = 1 bilan (~1-2 k tokens) → de l'ordre du centime avec Haiku.
// ══════════════════════════════════════════════════════

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY manquant (secret Supabase)' }, 500);

  try {
    const report = await req.json();
    // Garde-fou taille : le rapport est compact par construction ; on refuse un
    // payload anormal plutôt que de le facturer.
    const raw = JSON.stringify(report);
    if (raw.length > 20000) return json({ error: 'rapport trop volumineux' }, 413);

    const system = [
      'Tu es l\'assistant d\'un coach d\'échecs de club (élèves enfants/ados).',
      'On te donne le rapport structuré des faiblesses d\'un élève, calculé depuis',
      'les parties qu\'il a envoyées : sorties de répertoire (il quitte la théorie',
      'apprise) et fautes tactiques détectées au moteur (gaffes/erreurs, par phase).',
      'Rédige en français un court bilan pour le COACH (pas pour l\'élève) :',
      '— 3 à 6 phrases, concret et actionnable, sans flatterie ni remplissage ;',
      '— commence par la faiblesse la plus coûteuse ou la plus récurrente ;',
      '— propose 1 ou 2 axes de travail précis (réviser tel module à tel coup,',
      '  exercices tactiques sur telle phase) ;',
      '— notation française des pièces (C F T D R), majuscule aux noms d\'ouvertures',
      '  (la Scandinave, l\'Italienne) ;',
      '— si les données sont maigres (peu de parties analysées), dis-le simplement.',
      'Réponds par le bilan seul, sans titre ni préambule.',
    ].join('\n');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: 'Rapport de l\'élève :\n' + raw }],
      }),
    });
    if (!r.ok) {
      const err = await r.text();
      return json({ error: 'Anthropic ' + r.status + ' : ' + err.slice(0, 300) }, 502);
    }
    const out = await r.json();
    const text = (out.content || []).filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('\n').trim();
    if (!text) return json({ error: 'réponse vide' }, 502);
    return json({ text });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});
