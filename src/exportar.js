// Etapa 3: exporta o que a página precisa para site/dados.js (window.DADOS = {...}).
// Um .js em vez de .json para a página abrir direto do disco, sem servidor.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirDb } from './db.js';
import { log, RAIZ } from './util.js';

// Arredonda para deixar o arquivo enxuto: valores grandes inteiros, razões com 4 casas
const arred = x => (typeof x !== 'number' || !Number.isFinite(x) ? x ?? null
  : Math.abs(x) >= 1000 ? Math.round(x) : Number(x.toFixed(4)));
const arredObj = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, arred(v)]));

export function exportar(db) {
  const empresas = db.prepare('SELECT * FROM indicadores ORDER BY nota_geral DESC').all().map(arredObj);

  // Histórico mensal de múltiplos, por empresa: [mês, P/L, P/VP, EV/EBITDA, DY]
  const historico = {};
  for (const r of db.prepare('SELECT * FROM historico_multiplos ORDER BY cnpj, data').iterate()) {
    (historico[r.cnpj] ??= []).push([r.data.slice(0, 7), arred(r.pl), arred(r.pvp), arred(r.ev_ebitda), arred(r.dy)]);
  }

  // Exercícios anuais: [ano, receita, lucro, dividendos pagos, dívida líquida, patrimônio]
  const anuais = {};
  for (const r of db.prepare(`SELECT cnpj, dt_refer, receita, lucro_contr, dividendos_pagos,
      coalesce(divida_cp,0) + coalesce(divida_lp,0) - coalesce(caixa,0) divida_liq, pl_contr
      FROM fundamentos WHERE tipo = 'DFP' AND cnpj IN (SELECT cnpj FROM indicadores) ORDER BY cnpj, dt_refer`).iterate()) {
    (anuais[r.cnpj] ??= []).push([Number(r.dt_refer.slice(0, 4)), arred(r.receita), arred(r.lucro_contr),
      arred(r.dividendos_pagos), arred(r.divida_liq), arred(r.pl_contr)]);
  }

  // ETFs e CDI: fechamento do último pregão de cada mês
  const etfs = db.prepare('SELECT * FROM etfs').all().map(arredObj);
  const series = {};
  for (const e of etfs) {
    series[e.ticker] = db.prepare(`SELECT substr(data,1,7) mes, fechamento FROM cotacoes c WHERE ticker = ?
      AND data = (SELECT max(data) FROM cotacoes c2 WHERE c2.ticker = c.ticker AND substr(c2.data,1,7) = substr(c.data,1,7))
      ORDER BY data`).all(e.ticker).map(r => [r.mes, r.fechamento]);
  }
  let indice = 1;
  const cdiMensal = new Map();
  for (const r of db.prepare("SELECT data, valor FROM macro WHERE serie = 'cdi' ORDER BY data").iterate()) {
    indice *= 1 + r.valor / 100;
    cdiMensal.set(r.data.slice(0, 7), indice);
  }
  series.CDI = [...cdiMensal].map(([mes, v]) => [mes, Number(v.toFixed(6))]);

  const ultimo = serie => db.prepare('SELECT data, valor FROM macro WHERE serie = ? ORDER BY data DESC LIMIT 1').get(serie);
  const tesouro = db.prepare(`SELECT titulo, vencimento, taxa FROM tesouro WHERE data = (SELECT max(data) FROM tesouro)
    ORDER BY titulo, vencimento`).all();
  const macro = {
    selic: ultimo('selic_meta'), ipca_12m: ultimo('ipca_12m'), dolar: ultimo('dolar'),
    cdi_dia: ultimo('cdi'), tesouro_data: db.prepare('SELECT max(data) d FROM tesouro').get().d,
  };

  const dados = {
    gerado_em: new Date().toISOString(),
    data_precos: empresas[0]?.data ?? null,
    macro, tesouro, empresas, historico, anuais, etfs, series,
  };
  mkdirSync(join(RAIZ, 'site'), { recursive: true });
  const texto = `window.DADOS = ${JSON.stringify(dados)};\n`;
  writeFileSync(join(RAIZ, 'site', 'dados.js'), texto);
  log(`Exportado site/dados.js (${(texto.length / 1024).toFixed(0)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = abrirDb();
  exportar(db);
  db.close();
}
