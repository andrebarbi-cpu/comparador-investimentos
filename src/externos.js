// ETFs que não aparecem no arquivo de cotações da B3 (COTAHIST só traz o mercado à vista de ações;
// ETFs de renda fixa ficam de fora). Histórico diário de fechamento pelo Yahoo Finanças, fonte não
// oficial, só para esses tickers.
import { log } from './util.js';
import { transacao } from './db.js';

export const ETFS_EXTERNOS = ['AUPO11'];

export async function atualizarEtfsExternos(db) {
  // Só pregões já fechados oficialmente: o dia em andamento entra pelos preços parciais
  const ultimaOficial = db.prepare("SELECT max(data) d FROM cotacoes WHERE ticker = 'BOVA11' AND parcial IS NULL").get().d;
  const ins = db.prepare(`INSERT OR REPLACE INTO cotacoes (ticker, data, abertura, maxima, minima, fechamento, volume, negocios)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`);
  const insTicker = db.prepare(`INSERT INTO tickers (ticker, classe, tipo, nome) VALUES (?, 'ETF', 'etf', ?)
    ON CONFLICT(ticker) DO UPDATE SET nome = excluded.nome`);
  for (const tk of ETFS_EXTERNOS) {
    const temHistorico = db.prepare('SELECT count(*) n FROM cotacoes WHERE ticker = ?').get(tk).n > 0;
    const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${tk}.SA?range=${temHistorico ? '1mo' : '5y'}&interval=1d`,
      { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(60000) });
    if (!resp.ok) throw new Error(`${tk}: HTTP ${resp.status}`);
    const r = (await resp.json()).chart?.result?.[0];
    if (!r?.timestamp) throw new Error(`${tk}: sem dados`);
    const q = r.indicators.quote[0];
    let n = 0;
    transacao(db, () => {
      insTicker.run(tk, r.meta.longName ?? r.meta.shortName ?? tk);
      r.timestamp.forEach((t, i) => {
        const data = new Date((t - 3 * 3600) * 1000).toISOString().slice(0, 10);
        if (q.close[i] == null || data > ultimaOficial) return;
        ins.run(tk, data, q.open[i], q.high[i], q.low[i], q.close[i], (q.volume[i] ?? 0) * q.close[i]);
        n++;
      });
    });
    log(`ETF externo ${tk}: ${n} fechamentos`);
  }
}
