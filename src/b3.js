// Cotações oficiais da B3 (arquivo COTAHIST, layout de largura fixa).
// Fonte: https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/
import { baixar, abrirZip, log } from './util.js';
import { transacao } from './db.js';

const BASE = 'https://bvmf.bmfbovespa.com.br/InstDados/SerHist';

// 02 = lote padrão (ações e units), 14 = ETFs e certificados
const BDI_ACEITOS = new Set(['02', '14']);

function lerLinha(l) {
  if (!l.startsWith('01') || l.slice(24, 27) !== '010') return null;
  const bdi = l.slice(10, 12);
  if (!BDI_ACEITOS.has(bdi)) return null;
  const fator = Number(l.slice(210, 217)) || 1;
  const preco = (a, b) => Number(l.slice(a, b)) / 100 / fator;
  const d = l.slice(2, 10);
  return {
    data: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    bdi,
    ticker: l.slice(12, 24).trim(),
    nome: l.slice(27, 39).trim(),
    abertura: preco(56, 69),
    maxima: preco(69, 82),
    minima: preco(82, 95),
    fechamento: preco(108, 121),
    negocios: Number(l.slice(147, 152)),
    volume: Number(l.slice(170, 188)) / 100,
  };
}

async function gravarArquivo(db, caminho) {
  const zip = abrirZip(caminho);
  const insCot = db.prepare(`INSERT OR REPLACE INTO cotacoes
    (ticker, data, abertura, maxima, minima, fechamento, volume, negocios) VALUES (?,?,?,?,?,?,?,?)`);
  // ETFs entram na tabela de tickers na primeira vez que aparecem
  const insEtf = db.prepare(`INSERT OR IGNORE INTO tickers (ticker, classe, tipo, nome) VALUES (?, 'ETF', 'etf', ?)`);
  let n = 0, ultimaData = null;
  db.exec('BEGIN');
  try {
    for await (const linha of zip.linhas(zip.nomes[0])) {
      const c = lerLinha(linha);
      if (!c) continue;
      insCot.run(c.ticker, c.data, c.abertura, c.maxima, c.minima, c.fechamento, c.volume, c.negocios);
      if (c.bdi === '14') insEtf.run(c.ticker, c.nome);
      n++;
      if (!ultimaData || c.data > ultimaData) ultimaData = c.data;
      if (n % 50000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { n, ultimaData };
}

// Histórico de um ano inteiro (arquivo anual)
export async function carregarAno(db, ano, { forcar = false } = {}) {
  const arq = await baixar(`${BASE}/COTAHIST_A${ano}.ZIP`, `b3/COTAHIST_A${ano}.ZIP`, { forcar });
  if (!arq) { log(`Cotações ${ano}: arquivo não encontrado`); return 0; }
  const { n, ultimaData } = await gravarArquivo(db, arq);
  log(`Cotações ${ano}: ${n.toLocaleString('pt-BR')} registros (até ${ultimaData})`);
  return n;
}

// Busca os pregões que faltam desde a última data gravada
export async function atualizarDiario(db) {
  // Preços parciais do dia não contam: o arquivo oficial daquele dia ainda precisa ser baixado
  // Referência no BOVA11: só ele garante que a data veio do arquivo oficial (ETFs externos e parciais não contam)
  const ult = db.prepare("SELECT MAX(data) d FROM cotacoes WHERE ticker = 'BOVA11' AND parcial IS NULL").get().d;
  const agora = new Date();
  if (!ult) return carregarAno(db, agora.getFullYear(), { forcar: true });

  const desde = new Date(ult + 'T12:00:00Z');
  const diasFaltando = Math.round((agora - desde) / 86400000);
  // Muito atrasado: mais rápido pegar os arquivos anuais, desde o ano do último pregão gravado
  // (uma parada que atravessa o Ano-Novo deixaria dezembro faltando se só o ano corrente fosse lido)
  if (diasFaltando > 25) {
    let n = 0;
    for (let a = Number(ult.slice(0, 4)); a <= agora.getFullYear(); a++) n += (await carregarAno(db, a, { forcar: true })) ?? 0;
    return n;
  }

  let total = 0;
  for (let d = new Date(desde.getTime() + 86400000); d <= agora; d = new Date(d.getTime() + 86400000)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const nome = `COTAHIST_D${dd}${mm}${d.getUTCFullYear()}.ZIP`;
    const arq = await baixar(`${BASE}/${nome}`, `b3/diario/${nome}`, { forcar: true });
    if (!arq) continue; // feriado ou arquivo do dia ainda não publicado
    const { n } = await gravarArquivo(db, arq);
    total += n;
    log(`Cotações ${d.toISOString().slice(0, 10)}: ${n} registros`);
  }
  if (!total) log('Cotações: nenhum pregão novo');
  // Parciais de dias que já têm fechamento oficial saem (o oficial já substituiu os mesmos tickers)
  db.prepare(`DELETE FROM cotacoes WHERE parcial = 1
    AND data <= (SELECT max(data) FROM cotacoes WHERE ticker = 'BOVA11' AND parcial IS NULL)`).run();
  return total;
}
