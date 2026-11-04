// Preços durante o pregão (15 min de atraso), só para a página não ficar no fechamento de ontem.
// Fonte não oficial (Yahoo Finanças): entra na tabela de cotações marcada como parcial e é
// substituída à noite pelo fechamento oficial da B3 (mesma chave ticker + data).
import { log } from './util.js';
import { transacao } from './db.js';

const URL_LOTE = 'https://query1.finance.yahoo.com/v7/finance/spark';
const POR_LOTE = 20;
const ETFS = ['IVVB11', 'WRLD11', 'BOVA11', 'AUVP11', 'AUPO11'];

// Tickers que importam: em cada empresa, o mais negociado de cada classe (ON, PN, UNIT) nos
// últimos 3 meses, mais os ETFs. Basta para recalcular valor de mercado e múltiplos.
function tickersRelevantes(db) {
  const linhas = db.prepare(`SELECT t.ticker, t.cnpj, t.classe, avg(c.volume) vol FROM tickers t
    JOIN cotacoes c ON c.ticker = t.ticker AND c.data >= date('now', '-90 day') AND c.parcial IS NULL
    WHERE t.tipo = 'acao' GROUP BY t.ticker`).all();
  const melhor = new Map();
  for (const l of linhas) {
    const chave = `${l.cnpj}|${l.classe}`;
    if (!melhor.has(chave) || l.vol > melhor.get(chave).vol) melhor.set(chave, l);
  }
  return [...new Set([...[...melhor.values()].map(l => l.ticker), ...ETFS])];
}

const dataEmSaoPaulo = segundos => new Date((segundos - 3 * 3600) * 1000).toISOString().slice(0, 10);

export async function atualizarIntraday(db) {
  const ultimaOficial = db.prepare("SELECT max(data) d FROM cotacoes WHERE ticker = 'BOVA11' AND parcial IS NULL").get().d;
  const tickers = tickersRelevantes(db);
  const cotacoes = [];
  let falhas = 0;
  for (let i = 0; i < tickers.length; i += POR_LOTE) {
    const lote = tickers.slice(i, i + POR_LOTE);
    try {
      const resp = await fetch(`${URL_LOTE}?symbols=${lote.map(t => `${t}.SA`).join(',')}&range=1d&interval=1d`,
        { headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      for (const r of json.spark?.result ?? []) {
        const m = r.response?.[0]?.meta;
        if (!m?.regularMarketPrice || !m.regularMarketTime) continue;
        cotacoes.push({
          ticker: r.symbol.replace(/\.SA$/, ''), data: dataEmSaoPaulo(m.regularMarketTime),
          preco: m.regularMarketPrice, maxima: m.regularMarketDayHigh ?? null, minima: m.regularMarketDayLow ?? null,
          volume: (m.regularMarketVolume ?? 0) * m.regularMarketPrice, hora: m.regularMarketTime,
        });
      }
    } catch (e) {
      falhas++;
      log(`Intraday: lote ${i / POR_LOTE + 1} falhou (${e.message})`);
    }
  }
  if (!cotacoes.length) throw new Error('nenhuma cotação recebida');

  // O dia do pregão é o do BOVA11; papéis sem negócio hoje às vezes voltam com data inventada e
  // preço antigo, então só vale cotação do mesmo dia. E só se for posterior ao último fechamento
  // oficial (em feriado o Yahoo devolve o último pregão, que já temos oficial).
  const pregao = cotacoes.find(c => c.ticker === 'BOVA11')?.data;
  const novas = pregao > ultimaOficial ? cotacoes.filter(c => c.data === pregao) : [];
  transacao(db, () => {
    db.exec('DELETE FROM cotacoes WHERE parcial = 1');
    const ins = db.prepare(`INSERT INTO cotacoes (ticker, data, abertura, maxima, minima, fechamento, volume, negocios, parcial)
      VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 1)`);
    for (const c of novas) ins.run(c.ticker, c.data, c.maxima, c.minima, c.preco, c.volume);
    const hora = novas.length ? new Date(Math.max(...novas.map(c => c.hora)) * 1000).toISOString() : null;
    db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('intraday_hora', ?)").run(hora);
  });
  log(`Intraday: ${novas.length} preços parciais de ${tickers.length} tickers${falhas ? ` (${falhas} lotes com falha)` : ''}`
    + (novas.length ? '' : ' — sem pregão novo desde o último fechamento oficial'));
  return novas.length;
}
