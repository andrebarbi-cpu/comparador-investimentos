import { readFileSync, existsSync, mkdirSync, createWriteStream, statSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync, createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BRUTOS = join(RAIZ, '_brutos');

export function log(...args) {
  const hora = new Date().toLocaleTimeString('pt-BR');
  console.log(`[${hora}]`, ...args);
}

// Baixa um arquivo para _brutos/. Se já existe e `forcar` é falso, reaproveita.
// Devolve o caminho, ou null quando o servidor responde 404 (ex.: pregão que não houve).
export async function baixar(url, nome, { forcar = false, tentativas = 3 } = {}) {
  const destino = join(BRUTOS, nome);
  if (!forcar && existsSync(destino) && statSync(destino).size > 0) return destino;
  mkdirSync(dirname(destino), { recursive: true });
  for (let i = 1; i <= tentativas; i++) {
    try {
      // Sem limite de tempo, um servidor travado prende a execução até estourar os 40 min do GitHub
      const resp = await fetch(url, { signal: AbortSignal.timeout(10 * 60000) });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // Grava num temporário e só renomeia no fim: download interrompido não fica no cache como se fosse bom
      await pipeline(Readable.fromWeb(resp.body), createWriteStream(destino + '.tmp'));
      renameSync(destino + '.tmp', destino);
      return destino;
    } catch (e) {
      if (i === tentativas) throw new Error(`Falha ao baixar ${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

// Leitor mínimo de .zip (sem dependências). Os arquivos da CVM e da B3 usam deflate simples.
export function abrirZip(caminho) {
  const buf = readFileSync(caminho);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`Zip inválido: ${caminho}`);
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas = new Map();
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    entradas.set(buf.toString('latin1', p + 46, p + 46 + nLen), { metodo, tamanho, local });
    p += 46 + nLen + xLen + cLen;
  }
  const bruto = e => {
    const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    return buf.subarray(ini, ini + e.tamanho);
  };
  return {
    nomes: [...entradas.keys()],
    // Conteúdo inteiro como texto latin1 (para os CSVs da CVM, até ~60 MB)
    texto(nome) {
      const e = entradas.get(nome);
      if (!e) return null;
      const dados = e.metodo === 0 ? bruto(e) : inflateRawSync(bruto(e));
      return dados.toString('latin1');
    },
    // Fluxo de linhas, para arquivos grandes (COTAHIST anual passa de 1 GB descompactado)
    async *linhas(nome) {
      const e = entradas.get(nome);
      if (!e) return;
      const fonte = Readable.from([bruto(e)]);
      const fluxo = e.metodo === 0 ? fonte : fonte.pipe(createInflateRaw());
      let resto = '';
      for await (const pedaco of fluxo) {
        const partes = (resto + pedaco.toString('latin1')).split('\n');
        resto = partes.pop();
        yield* partes;
      }
      if (resto) yield resto;
    },
  };
}

// Zip remoto lido aos pedaços (HTTP Range): baixa só o índice e o arquivo pedido. A base da Susep tem
// 577 MB e a da Anatel 3,2 GB, mas o que interessa delas são poucos MB.
export async function abrirZipRemoto(url) {
  const UA = { 'user-agent': 'Mozilla/5.0' };
  const pedaco = async (ini, fim) => {
    for (let i = 1; i <= 3; i++) {
      try {
        const r = await fetch(url, { headers: { ...UA, range: `bytes=${ini}-${fim}` }, signal: AbortSignal.timeout(5 * 60000) });
        if (r.status !== 206) throw new Error(`HTTP ${r.status} (o servidor não aceitou leitura parcial)`);
        return Buffer.from(await r.arrayBuffer());
      } catch (e) {
        if (i === 3) throw new Error(`Falha ao ler ${url}: ${e.message}`);
        await new Promise(res => setTimeout(res, 3000 * i));
      }
    }
  };
  const cab = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(60000) });
  if (!cab.ok) throw new Error(`HTTP ${cab.status} ao consultar ${url}`);
  const tam = Number(cab.headers.get('content-length'));
  const cauda = await pedaco(Math.max(0, tam - 65557), tam - 1);
  let p = cauda.length - 22;
  while (p >= 0 && cauda.readUInt32LE(p) !== 0x06054b50) p--;
  if (p < 0) throw new Error(`Zip inválido: ${url}`);
  let n = cauda.readUInt16LE(p + 10), cdTam = cauda.readUInt32LE(p + 12), cdIni = cauda.readUInt32LE(p + 16);
  if (cdIni === 0xffffffff || n === 0xffff) { // ZIP64 (arquivos acima de 4 GB ou muitos membros)
    const z64 = Number(cauda.readBigUInt64LE(p - 20 + 8));
    const reg = await pedaco(z64, z64 + 55);
    n = Number(reg.readBigUInt64LE(32)); cdTam = Number(reg.readBigUInt64LE(40)); cdIni = Number(reg.readBigUInt64LE(48));
  }
  const cd = await pedaco(cdIni, cdIni + cdTam - 1);
  const membros = new Map();
  for (let i = 0, q = 0; i < n; i++) {
    const metodo = cd.readUInt16LE(q + 10);
    let comp = cd.readUInt32LE(q + 20), orig = cd.readUInt32LE(q + 24), local = cd.readUInt32LE(q + 42);
    const nl = cd.readUInt16LE(q + 28), xl = cd.readUInt16LE(q + 30), cl = cd.readUInt16LE(q + 32);
    for (let x = q + 46 + nl; x < q + 46 + nl + xl;) { // campo extra ZIP64 com os tamanhos de 64 bits
      const id = cd.readUInt16LE(x), sz = cd.readUInt16LE(x + 2);
      if (id === 1) {
        let k = x + 4;
        if (orig === 0xffffffff) { orig = Number(cd.readBigUInt64LE(k)); k += 8; }
        if (comp === 0xffffffff) { comp = Number(cd.readBigUInt64LE(k)); k += 8; }
        if (local === 0xffffffff) local = Number(cd.readBigUInt64LE(k));
      }
      x += 4 + sz;
    }
    membros.set(cd.toString('latin1', q + 46, q + 46 + nl), { metodo, comp, orig, local });
    q += 46 + nl + xl + cl;
  }
  return {
    nomes: [...membros.keys()],
    // Conteúdo de um membro como texto latin1 (só os bytes dele são baixados)
    async texto(nome, codificacao = 'latin1') {
      const m = membros.get(nome);
      if (!m) return null;
      const loc = await pedaco(m.local, m.local + 29);
      const ini = m.local + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
      const bruto = await pedaco(ini, ini + m.comp - 1);
      return (m.metodo === 0 ? bruto : inflateRawSync(bruto)).toString(codificacao);
    },
  };
}

// Divide uma linha de CSV com ';', respeitando aspas quando houver.
export function dividirCsv(linha) {
  if (linha.endsWith('\r')) linha = linha.slice(0, -1);
  if (!linha.includes('"')) return linha.split(';');
  const campos = [];
  let atual = '', dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentro && linha[i + 1] === '"') { atual += '"'; i++; } else dentro = !dentro;
    } else if (c === ';' && !dentro) { campos.push(atual); atual = ''; }
    else atual += c;
  }
  campos.push(atual);
  return campos;
}

// Percorre um CSV inteiro devolvendo objetos { coluna: valor }
export function* lerCsv(texto) {
  if (!texto) return;
  const linhas = texto.split('\n');
  const cab = dividirCsv(linhas[0]);
  for (let i = 1; i < linhas.length; i++) {
    if (!linhas[i] || linhas[i] === '\r') continue;
    const campos = dividirCsv(linhas[i]);
    const obj = {};
    for (let j = 0; j < cab.length; j++) obj[cab[j]] = campos[j];
    yield obj;
  }
}

export const hoje = () => new Date().toISOString().slice(0, 10);
export const anoAtual = () => new Date().getFullYear();
