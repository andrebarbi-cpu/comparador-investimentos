// Servidor local mínimo para ver a página: npm run ver  ->  http://localhost:8123
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { RAIZ } from './util.js';

const SITE = join(RAIZ, 'site');
const PORTA = Number(process.env.PORT) || 8123;
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const caminho = normalize(join(SITE, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!caminho.startsWith(SITE)) { res.writeHead(403).end(); return; }
  const arquivo = caminho === SITE || caminho.endsWith('\\') || caminho.endsWith('/') ? join(caminho, 'index.html') : caminho;
  try {
    const conteudo = await readFile(arquivo);
    res.writeHead(200, { 'content-type': `${TIPOS[extname(arquivo)] ?? 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(conteudo);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
}).listen(PORTA, () => console.log(`Página em http://localhost:${PORTA}`));
