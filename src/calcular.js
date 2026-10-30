// Etapa 2: transforma os dados brutos em indicadores, notas e sinais de oportunidade.
// Gera três tabelas (recriadas a cada execução):
//   historico_multiplos  P/L, P/VP, EV/EBIT, EV/EBITDA e DY de cada empresa no fim de cada mês
//   indicadores          a foto de hoje de cada empresa: indicadores, notas, selos e alertas
//   etfs                 retorno e risco dos ETFs comparados com o CDI
import { pathToFileURL } from 'node:url';
import { abrirDb, transacao } from './db.js';
import { log } from './util.js';

const INICIO_MULTIPLOS = '2020-01-01';   // a CVM só publica a quantidade de ações a partir de 2020
const LIQUIDEZ_MINIMA = 1e6;             // R$ por dia, média de 3 meses
const BALANCO_MAX_DIAS = 200;            // balanço mais velho que isso tira a empresa do ranking
const SETORES_FINANCEIROS = /bancos|intermedia[çc][ãa]o financeira|seguradoras|cr[ée]dito imobili[áa]rio|arrendamento/i;
const ETFS = ['IVVB11', 'WRLD11', 'BOVA11'];
const FLUXOS = ['receita', 'lucro_bruto', 'ebit', 'equivalencia', 'da', 'lucro_liq', 'lucro_contr',
  'fco', 'fci', 'capex', 'dividendos_pagos'];
// Contas que, quando a empresa não tem a linha, valem zero (e não "sem dado")
const ZERO_SE_AUSENTE = new Set(['equivalencia', 'capex', 'dividendos_pagos']);

const DIA = 86400000;
const addDias = (iso, n) => new Date(Date.parse(iso) + n * DIA).toISOString().slice(0, 10);
const menosAnos = (iso, n) => `${Number(iso.slice(0, 4)) - n}${iso.slice(4)}`;
const dias = (a, b) => (Date.parse(b) - Date.parse(a)) / DIA;
const media = xs => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const mediana = xs => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
// Número no formato brasileiro para os textos de motivo e alerta
const br = (x, d) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const positivo = x => (x != null && x > 0 ? x : null);

// Razão de preço de um dia para o outro que bate com 1:N ou N:1 (desdobramento/grupamento)
const PROPORCOES = [2, 3, 4, 5, 8, 10, 20, 25, 50, 100];
const pareceEventoSocietario = razao => PROPORCOES.some(n =>
  Math.abs(razao * n - 1) < 0.04 || Math.abs(razao / n - 1) < 0.04);

// Último índice com data <= alvo (busca binária)
function indiceAte(datas, alvo) {
  let lo = 0, hi = datas.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (datas[m] <= alvo) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}

export function calcular(db) {
  const hoje = db.prepare("SELECT max(data) d FROM cotacoes WHERE ticker = 'BOVA11'").get().d;
  log(`Cálculo com preços de ${hoje}`);

  // ---------- Preços ----------
  const series = new Map();
  for (const r of db.prepare(`SELECT ticker, data, fechamento, volume FROM cotacoes
      WHERE data >= '2019-01-01' AND ticker IN (SELECT ticker FROM tickers) ORDER BY ticker, data`).iterate()) {
    let s = series.get(r.ticker);
    if (!s) series.set(r.ticker, s = { d: [], p: [], v: [] });
    s.d.push(r.data); s.p.push(r.fechamento); s.v.push(r.volume);
  }
  const calendario = series.get('BOVA11').d;
  const fimDeMes = calendario.filter((d, i) => d >= INICIO_MULTIPLOS && (i === calendario.length - 1 || calendario[i + 1].slice(0, 7) !== d.slice(0, 7)));

  const volumeMedio = (tk, ate, n = 63) => {
    const s = series.get(tk);
    if (!s) return 0;
    const i = indiceAte(s.d, ate);
    if (i < 0 || dias(s.d[i], ate) > 10) return 0;
    return media(s.v.slice(Math.max(0, i - n + 1), i + 1)) ?? 0;
  };

  // Série diária de uma classe (ON ou PN): em cada pregão, o ticker da classe mais negociado.
  // Assim troca de código (ex.: ELET3 -> AXIA3) e classes A/B viram uma série contínua.
  function serieClasse(tks) {
    const porData = new Map();
    for (const tk of tks) {
      const s = series.get(tk);
      if (!s) continue;
      for (let i = 0; i < s.d.length; i++) {
        const ex = porData.get(s.d[i]);
        if (!ex || s.v[i] > ex.v) porData.set(s.d[i], { p: s.p[i], v: s.v[i] });
      }
    }
    const d = [...porData.keys()].sort();
    return { d, p: d.map(x => porData.get(x).p), v: d.map(x => porData.get(x).v) };
  }
  const precoEm = (s, data) => {
    const i = indiceAte(s.d, data);
    return i >= 0 && dias(s.d[i], data) <= 10 ? s.p[i] : null;
  };

  // ---------- Empresas ----------
  const empresas = db.prepare(`SELECT e.cnpj, e.nome, e.setor, e.segmento, e.controle, group_concat(t.ticker) tks
    FROM empresas e JOIN tickers t ON t.cnpj = e.cnpj AND t.tipo = 'acao' GROUP BY e.cnpj`).all();
  const fundStmt = db.prepare('SELECT * FROM fundamentos WHERE cnpj = ? ORDER BY dt_refer, tipo');

  const historico = [];
  const fotos = [];

  for (const emp of empresas) {
    const tks = emp.tks.split(',');
    const on = serieClasse(tks.filter(t => t.slice(4) === '3'));
    const pn = serieClasse(tks.filter(t => /^[4-8]$/.test(t.slice(4))));
    if (!on.d.length && !pn.d.length) continue;
    const tickerPrincipal = tks.map(t => [t, volumeMedio(t, hoje)]).sort((a, b) => b[1] - a[1])[0];
    const liquidez = tickerPrincipal[1];

    // Balanços: um por data (DFP prevalece sobre ITR na mesma data)
    const porRef = new Map();
    for (const r of fundStmt.all(emp.cnpj)) if (!porRef.has(r.dt_refer) || r.tipo === 'DFP') porRef.set(r.dt_refer, r);
    const regs = [...porRef.values()];
    if (!regs.length) continue;
    calcularDozeMeses(regs, porRef);

    const precoClasses = data => {
      const pOn = precoEm(on, data), pPn = precoEm(pn, data);
      return { on: pOn ?? pPn, pn: pPn ?? pOn };
    };
    const linhaTempoAcoes = montarLinhaTempoAcoes(regs, precoClasses, on.v.length >= pn.v.length ? on : pn);
    if (!linhaTempoAcoes.length) continue;
    const acoesEm = data => {
      let seg = linhaTempoAcoes[0];
      for (const s of linhaTempoAcoes) if (s.desde <= data) seg = s;
      return seg;
    };
    // Balanço que o mercado já conhecia na data (entregue à CVM até ali) e com 12 meses calculados
    const balancoEm = data => {
      let b = null;
      for (const r of regs) if (r.dt_receb <= data && r.ttm.receita != null && (!b || r.dt_refer > b.dt_refer)) b = r;
      return b;
    };

    const multiplosEm = data => {
      const b = balancoEm(data);
      const a = acoesEm(data);
      const p = precoClasses(data);
      if (!b || p.on == null) return null;
      const vm = a.on * p.on + a.pn * p.pn;
      if (!(vm > 0)) return null;
      const dividaBruta = (b.divida_cp ?? 0) + (b.divida_lp ?? 0);
      const minoritarios = (b.pl ?? 0) - (b.pl_contr ?? 0);
      const ev = vm + dividaBruta - (b.caixa ?? 0) + minoritarios;
      const ebitAj = b.ttm.ebit != null ? b.ttm.ebit - b.ttm.equivalencia : null;
      const ebitda = ebitAj != null && b.ttm.da != null ? ebitAj + b.ttm.da : null;
      return {
        b, a, p, vm, ev, ebitAj, ebitda,
        pl: div(vm, positivo(b.ttm.lucro_contr)),
        pvp: div(vm, positivo(b.pl_contr)),
        ev_ebit: div(ev, positivo(ebitAj)),
        ev_ebitda: div(ev, positivo(ebitda)),
        dy: div(b.ttm.dividendos_pagos, vm),
      };
    };

    const financeira = SETORES_FINANCEIROS.test(emp.setor ?? '');
    const pontos = [];
    for (const data of fimDeMes) {
      const m = multiplosEm(data);
      if (!m) continue;
      pontos.push({ data, ...m });
      historico.push({ cnpj: emp.cnpj, data, vm: m.vm, pl: m.pl, pvp: m.pvp, ev_ebit: financeira ? null : m.ev_ebit,
        ev_ebitda: financeira ? null : m.ev_ebitda, dy: m.dy });
    }

    const m = multiplosEm(hoje);
    if (!m) continue;
    const b = m.b;
    const acoesTotal = m.a.on + m.a.pn;

    // Comparação com o próprio histórico (meses anteriores a hoje)
    const anteriores = pontos.filter(x => x.data < hoje);
    const percentilProprio = (campo, atual) => {
      const hist = anteriores.map(x => x[campo]).filter(x => x != null && x > 0);
      if (hist.length < 24 || atual == null) return { mediana: mediana(hist), pct: null, n: hist.length };
      return { mediana: mediana(hist), pct: 100 * hist.filter(x => x < atual).length / hist.length, n: hist.length };
    };
    const histPl = percentilProprio('pl', m.pl);
    const histEvEbit = percentilProprio('ev_ebit', m.ev_ebit);
    const histPvp = percentilProprio('pvp', m.pvp);
    const histDy = { mediana: mediana(anteriores.map(x => x.dy)) };

    // Rentabilidade, margens e endividamento
    const umAnoAntes = porRef.get(menosAnos(b.dt_refer, 1));
    const plMedio = media([b.pl_contr, umAnoAntes?.pl_contr].filter(x => x > 0));
    const dividaLiq = (b.divida_cp ?? 0) + (b.divida_lp ?? 0) - (b.caixa ?? 0);
    const capitalInvestido = (b.pl ?? 0) + dividaLiq;
    const t = b.ttm;

    // Crescimento: 12 meses de hoje contra 12 meses de 5 anos antes
    const cincoAnos = porRef.get(menosAnos(b.dt_refer, 5));
    const cagr = (atual, antigo) => (atual > 0 && antigo > 0 ? (atual / antigo) ** (1 / 5) - 1 : null);

    // Consistência: anos com lucro nos últimos 10 exercícios, anos com dividendos nos últimos 5
    const anuais = regs.filter(r => r.tipo === 'DFP' && r.ttm.lucro_contr != null).slice(-10);
    const anosLucro = anuais.filter(r => r.ttm.lucro_contr > 0).length;
    const anosDividendo = anuais.slice(-5).filter(r => r.ttm.dividendos_pagos > 0).length;
    const dy3a = div(media(anuais.slice(-3).map(r => r.ttm.dividendos_pagos)), m.vm);

    // Graham: preço justo = raiz(22,5 x LPA x VPA), comparado com o preço da classe principal
    const lpa = div(t.lucro_contr, acoesTotal), vpa = div(b.pl_contr, acoesTotal);
    const precoRef = m.p.on;
    const graham = lpa > 0 && vpa > 0 ? Math.sqrt(22.5 * lpa * vpa) : null;

    const alertas = [];
    // Salto de preço numa proporção "redonda" depois do último balanço: provável desdobramento/grupamento
    // que a quantidade de ações ainda não reflete. Quedas reais (ex.: 26/10/2026, -14% no Ibovespa) não batem.
    const serieRef = on.v.length >= pn.v.length ? on : pn;
    const ultimoBalanco = regs.filter(r => r.acoes_on != null).at(-1)?.dt_refer;
    for (let i = indiceAte(serieRef.d, ultimoBalanco) + 1; i > 0 && i < serieRef.d.length; i++) {
      if (pareceEventoSocietario(serieRef.p[i] / serieRef.p[i - 1])) {
        alertas.push(`Preço variou ${Math.round(100 * (serieRef.p[i] / serieRef.p[i - 1] - 1))}% em ${serieRef.d[i]}: possível desdobramento/grupamento, múltiplos podem estar distorcidos até o próximo balanço`);
        break;
      }
    }
    const desatualizado = dias(b.dt_refer, hoje) > BALANCO_MAX_DIAS;
    if (desatualizado) alertas.push(`Último balanço é de ${b.dt_refer}`);
    // Tendências recentes (comparando com o balanço de um ano antes)
    if (umAnoAntes?.ttm.receita > 0 && t.receita > 0) {
      const margemAntes = umAnoAntes.ttm.lucro_contr / umAnoAntes.ttm.receita, margemHoje = t.lucro_contr / t.receita;
      if (margemAntes - margemHoje > 0.05) alertas.push(`Margem líquida caiu de ${br(100 * margemAntes, 1)}% para ${br(100 * margemHoje, 1)}% em 12 meses`);
    }
    const ebitdaAntes = umAnoAntes ? (umAnoAntes.ttm.ebit ?? 0) - umAnoAntes.ttm.equivalencia + (umAnoAntes.ttm.da ?? 0) : null;
    const dlAntes = umAnoAntes ? (umAnoAntes.divida_cp ?? 0) + (umAnoAntes.divida_lp ?? 0) - (umAnoAntes.caixa ?? 0) : null;
    if (!financeira && m.ebitda > 0 && ebitdaAntes > 0 && dlAntes != null) {
      const antes = dlAntes / ebitdaAntes, agora = dividaLiq / m.ebitda;
      if (agora > 2 && agora - antes > 1) alertas.push(`Dívida líquida/EBITDA subiu de ${br(antes, 1)} para ${br(agora, 1)} em 12 meses`);
    }

    // Lucro não recorrente: lucro acima do operacional (venda de ativo, crédito fiscal, renegociação de dívida)
    // ou muito acima da média dos 3 exercícios anteriores. Infla o P/L "barato" e o ROE.
    let lucroSuspeito = false;
    if (t.lucro_contr > 0) {
      if (!financeira && t.ebit != null && t.lucro_contr > 1.15 * Math.max(t.ebit, 0)) {
        alertas.push(`Lucro de 12 meses (${br(t.lucro_contr / 1e6, 0)} mi) acima do resultado operacional (${br(t.ebit / 1e6, 0)} mi): provável ganho não recorrente`);
        lucroSuspeito = true;
      }
      const media3 = media(anuais.filter(r => r.dt_refer <= menosAnos(b.dt_refer, 1)).slice(-3).map(r => r.ttm.lucro_contr));
      if (media3 > 0 && t.lucro_contr > 3 * media3) {
        alertas.push(`Lucro de 12 meses é ${br(t.lucro_contr / media3, 1)}x a média dos 3 anos anteriores`);
        lucroSuspeito = true;
      }
    }

    const precoSerie = serieRef;
    const iHoje = indiceAte(precoSerie.d, hoje), i12 = indiceAte(precoSerie.d, menosAnos(hoje, 1));

    fotos.push({
      cnpj: emp.cnpj, nome: emp.nome, ticker: tickerPrincipal[0], tickers: tks.join(' '),
      setor: (emp.setor ?? '').replace(/^Emp\. Adm\. Part\. - /, '').replace('Sem Setor Principal', 'Holdings diversificadas'),
      segmento: emp.segmento, controle: emp.controle, financeira: financeira ? 1 : 0,
      data: hoje, dt_balanco: b.dt_refer, preco: series.get(tickerPrincipal[0])?.p.at(-1) ?? null,
      variacao_12m: i12 >= 0 ? precoSerie.p[iHoje] / precoSerie.p[i12] - 1 : null,
      liquidez, vm: m.vm, ev: financeira ? null : m.ev,
      // valuation
      pl: m.pl, pvp: m.pvp, ev_ebit: financeira ? null : m.ev_ebit, ev_ebitda: financeira ? null : m.ev_ebitda,
      dy: m.dy, dy_3a: dy3a, earnings_yield: div(t.lucro_contr, m.vm), ebit_ev: financeira ? null : div(m.ebitAj, m.ev),
      // rentabilidade
      roe: plMedio ? t.lucro_contr / plMedio : null,
      roic: !financeira && capitalInvestido > 0 && m.ebitAj != null ? m.ebitAj * 0.66 / capitalInvestido : null,
      margem_bruta: financeira ? null : div(t.lucro_bruto, positivo(t.receita)),
      margem_ebit: financeira ? null : div(m.ebitAj, positivo(t.receita)),
      margem_liq: financeira ? null : div(t.lucro_contr, positivo(t.receita)),
      // saúde
      divida_liq: financeira ? null : dividaLiq,
      div_liq_ebitda: financeira ? null : (m.ebitda > 0 ? dividaLiq / m.ebitda : (dividaLiq > 0 ? 99 : 0)),
      div_liq_pl: financeira ? null : div(dividaLiq, positivo(b.pl_contr)),
      liq_corrente: financeira ? null : div(b.ativo_circ, b.passivo_circ),
      // crescimento e consistência
      cagr_receita_5a: financeira ? null : cagr(t.receita, cincoAnos?.ttm.receita),
      cagr_lucro_5a: cagr(t.lucro_contr, cincoAnos?.ttm.lucro_contr),
      anos_lucro: anosLucro, anos_lucro_base: anuais.length, anos_dividendo: anosDividendo,
      payout: div(t.dividendos_pagos, positivo(t.lucro_contr)),
      // números absolutos (12 meses)
      receita_12m: t.receita, lucro_12m: t.lucro_contr, ebitda_12m: m.ebitda, dividendos_12m: t.dividendos_pagos,
      // comparação com o próprio histórico desde 2020
      pl_mediana: histPl.mediana, pl_percentil: histPl.pct,
      ev_ebit_mediana: histEvEbit.mediana, ev_ebit_percentil: histEvEbit.pct,
      pvp_mediana: histPvp.mediana, pvp_percentil: histPvp.pct, dy_mediana: histDy.mediana,
      meses_historico: Math.max(histPl.n, histEvEbit.n),
      // Graham e Bazin como margem sobre o preço atual
      graham_margem: graham ? graham / precoRef - 1 : null,
      bazin_margem: dy3a != null ? dy3a / 0.06 - 1 : null,
      lucro_suspeito: lucroSuspeito ? 1 : 0,
      elegivel: liquidez >= LIQUIDEZ_MINIMA && !desatualizado && t.lucro_contr != null ? 1 : 0,
      alertas: alertas.join(' | '),
    });
  }

  pontuar(fotos.filter(f => f.elegivel && !f.financeira), false);
  pontuar(fotos.filter(f => f.elegivel && f.financeira), true);
  marcarOportunidades(fotos, db);

  const etfs = calcularEtfs(db, series, hoje);

  transacao(db, () => {
    gravarTabela(db, 'historico_multiplos', historico, 'cnpj, data');
    gravarTabela(db, 'indicadores', fotos, 'cnpj');
    gravarTabela(db, 'etfs', etfs, 'ticker');
  });
  const oport = fotos.filter(f => f.oportunidade).length;
  log(`Cálculo: ${fotos.length} empresas (${fotos.filter(f => f.elegivel).length} no ranking, ${oport} oportunidades), ${historico.length} pontos de histórico`);
  return { fotos, etfs };
}

// Converte valores acumulados no ano em "últimos 12 meses":
// 12m = acumulado do ano + exercício anterior completo - mesmo período do ano anterior
function calcularDozeMeses(regs, porRef) {
  for (const r of regs) {
    r.ttm = {};
    if (!r.dt_ini) continue;
    const meses = dias(r.dt_ini, r.dt_refer) / 30.44;
    let anual = null, anterior = null;
    if (meses < 11.5) {
      anual = porRef.get(addDias(r.dt_ini, -1));
      anterior = porRef.get(menosAnos(r.dt_refer, 1));
      if (!anual || !anterior || anterior.dt_ini !== menosAnos(r.dt_ini, 1)) continue;
    }
    for (const f of FLUXOS) {
      const val = x => (x[f] == null && ZERO_SE_AUSENTE.has(f) ? 0 : x[f]);
      if (!anual) { r.ttm[f] = val(r); continue; }
      const a = val(r), b = val(anual), c = val(anterior);
      r.ttm[f] = a == null || b == null || c == null ? null : a + b - c;
    }
    // Reapresentações entre períodos podem deixar a conta negativa; dividendo e capex não são
    for (const f of ['dividendos_pagos', 'capex']) if (r.ttm[f] < 0) r.ttm[f] = 0;
  }
}

// Monta a quantidade de ações ao longo do tempo:
// 1) corrige empresas que informam em milhares (valor de mercado absurdamente baixo frente ao PL)
// 2) posiciona desdobramentos/grupamentos no dia do salto de preço, e não só no balanço seguinte
function montarLinhaTempoAcoes(regs, precoClasses, serieRef) {
  const comAcoes = regs.filter(r => r.acoes_on != null && r.acoes_on + r.acoes_pn > 0);
  // Razão valor de mercado bruto / referência: < 0,005 = milhares; > 0,05 = unidades; meio-termo herda do vizinho
  for (const r of comAcoes) {
    const p = precoClasses(r.dt_refer);
    const ref = r.pl_contr > 0 ? r.pl_contr : (r.ttm.receita > 0 ? r.ttm.receita * 2 : null);
    r.fator = null;
    if (p.on == null || !ref) continue;
    const razao = (r.acoes_on * p.on + r.acoes_pn * p.pn) / ref;
    if (razao < 0.005) r.fator = 1000; else if (razao > 0.05) r.fator = 1;
    else r.razao = razao;
  }
  for (let i = 0; i < comAcoes.length; i++) {
    const r = comAcoes[i];
    if (r.fator) continue;
    const viz = [...comAcoes.slice(0, i).reverse(), ...comAcoes.slice(i + 1)].find(x => x.fator);
    r.fator = viz?.fator ?? (r.razao != null && r.razao < 0.025 ? 1000 : 1);
  }

  const linha = [];
  for (let i = 0; i < comAcoes.length; i++) {
    const r = comAcoes[i];
    const seg = { desde: r.dt_refer, on: r.acoes_on * r.fator, pn: r.acoes_pn * r.fator };
    if (i === 0) { linha.push(seg); continue; }
    const ant = linha.at(-1);
    const q = (seg.on + seg.pn) / (ant.on + ant.pn);
    if (q > 1.4 || q < 0.7) {
      // Procura o pregão cujo salto de preço "explica" a mudança na quantidade de ações
      const ini = indiceAte(serieRef.d, comAcoes[i - 1].dt_refer) + 1, fim = indiceAte(serieRef.d, r.dt_refer);
      let melhor = null;
      for (let j = Math.max(ini, 1); j <= fim; j++) {
        const erro = Math.abs(Math.log(serieRef.p[j] / serieRef.p[j - 1]) + Math.log(q));
        if (erro < 0.25 && (!melhor || erro < melhor.erro)) melhor = { erro, data: serieRef.d[j] };
      }
      if (melhor) seg.desde = melhor.data;
    }
    linha.push(seg);
  }
  return linha;
}

// Percentil (0 a 100) de cada valor dentro do grupo. maiorMelhor=false inverte.
function percentis(grupo, campo, maiorMelhor = true) {
  const vals = grupo.map(f => f[campo]).filter(Number.isFinite).sort((a, b) => a - b);
  const pct = new Map();
  for (const f of grupo) {
    const v = f[campo];
    if (!Number.isFinite(v) || vals.length < 2) continue;
    let lo = 0, hi = vals.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
    let p = 100 * lo / (vals.length - 1);
    pct.set(f, maiorMelhor ? p : 100 - p);
  }
  return f => pct.get(f) ?? null;
}

// Notas de 0 a 100 em cada pilar, relativas às outras empresas do mesmo grupo
function pontuar(grupo, financeiras) {
  if (!grupo.length) return;
  const P = {};
  for (const [campo, maior] of [['roe', 1], ['roic', 1], ['earnings_yield', 1], ['ebit_ev', 1], ['pvp', 0],
    ['div_liq_ebitda', 0], ['liq_corrente', 1], ['div_liq_pl', 0], ['cagr_receita_5a', 1], ['cagr_lucro_5a', 1]]) {
    P[campo] = percentis(grupo, campo, !!maior);
  }
  // Margem é comparada dentro do setor: varejo e software não têm a mesma margem "normal"
  const porSetor = Map.groupBy(grupo, f => f.setor);
  const margemSetor = new Map();
  for (const membros of porSetor.values()) {
    const p = membros.length >= 4 ? percentis(membros, 'margem_liq') : percentis(grupo, 'margem_liq');
    for (const f of membros) margemSetor.set(f, p(f));
  }

  for (const f of grupo) {
    const consistencia = f.anos_lucro_base ? 100 * f.anos_lucro / f.anos_lucro_base : null;
    const pctHist = f.pl_percentil ?? f.ev_ebit_percentil;
    const baratoVsHistorico = pctHist != null ? 100 - pctHist : null;
    f.nota_qualidade = media(financeiras
      ? [P.roe(f), consistencia]
      : [P.roe(f), P.roic(f), margemSetor.get(f), consistencia]);
    f.nota_preco = media(financeiras
      ? [P.earnings_yield(f), P.pvp(f), baratoVsHistorico]
      : [P.earnings_yield(f), P.ebit_ev(f), P.pvp(f), baratoVsHistorico]);
    f.nota_saude = financeiras ? null : media([P.div_liq_ebitda(f), P.liq_corrente(f), P.div_liq_pl(f)]);
    f.nota_crescimento = media(financeiras ? [P.cagr_lucro_5a(f)] : [P.cagr_receita_5a(f), P.cagr_lucro_5a(f)]);
    f.nota_geral = media([f.nota_qualidade, f.nota_preco, f.nota_saude, f.nota_crescimento]);
  }
  for (const f of grupo) for (const k of ['nota_qualidade', 'nota_preco', 'nota_saude', 'nota_crescimento', 'nota_geral'])
    if (f[k] != null) f[k] = Math.round(f[k]);

  // Fórmula Mágica (Greenblatt): soma das posições em EBIT/EV e ROIC; as 30 melhores ganham o selo
  if (!financeiras) {
    const cand = grupo.filter(f => f.ebit_ev > 0 && f.roic > 0);
    const posEy = new Map([...cand].sort((a, b) => b.ebit_ev - a.ebit_ev).map((f, i) => [f, i]));
    const posRoic = new Map([...cand].sort((a, b) => b.roic - a.roic).map((f, i) => [f, i]));
    [...cand].sort((a, b) => (posEy.get(a) + posRoic.get(a)) - (posEy.get(b) + posRoic.get(b)))
      .forEach((f, i) => { f.magica_posicao = i + 1; });
  }
}

// Oportunidade = empresa boa e saudável negociando abaixo do próprio padrão histórico
function marcarOportunidades(fotos, db) {
  const ipca = db.prepare(`SELECT taxa FROM tesouro WHERE titulo = 'Tesouro IPCA+'
    AND data = (SELECT max(data) FROM tesouro) ORDER BY abs(julianday(vencimento) - julianday('now', '+10 years')) LIMIT 1`).get()?.taxa;
  for (const f of fotos) {
    f.selo_graham = f.graham_margem > 0 ? 1 : 0;
    f.selo_bazin = f.bazin_margem >= 0 ? 1 : 0;
    f.selo_magica = f.magica_posicao <= 30 ? 1 : 0;
    // Lucro sobre preço (inverso do P/L) contra o juro real do Tesouro IPCA+ ~10 anos
    f.tesouro_ipca_ref = ipca ?? null;
    f.premio_vs_tesouro = f.earnings_yield != null && ipca != null ? f.earnings_yield - ipca / 100 : null;

    const pctHist = f.pl_percentil ?? f.ev_ebit_percentil;
    const ok = f.elegivel && f.lucro_12m > 0 && pctHist != null && pctHist <= 25 && !f.alertas.includes('desdobramento') && !f.lucro_suspeito
      && f.nota_qualidade >= 60 && (f.financeira || f.nota_saude >= 50);
    f.oportunidade = ok ? 1 : 0;
    f.nota_oportunidade = ok ? Math.round(0.5 * media([f.nota_qualidade, f.nota_saude]) + 0.5 * (100 - pctHist)) : null;
    if (ok) {
      const campo = f.pl_percentil != null ? 'P/L' : 'EV/EBIT';
      const atual = f.pl_percentil != null ? f.pl : f.ev_ebit, med = f.pl_percentil != null ? f.pl_mediana : f.ev_ebit_mediana;
      f.motivo = `${campo} ${br(atual, 1)} contra mediana de ${br(med, 1)} desde 2020 (${Math.round(100 * (atual / med - 1))}%), `
        + `mais barato que em ${Math.round(100 - pctHist)}% dos meses; ROE ${br(100 * f.roe, 0)}%`
        + (f.financeira ? '' : `, dívida líq./EBITDA ${br(f.div_liq_ebitda, 1)}`);
    } else f.motivo = null;
  }
}

// ETFs: retornos em várias janelas, comparados com o CDI acumulado no mesmo período
function calcularEtfs(db, _series, hoje) {
  const cdi = db.prepare("SELECT data, valor FROM macro WHERE serie = 'cdi' ORDER BY data").all();
  const cdiD = cdi.map(x => x.data);
  const fatorCdi = new Float64Array(cdi.length + 1);
  fatorCdi[0] = 1;
  cdi.forEach((x, i) => { fatorCdi[i + 1] = fatorCdi[i] * (1 + x.valor / 100); });
  const cdiEntre = (a, b) => fatorCdi[indiceAte(cdiD, b) + 1] / fatorCdi[indiceAte(cdiD, a) + 1] - 1;
  const dolar = db.prepare("SELECT data, valor FROM macro WHERE serie = 'dolar' ORDER BY data").all();
  const dolarEm = d => dolar[indiceAte(dolar.map(x => x.data), d)]?.valor;

  const saida = [];
  for (const tk of ETFS) {
    const s = db.prepare('SELECT data, fechamento p, volume v FROM cotacoes WHERE ticker = ? ORDER BY data').all(tk);
    if (!s.length) continue;
    const d = s.map(x => x.data), p = s.map(x => x.p);
    const i = d.length - 1;
    const janela = anos => {
      const j = indiceAte(d, menosAnos(hoje, anos));
      if (j < 0 || d[0] > menosAnos(hoje, anos)) return { ret: null, cdi: null };
      return { ret: p[i] / p[j] - 1, cdi: cdiEntre(d[j], hoje) };
    };
    const r1 = janela(1), r3 = janela(3), r5 = janela(5);
    const j1m = indiceAte(d, addDias(hoje, -30));
    const ult252 = p.slice(-253);
    const retsDiarios = ult252.slice(1).map((x, k) => Math.log(x / ult252[k]));
    const vol = Math.sqrt(media(retsDiarios.map(x => x * x)) * 252);
    let pico = 0, quedaMax = 0;
    for (const x of p) { pico = Math.max(pico, x); quedaMax = Math.min(quedaMax, x / pico - 1); }
    const anual = (r, anos) => (r == null ? null : (1 + r) ** (1 / anos) - 1);
    saida.push({
      ticker: tk, nome: db.prepare('SELECT nome FROM tickers WHERE ticker = ?').get(tk)?.nome ?? tk,
      data: d[i], preco: p[i], desde: d[0],
      liquidez: media(s.slice(-63).map(x => x.v)),
      ret_1m: j1m >= 0 ? p[i] / p[j1m] - 1 : null,
      ret_12m: r1.ret, cdi_12m: r1.cdi,
      ret_3a_aa: anual(r3.ret, 3), cdi_3a_aa: anual(r3.cdi, 3),
      ret_5a_aa: anual(r5.ret, 5), cdi_5a_aa: anual(r5.cdi, 5),
      distancia_maxima_52s: p[i] / Math.max(...ult252) - 1,
      distancia_maxima_historica: p[i] / Math.max(...p) - 1,
      maior_queda: quedaMax, volatilidade_anual: vol,
      dolar_12m: dolarEm(hoje) / dolarEm(menosAnos(hoje, 1)) - 1,
    });
  }
  return saida;
}

// Recria a tabela com as colunas do primeiro objeto
function gravarTabela(db, nome, linhas, chave) {
  db.exec(`DROP TABLE IF EXISTS ${nome}`);
  if (!linhas.length) return;
  const cols = [...new Set(linhas.flatMap(l => Object.keys(l)))];
  db.exec(`CREATE TABLE ${nome} (${cols.join(', ')}, PRIMARY KEY (${chave}))`);
  const ins = db.prepare(`INSERT INTO ${nome} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  for (const l of linhas) ins.run(...cols.map(c => {
    const v = l[c];
    return v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? null : v;
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = abrirDb();
  calcular(db);
  db.close();
}
