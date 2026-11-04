// Proventos (dividendos, JCP, rendimentos) e eventos de ações (desdobramento, grupamento,
// bonificação) pela API pública de empresas listadas da B3.
//   GetListedSupplementCompany: nome de pregão, eventos e data de pagamento dos proventos recentes
//   GetListedCashDividends: histórico completo de proventos (data com e valor por ação), 120 por página
import { log } from './util.js';

const BASE = 'https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const dataIso = br => (/^\d\d\/\d\d\/\d{4}$/.test(br ?? '') ? br.split('/').reverse().join('-') : null);
const numero = s => (s ? Number(String(s).replace(/\./g, '').replace(',', '.')) : null);
// Classe da ação pelo ISIN: BRITSAACNOR0 -> ON, BRITSAACNPR7 -> PN, BRBPACUNT006 -> UNT
const classeIsin = isin => (/CNOR/.test(isin) ? 'ON' : /CNPR/.test(isin) ? 'PN' : /CNPA/.test(isin) ? 'PNA'
  : /CNPB/.test(isin) ? 'PNB' : /UNT|CDAM/.test(isin) ? 'UNT' : null);
// Classe pelo código de negociação: ITSA4 -> PN, BPAC11 -> UNT
export const classeTicker = tk => ({ 3: 'ON', 4: 'PN', 5: 'PNA', 6: 'PNB', 11: 'UNT' }[tk.slice(4)] ?? null);

async function chamar(metodo, corpo, tentativas = 3) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await fetch(`${BASE}/${metodo}/${b64(corpo)}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tentativas) throw e;
      await new Promise(res => setTimeout(res, 1500 * i));
    }
  }
}

export function criarTabelasProventos(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS proventos (
      codigo TEXT, classe TEXT, tipo TEXT, data_com TEXT, aprovado TEXT, valor REAL, preco_com REAL, pagamento TEXT,
      PRIMARY KEY (codigo, classe, tipo, data_com, aprovado, valor));
    CREATE TABLE IF NOT EXISTS eventos_acoes (
      codigo TEXT, classe TEXT, tipo TEXT, fator REAL, data_com TEXT, aprovado TEXT,
      PRIMARY KEY (codigo, classe, tipo, data_com));`);
}

// Uma vez por dia. Na primeira vez (ou com completo) busca o histórico inteiro; depois, só a 1ª página.
export async function atualizarProventos(db, { completo = false } = {}) {
  criarTabelasProventos(db);
  const hoje = new Date().toISOString().slice(0, 10);
  const ultima = db.prepare("SELECT valor FROM meta WHERE chave = 'proventos_data'").get()?.valor;
  const vazio = db.prepare('SELECT count(*) n FROM proventos').get().n === 0;
  if (!completo && !vazio && ultima === hoje) { log('Proventos já atualizados hoje'); return; }
  const tudo = completo || vazio;
  const codigos = db.prepare(`SELECT DISTINCT substr(t.ticker, 1, 4) c FROM tickers t
    WHERE t.tipo = 'acao' AND t.cnpj IN (SELECT cnpj FROM indicadores) ORDER BY c`).all().map(r => r.c);
  log(`Proventos da B3: ${codigos.length} empresas${tudo ? ' (histórico completo)' : ''}`);

  const insProv = db.prepare(`INSERT INTO proventos (codigo, classe, tipo, data_com, aprovado, valor, preco_com, pagamento)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET preco_com = excluded.preco_com,
    pagamento = coalesce(excluded.pagamento, proventos.pagamento)`);
  const insEvento = db.prepare(`INSERT OR REPLACE INTO eventos_acoes (codigo, classe, tipo, fator, data_com, aprovado) VALUES (?, ?, ?, ?, ?, ?)`);
  let feitas = 0, erros = 0, linhas = 0;

  async function umaEmpresa(codigo) {
    const sup = (await chamar('GetListedSupplementCompany', { issuingCompany: codigo, language: 'pt-br' }))?.[0];
    if (!sup?.tradingName) return;
    // Data de pagamento só vem nos proventos recentes do complemento
    const pagamentos = new Map();
    for (const c of sup.cashDividends ?? []) {
      const classe = classeIsin(c.isinCode);
      if (classe) pagamentos.set(`${classe}|${dataIso(c.lastDatePrior)}|${c.label}|${numero(c.rate).toFixed(6)}`, dataIso(c.paymentDate));
    }
    const resultados = [];
    for (let pagina = 1; ; pagina++) {
      const r = await chamar('GetListedCashDividends', { language: 'pt-br', pageNumber: pagina, pageSize: 120, tradingName: sup.tradingName });
      resultados.push(...(r?.results ?? []));
      if (!tudo || !r?.page?.totalPages || pagina >= r.page.totalPages) break;
    }
    db.exec('BEGIN');
    try {
      for (const p of resultados) {
        const dataCom = dataIso(p.lastDatePriorEx), valor = numero(p.valueCash);
        if (!dataCom || !(valor > 0)) continue;
        const pag = pagamentos.get(`${p.typeStock}|${dataCom}|${p.corporateAction}|${valor.toFixed(6)}`) ?? null;
        insProv.run(codigo, p.typeStock, p.corporateAction, dataCom, dataIso(p.dateApproval), valor, numero(p.closingPricePriorExDate), pag);
        linhas++;
      }
      for (const ev of sup.stockDividends ?? []) {
        const classe = classeIsin(ev.isinCode), dataCom = dataIso(ev.lastDatePrior);
        if (classe && dataCom && /DESDOBRAMENTO|GRUPAMENTO|BONIFICACAO/.test(ev.label)) {
          insEvento.run(codigo, classe, ev.label, numero(ev.factor), dataCom, dataIso(ev.approvedOn));
        }
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // Quatro empresas por vez: rápido sem sobrecarregar a B3
  const fila = [...codigos];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (fila.length) {
      const c = fila.shift();
      try { await umaEmpresa(c); feitas++; } catch (e) { erros++; log(`Proventos ${c}: ${e.message}`); }
    }
  }));
  log(`Proventos: ${feitas} empresas, ${linhas} registros${erros ? `, ${erros} com erro` : ''}`);
  if (erros > codigos.length / 2) throw new Error(`B3 falhou em ${erros} de ${codigos.length} empresas`);
  db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('proventos_data', ?)").run(hoje);
}

// Fator acumulado de desdobramentos, grupamentos e bonificações depois de uma data: divide preços e
// proventos antigos por ele para ficarem na mesma base de ações de hoje.
export function fatorAte(eventos, data) {
  let f = 1;
  for (const ev of eventos) {
    if (ev.data_com < data) continue;
    // A data com é o último dia "com" o direito: o ajuste vale para tudo até ela, inclusive
    f *= ev.tipo === 'GRUPAMENTO' ? ev.fator : 1 + ev.fator / 100;
  }
  return f;
}
