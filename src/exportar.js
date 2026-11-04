// Etapa 3: exporta o que a página precisa para site/dados.js (window.DADOS = {...}).
// Um .js em vez de .json para a página abrir direto do disco, sem servidor.
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { criarTabelasProventos, classeTicker, fatorAte } from './proventos.js';
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

  // Exercícios anuais: [ano, receita, lucro, dividendos pagos, dívida líquida, patrimônio,
  //   EBIT, ativo total, caixa, dívida bruta, caixa das operações, capex, caixa de financiamento]
  //   (no banco, "fcf" é o caixa das atividades de financiamento, não o caixa livre)
  const anuais = {};
  for (const r of db.prepare(`SELECT cnpj, dt_refer, receita, lucro_contr, dividendos_pagos,
      coalesce(divida_cp,0) + coalesce(divida_lp,0) - coalesce(caixa,0) divida_liq, pl_contr,
      ebit, ativo_total, caixa, coalesce(divida_cp,0) + coalesce(divida_lp,0) divida_bruta, fco, capex, fcf
      FROM fundamentos WHERE tipo = 'DFP' AND cnpj IN (SELECT cnpj FROM indicadores) ORDER BY cnpj, dt_refer`).iterate()) {
    (anuais[r.cnpj] ??= []).push([Number(r.dt_refer.slice(0, 4)), arred(r.receita), arred(r.lucro_contr),
      arred(r.dividendos_pagos), arred(r.divida_liq), arred(r.pl_contr), arred(r.ebit), arred(r.ativo_total),
      arred(r.caixa), arred(r.divida_bruta), arred(r.fco), arred(r.capex), arred(r.fcf)]);
  }

  // ETFs e CDI: fechamento do último pregão de cada mês
  const etfs = db.prepare('SELECT * FROM etfs').all().map(arredObj);

  // Variação do dia (último pregão contra o anterior) de cada ação e ETF: mapa de calor da tela inicial
  const anterior = db.prepare('SELECT fechamento FROM cotacoes WHERE ticker = ? AND data < ? ORDER BY data DESC LIMIT 1');
  for (const e of [...empresas, ...etfs]) {
    const a = e.data && e.preco ? anterior.get(e.ticker, e.data)?.fechamento : null;
    e.var_dia = a ? arred(e.preco / a - 1) : null;
  }
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
  const tesouro = db.prepare(`SELECT titulo, vencimento, taxa, pu FROM tesouro WHERE data = (SELECT max(data) FROM tesouro)
    ORDER BY titulo, vencimento`).all();
  const macro = {
    selic: ultimo('selic_meta'), ipca_12m: ultimo('ipca_12m'), dolar: ultimo('dolar'),
    cdi_dia: ultimo('cdi'), tesouro_data: db.prepare('SELECT max(data) d FROM tesouro').get().d,
    // Dólar de 12 meses: referência para saber se o IVVB11 está "inflado" pelo câmbio
    dolar_12m: (() => {
      const v = db.prepare("SELECT valor FROM macro WHERE serie = 'dolar' AND data >= date('now', '-365 day') ORDER BY valor").all().map(r => r.valor);
      return v.length ? { min: v[0], mediana: v[Math.floor(v.length / 2)], max: v.at(-1) } : null;
    })(),
  };

  // Carteiras acompanhadas: cotações diárias dos últimos ~400 dias, histórico dos títulos do
  // Tesouro e o CDI diário (para calcular CDBs a partir da data de aplicação)
  const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'carteiras.json'), 'utf8'));
  const acompanhados = [...new Set(config.carteiras.flatMap(c => [...(c.acoes ?? []), ...(c.etfs ?? [])]))];
  const desde = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const precos = {};
  for (const tk of acompanhados) {
    precos[tk] = db.prepare('SELECT data, fechamento FROM cotacoes WHERE ticker = ? AND data >= ? ORDER BY data')
      .all(tk, desde).map(r => [r.data, r.fechamento]);
  }
  const tesouroSeries = {};
  for (const t of config.carteiras.flatMap(c => c.tesouro ?? [])) {
    tesouroSeries[`${t.titulo}|${t.vencimento}`] = db.prepare(`SELECT data, taxa, pu FROM tesouro
      WHERE titulo = ? AND vencimento = ? ORDER BY data`).all(t.titulo, t.vencimento).map(r => [r.data, r.taxa, r.pu]);
  }
  const cdiDiario = db.prepare("SELECT data, valor FROM macro WHERE serie = 'cdi' ORDER BY data").all().map(r => [r.data, r.valor]);

  // Lucro e receita de cada trimestre isolado (os arquivos da CVM trazem o acumulado do ano):
  // trimestre = acumulado até ele - acumulado até o anterior do mesmo exercício
  const trimestres = {};
  let ant = null;
  for (const r of db.prepare(`SELECT cnpj, dt_refer, dt_ini, dt_receb, lucro_contr, receita FROM fundamentos
      WHERE dt_refer >= '2023-01-01' AND cnpj IN (SELECT cnpj FROM indicadores) ORDER BY cnpj, dt_refer`).iterate()) {
    const mesmoAno = ant && ant.cnpj === r.cnpj && ant.dt_ini === r.dt_ini;
    const base = mesmoAno ? ant : { lucro_contr: 0, receita: 0 };
    if (r.dt_ini && r.lucro_contr != null) {
      (trimestres[r.cnpj] ??= []).push([r.dt_refer, arred(r.lucro_contr - (base.lucro_contr ?? 0)),
        arred(r.receita != null ? r.receita - (base.receita ?? 0) : null), r.dt_receb]);
    }
    ant = r;
  }

  // Preços do dia ainda parciais (pregão em andamento): a página avisa e mostra o horário
  const dataPrecos = empresas[0]?.data ?? null;
  const temParcial = db.prepare('SELECT count(*) n FROM cotacoes WHERE parcial = 1 AND data = ?').get(dataPrecos).n > 0;
  const horaParcial = temParcial ? db.prepare("SELECT valor FROM meta WHERE chave = 'intraday_hora'").get()?.valor ?? null : null;

  const dados = {
    gerado_em: new Date().toISOString(),
    data_precos: dataPrecos,
    precos_parciais: temParcial ? { hora: horaParcial } : null,
    macro, tesouro, empresas, historico, anuais, etfs, series,
    config, precos, tesouro_series: tesouroSeries, cdi_diario: cdiDiario, trimestres,
  };
  mkdirSync(join(RAIZ, 'site'), { recursive: true });
  const texto = `window.DADOS = ${JSON.stringify(dados)};\n`;
  writeFileSync(join(RAIZ, 'site', 'dados.js'), texto);
  log(`Exportado site/dados.js (${(texto.length / 1024).toFixed(0)} KB)`);
  exportarAtivos(db, empresas);
}

// Um arquivo por código de negociação (site/ativos/ITSA4.json), lido pela página do ativo só quando
// ela abre: cotação diária desde 2016 e proventos, ajustados por desdobramento, grupamento e bonificação.
//   precos: [data, fechamento ajustado]
//   proventos: [data com, pagamento, tipo, valor como declarado, valor ajustado, preço na data com]
//   eventos: [data com, tipo, fator]
function exportarAtivos(db, empresas) {
  criarTabelasProventos(db);
  const pasta = join(RAIZ, 'site', 'ativos');
  rmSync(pasta, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });
  const cot = db.prepare("SELECT data, fechamento FROM cotacoes WHERE ticker = ? AND data >= '2016-01-01' ORDER BY data");
  const prov = db.prepare('SELECT data_com, pagamento, tipo, valor, preco_com FROM proventos WHERE codigo = ? AND classe = ? ORDER BY data_com DESC');
  const evs = db.prepare('SELECT data_com, tipo, fator FROM eventos_acoes WHERE codigo = ? AND classe = ? ORDER BY data_com');
  const TIPO = { DIVIDENDO: 'Dividendo', 'JRS CAP PROPRIO': 'JCP', RENDIMENTO: 'Rendimento' };
  let n = 0, bytes = 0;
  for (const e of empresas) for (const tk of e.tickers.split(' ')) {
    const precos = cot.all(tk);
    if (precos.length < 2) continue;
    const codigo = tk.slice(0, 4), classe = classeTicker(tk);
    const eventos = classe ? evs.all(codigo, classe) : [];
    const proventos = classe ? prov.all(codigo, classe) : [];
    const ajusta = d => fatorAte(eventos, d);
    const dados = {
      t: tk,
      precos: precos.map(p => [p.data, arred(p.fechamento / ajusta(p.data))]),
      proventos: proventos.map(p => [p.data_com, p.pagamento, TIPO[p.tipo] ?? p.tipo, arred(p.valor), arred(p.valor / ajusta(p.data_com)), p.preco_com]),
      eventos: eventos.map(ev => [ev.data_com, ev.tipo, ev.fator]),
    };
    const txt = JSON.stringify(dados);
    writeFileSync(join(pasta, `${tk}.json`), txt);
    n++; bytes += txt.length;
  }
  log(`Exportados ${n} arquivos de ativos (${(bytes / 1048576).toFixed(1)} MB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = abrirDb();
  exportar(db);
  db.close();
}
