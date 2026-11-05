// Proventos (dividendos, JCP, rendimentos) e eventos de ações (desdobramento, grupamento,
// bonificação) pela API pública de empresas listadas da B3.
//   GetListedSupplementCompany: nome de pregão, eventos e data de pagamento dos proventos recentes
//   GetListedCashDividends: histórico completo de proventos (data com e valor por ação), 120 por página
import { log } from './util.js';

const BASE = 'https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall';
// Versão do método de coleta: mudar este texto faz a próxima execução refazer a busca
const METODO = 'historico-completo-2026-11-05';
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

// Versão 2 da tabela de proventos: sem chave única, para guardar os lançamentos repetidos exatamente
// como a B3 publica (a B3SA tem 5 linhas iguais em 30/12/2025; a chave antiga juntava em 3).
// Cada busca apaga o período que veio e grava de novo, então rodar duas vezes não duplica.
export function criarTabelasProventos(db) {
  const versao = db.prepare("SELECT name FROM sqlite_master WHERE name = 'meta'").get()
    ? db.prepare("SELECT valor FROM meta WHERE chave = 'proventos_versao'").get()?.valor : null;
  if (versao !== '2') {
    db.exec('DROP TABLE IF EXISTS proventos');
    db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('proventos_versao', '2')").run();
  }
  db.exec(`CREATE TABLE IF NOT EXISTS proventos (
      codigo TEXT, classe TEXT, tipo TEXT, data_com TEXT, aprovado TEXT, valor REAL, preco_com REAL, pagamento TEXT);
    CREATE INDEX IF NOT EXISTS proventos_codigo ON proventos (codigo, classe, data_com);
    CREATE TABLE IF NOT EXISTS eventos_acoes (
      codigo TEXT, classe TEXT, tipo TEXT, fator REAL, data_com TEXT, aprovado TEXT,
      PRIMARY KEY (codigo, classe, tipo, data_com));`);
}

// Uma vez por dia. Empresa sem nenhum provento gravado ganha o histórico inteiro; as demais, só a 1ª
// página (os 120 lançamentos mais recentes), o que cobre mais de um ano em qualquer empresa.
export async function atualizarProventos(db, { completo = false } = {}) {
  criarTabelasProventos(db);
  const hoje = new Date().toISOString().slice(0, 10);
  const ultima = db.prepare("SELECT valor FROM meta WHERE chave = 'proventos_data'").get()?.valor;
  // A troca do método de coleta (METODO) força uma nova busca no mesmo dia, para corrigir a base já gravada
  const metodo = db.prepare("SELECT valor FROM meta WHERE chave = 'proventos_metodo'").get()?.valor;
  if (!completo && ultima === hoje && metodo === METODO) { log('Proventos já atualizados hoje'); return; }
  // Só prefixos negociados no último mês: códigos antigos (ELET, CCRO...) a B3 já não reconhece,
  // e o histórico deles aparece pelo código novo (AXIA, MOTV...)
  const codigos = db.prepare(`SELECT DISTINCT substr(t.ticker, 1, 4) c FROM tickers t
    WHERE t.tipo = 'acao' AND t.ticker IN (SELECT DISTINCT ticker FROM cotacoes WHERE data >= date('now', '-30 day'))
    ORDER BY c`).all().map(r => r.c);
  const comHistorico = new Set(db.prepare('SELECT DISTINCT codigo FROM proventos').all().map(r => r.codigo));
  log(`Proventos da B3: ${codigos.length} empresas (histórico completo; ${codigos.filter(c => !comHistorico.has(c)).length} novas)`);

  const insProv = db.prepare(`INSERT INTO proventos (codigo, classe, tipo, data_com, aprovado, valor, preco_com, pagamento)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const pagamentoAntigo = db.prepare(`SELECT pagamento FROM proventos WHERE codigo = ? AND classe = ? AND tipo = ? AND data_com = ?
    AND abs(valor - ?) < 1e-9 AND pagamento IS NOT NULL LIMIT 1`);
  const insEvento = db.prepare(`INSERT OR REPLACE INTO eventos_acoes (codigo, classe, tipo, fator, data_com, aprovado) VALUES (?, ?, ?, ?, ?, ?)`);
  let feitas = 0, erros = 0, linhas = 0;
  const semCadastro = [];

  async function umaEmpresa(codigo) {
    const sup = (await chamar('GetListedSupplementCompany', { issuingCompany: codigo, language: 'pt-br' }))?.[0];
    if (!sup?.tradingName) { semCadastro.push(codigo); return; }
    // Sempre o histórico inteiro (de 1 a 8 páginas por empresa, ~30 s no total). A B3 ordena por classe,
    // todas as ON antes das PN: só com a 1ª página, a busca apagava e não regravava as PN (Itaú, Petrobras e
    // Bradesco ficaram com dividend yield zero na rotina de 05/11/2026)
    const tudo = true;
    // Data de pagamento só vem nos proventos recentes do complemento
    const pagamentos = new Map();
    for (const c of sup.cashDividends ?? []) {
      const classe = classeIsin(c.isinCode);
      if (classe) pagamentos.set(`${classe}|${dataIso(c.lastDatePrior)}|${c.label}|${numero(c.rate).toFixed(6)}`, dataIso(c.paymentDate));
    }
    // A B3 não acha o nome de pregão com "/" ("AMBEV S/A" volta vazio, "AMBEVSA" traz tudo)
    const nome = sup.tradingName.replace(/[^A-Za-z0-9]/g, '');
    const resultados = [];
    for (let pagina = 1; ; pagina++) {
      const r = await chamar('GetListedCashDividends', { language: 'pt-br', pageNumber: pagina, pageSize: 120, tradingName: nome });
      resultados.push(...(r?.results ?? []));
      if (!tudo || !r?.page?.totalPages || pagina >= r.page.totalPages) break;
    }
    const validos = resultados.map(p => ({ p, dataCom: dataIso(p.lastDatePriorEx), valor: numero(p.valueCash) }))
      .filter(x => x.dataCom && x.valor > 0);
    db.exec('BEGIN');
    try {
      if (validos.length) {
        // Troca o período coberto por esta busca (tudo, ou desde a data com mais antiga da 1ª página)
        const desde = tudo ? '0000' : validos.reduce((m, x) => (x.dataCom < m ? x.dataCom : m), '9999');
        const antigos = new Map();
        for (const x of validos) {
          const k = `${x.p.typeStock}|${x.p.corporateAction}|${x.dataCom}|${x.valor}`;
          if (!antigos.has(k)) antigos.set(k, pagamentoAntigo.get(codigo, x.p.typeStock, x.p.corporateAction, x.dataCom, x.valor)?.pagamento ?? null);
        }
        db.prepare('DELETE FROM proventos WHERE codigo = ? AND data_com >= ?').run(codigo, desde);
        for (const { p, dataCom, valor } of validos) {
          const pag = pagamentos.get(`${p.typeStock}|${dataCom}|${p.corporateAction}|${valor.toFixed(6)}`)
            ?? antigos.get(`${p.typeStock}|${p.corporateAction}|${dataCom}|${valor}`) ?? null;
          insProv.run(codigo, p.typeStock, p.corporateAction, dataCom, dataIso(p.dateApproval), valor, numero(p.closingPricePriorExDate), pag);
          linhas++;
        }
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
  log(`Proventos: ${feitas - semCadastro.length} empresas, ${linhas} registros${erros ? `, ${erros} com erro` : ''}`
    + (semCadastro.length ? `; sem cadastro na B3: ${semCadastro.join(', ')}` : ''));
  if (erros > codigos.length / 2) throw new Error(`B3 falhou em ${erros} de ${codigos.length} empresas`);
  db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('proventos_data', ?)").run(hoje);
  db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('proventos_metodo', ?)").run(METODO);
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
