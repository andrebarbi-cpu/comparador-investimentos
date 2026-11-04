// Régua de comparação: juros, inflação e dólar (Banco Central) e taxas do Tesouro Direto.
import { readFileSync } from 'node:fs';
import { baixar, lerCsv, log } from './util.js';
import { transacao } from './db.js';

// Códigos das séries no SGS do Banco Central
const SERIES = {
  cdi: 12,          // % ao dia
  selic_meta: 432,  // % ao ano
  ipca: 433,        // % no mês
  ipca_12m: 13522,  // % acumulado em 12 meses
  dolar: 1,         // PTAX venda, R$
};

const br = iso => iso.split('-').reverse().join('/');
const iso = br => br.split('/').reverse().join('-');

export async function atualizarBcb(db, anoInicio) {
  const erros = [];
  // Uma série com problema não impede as outras
  for (const [serie, cod] of Object.entries(SERIES)) {
    try { await atualizarSerie(db, serie, cod, anoInicio); }
    catch (e) { erros.push(`${serie} (${e.message})`); }
  }
  if (erros.length) throw new Error(`séries com falha: ${erros.join(', ')}`);
}

async function atualizarSerie(db, serie, cod, anoInicio) {
  const ins = db.prepare('INSERT OR REPLACE INTO macro (serie, data, valor) VALUES (?, ?, ?)');
  const hojeIso = new Date().toISOString().slice(0, 10);
  const ult = db.prepare('SELECT MAX(data) d FROM macro WHERE serie = ?').get(serie).d;
  let inicio = ult ? new Date(Date.parse(ult) + 86400000).toISOString().slice(0, 10) : `${anoInicio}-01-01`;
  let n = 0;
  // A API limita consultas de séries diárias a 10 anos; vamos de ano em ano
  while (inicio <= hojeIso) {
    const fimAno = `${inicio.slice(0, 4)}-12-31`;
    const fim = fimAno < hojeIso ? fimAno : hojeIso;
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cod}/dados?formato=json&dataInicial=${br(inicio)}&dataFinal=${br(fim)}`;
    // A API do BC devolve 502/503 de vez em quando; tenta de novo antes de desistir
    let resp;
    for (let i = 1; i <= 4; i++) {
      resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (resp.status < 500) break;
      await new Promise(r => setTimeout(r, 3000 * i));
    }
    if (resp.ok) {
      const dados = await resp.json().catch(() => []);
      if (Array.isArray(dados)) transacao(db, () => {
        for (const p of dados) { ins.run(serie, iso(p.data), Number(p.valor)); n++; }
      });
    } else if (resp.status !== 404 && resp.status !== 400) {
      // 400 e 404 são a forma da API dizer "nada nesse intervalo" (ex.: série já em dia)
      throw new Error(`HTTP ${resp.status}`);
    }
    inicio = `${Number(inicio.slice(0, 4)) + 1}-01-01`;
  }
  log(`Macro ${serie}: ${n} pontos novos`);
}

export async function atualizarTesouro(db, anoInicio) {
  const url = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';
  const arq = await baixar(url, 'tesouro/PrecoTaxaTesouroDireto.csv', { forcar: true });
  const texto = readFileSync(arq).toString('latin1');
  const ins = db.prepare('INSERT OR REPLACE INTO tesouro (titulo, vencimento, data, taxa, pu) VALUES (?, ?, ?, ?, ?)');
  // O arquivo usa vírgula decimal e não tem separador de milhar (ex.: 20185,39)
  const numero = s => Number((s ?? '').replace(',', '.'));
  const desde = `${anoInicio}-01-01`;
  let n = 0;
  transacao(db, () => {
    for (const r of lerCsv(texto)) {
      const titulo = r['Tipo Titulo'];
      const data = iso(r['Data Base']);
      if (data < desde) continue;
      const taxa = numero(r['Taxa Compra Manha']), pu = numero(r['PU Base Manha']);
      if (!taxa && !pu) continue;
      ins.run(titulo, iso(r['Data Vencimento']), data, taxa || null, pu || null);
      n++;
    }
  });
  log(`Tesouro: ${n} taxas`);
}
