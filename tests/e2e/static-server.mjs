// Serveur statique minimal (zéro dépendance) pour les tests E2E Playwright.
// Sert le dossier du projet tel qu'il sera déployé (l'app reste sans build).
// Lancé automatiquement par Playwright via `webServer` (voir playwright.config.js).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.E2E_PORT) || 5175;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    // Anti path-traversal : on retire les segments qui remontent.
    const safe = normalize(p).replace(/^([/\\]|\.\.[/\\])+/, '');
    const body = await readFile(join(ROOT, safe));
    res.writeHead(200, { 'Content-Type': MIME[extname(safe)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
  }
}).listen(PORT, () => console.log(`[e2e] serveur statique → http://localhost:${PORT}`));
