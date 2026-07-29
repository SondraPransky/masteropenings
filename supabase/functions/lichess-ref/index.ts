// ══════════════════════════════════════════════════════
// Edge Function : lichess-ref — PROXY de l'explorateur d'ouvertures Lichess
// (base MAÎTRES), avec le token Lichess ajouté CÔTÉ SERVEUR.
//
// Pourquoi : `explorer.lichess.ovh/masters` renvoie 401 aux appels du client
// (quota/abus par IP). On ne peut pas mettre le token dans le code client (site
// public → fuite du token). Le proxy porte le token (secret Supabase) et sert la
// réponse au SPA. Ne manipule QUE des données publiques d'échecs — aucune donnée
// utilisateur → déployé sans vérification JWT.
//
// Déploiement (une fois, côté Supabase — c'est TOI qui gères Supabase) :
//   1. Poser le secret (ton token Lichess général) :
//        supabase secrets set LICHESS_TOKEN=xxxxxxxx --project-ref smoftbuyejoyxlonhjcu
//   2. Déployer la fonction (--no-verify-jwt : appelable depuis le SPA public) :
//        supabase functions deploy lichess-ref --no-verify-jwt --project-ref smoftbuyejoyxlonhjcu
//
// Vérif rapide (doit renvoyer du JSON, pas un 401) :
//   curl "https://smoftbuyejoyxlonhjcu.supabase.co/functions/v1/lichess-ref?fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR%20w%20KQkq%20-%200%201&moves=3"
// ══════════════════════════════════════════════════════

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  try {
    const url = new URL(req.url);
    const token = Deno.env.get('LICHESS_TOKEN') || '';

    // Route « ?game=<id> » : PGN d'une partie (repli si l'appel direct du client est
    // bloqué). L'API principale lichess.org accepte le même token.
    const gameId = url.searchParams.get('game');
    if (gameId) {
      const gh: Record<string, string> = { Accept: 'application/x-chess-pgn' };
      if (token) gh.Authorization = `Bearer ${token}`;
      const gr = await fetch(
        `https://lichess.org/game/export/${encodeURIComponent(gameId)}?moves=true&tags=true&clocks=false&evals=false`,
        { headers: gh },
      );
      const gbody = await gr.text();
      return new Response(gbody, {
        status: gr.status,
        headers: { ...CORS, 'Content-Type': 'application/x-chess-pgn', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    const fen = url.searchParams.get('fen');
    if (!fen) return json({ error: 'missing fen' }, 400);

    // On ne relaie que ce dont le panneau a besoin (bornes fixes = pas d'abus).
    const moves = url.searchParams.get('moves') || '12';
    const topGames = url.searchParams.get('topGames') || '6';
    const q = new URLSearchParams({ fen, moves, topGames });

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const r = await fetch(`https://explorer.lichess.ovh/masters?${q.toString()}`, { headers });
    const body = await r.text();

    // On répercute le statut de Lichess (le client a déjà son repli « base
    // indisponible » sur un non-2xx). Cache 24h : une stat d'ouverture ne bouge pas.
    return new Response(body, {
      status: r.status,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
});
