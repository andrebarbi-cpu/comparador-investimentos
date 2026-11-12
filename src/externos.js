// ETFs que não aparecem no arquivo de cotações da B3 (COTAHIST só traz o mercado à vista de ações;
// ETFs de renda fixa ficam de fora). Histórico diário de fechamento pelo Yahoo Finanças, fonte não
// oficial, só para esses tickers. O mesmo vale para os BDRs da carteira: o COTAHIST que lemos (lote
// padrão) deixou de trazer BDR em outubro de 2022.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log, RAIZ } from './util.js';
import { transacao } from './db.js';

export const ETFS_EXTERNOS = ['AUPO11'];

// BDRs acompanhados na aba Carteiras (config/carteiras.json, chave "bdrs")
export function bdrsAcompanhados() {
  const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'carteiras.json'), 'utf8'));
  return [...new Set(config.carteiras.flatMap(c => (c.bdrs ?? []).map(b => b.ticker)))];
}

// soNovos: só os códigos ainda sem histórico (BDR recém-incluído aparece já na atualização do pregão)
export async function atualizarEtfsExternos(db, { soNovos = false } = {}) {
  // Só pregões já fechados oficialmente: o dia em andamento entra pelos preços parciais
  const ultimaOficial = db.prepare("SELECT max(data) d FROM cotacoes WHERE ticker = 'BOVA11' AND parcial IS NULL").get().d;
  const ins = db.prepare(`INSERT OR REPLACE INTO cotacoes (ticker, data, abertura, maxima, minima, fechamento, volume, negocios)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`);
  const insTicker = db.prepare(`INSERT INTO tickers (ticker, classe, tipo, nome) VALUES (?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET nome = excluded.nome`);
  const lista = [...ETFS_EXTERNOS.map(tk => ({ tk, classe: 'ETF', tipo: 'etf' })), ...bdrsAcompanhados().map(tk => ({ tk, classe: 'BDR', tipo: 'bdr' }))];
  for (const { tk, classe, tipo } of lista) {
    // Preço parcial do pregão não conta como histórico
    const temHistorico = db.prepare('SELECT count(*) n FROM cotacoes WHERE ticker = ? AND parcial IS NULL').get(tk).n > 0;
    if (soNovos && temHistorico) continue;
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${tk}.SA?range=${temHistorico ? '1mo' : '5y'}&interval=1d`,
      { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) });
    if (!resp.ok) throw new Error(`${tk}: HTTP ${resp.status}`);
    const r = (await resp.json()).chart?.result?.[0];
    if (!r?.timestamp) throw new Error(`${tk}: sem dados`);
    const q = r.indicators.quote[0];
    let n = 0;
    transacao(db, () => {
      insTicker.run(tk, classe, tipo, r.meta.longName ?? r.meta.shortName ?? tk);
      r.timestamp.forEach((t, i) => {
        const data = new Date((t - 3 * 3600) * 1000).toISOString().slice(0, 10);
        if (q.close[i] == null || data > ultimaOficial) return;
        ins.run(tk, data, q.open[i], q.high[i], q.low[i], q.close[i], (q.volume[i] ?? 0) * q.close[i]);
        n++;
      });
    });
    log(`${classe} externo ${tk}: ${n} fechamentos`);
  }
}
