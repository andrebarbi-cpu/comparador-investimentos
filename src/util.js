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
