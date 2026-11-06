// Etapa 2: transforma os dados brutos em indicadores, notas e sinais de oportunidade.
// Gera três tabelas (recriadas a cada execução):
//   historico_multiplos  P/L, P/VP, EV/EBIT, EV/EBITDA e DY de cada empresa no fim de cada mês
//   indicadores          a foto de hoje de cada empresa: indicadores, notas, selos e alertas
//   etfs                 retorno e risco dos ETFs comparados com o CDI
import { pathToFileURL } from 'node:url';
import { abrirDb, transacao } from './db.js';
import { log } from './util.js';
import { criarTabelasProventos, classeTicker, fatorAte } from './proventos.js';
import { criarTabelaEntregas } from './entregas.js';

const INICIO_MULTIPLOS = '2020-01-01';   // a CVM só publica a quantidade de ações a partir de 2020
const LIQUIDEZ_MINIMA = 1e6;             // R$ por dia, média de 3 meses
const BALANCO_MAX_DIAS = 200;            // balanço mais velho que isso tira a empresa do ranking
const SETORES_FINANCEIROS = /bancos|intermedia[çc][ãa]o financeira|seguradoras|cr[ée]dito imobili[áa]rio|arrendamento/i;
const ETFS = ['IVVB11', 'WRLD11', 'BOVA11', 'AUVP11', 'AUPO11'];
const FLUXOS = ['receita', 'lucro_bruto', 'ebit', 'equivalencia', 'da', 'lucro_liq', 'lucro_contr',
  'fco', 'fci', 'capex', 'dividendos_pagos'];
// Contas que, quando a empresa não tem a linha, valem zero (e não "sem dado")
const ZERO_SE_AUSENTE = new Set(['equivalencia', 'capex', 'dividendos_pagos']);

const DIA = 86400000;
const addDias = (iso, n) => new Date(Date.parse(iso) + n * DIA).toISOString().slice(0, 10);
const menosAnos = (iso, n) => `${Number(iso.slice(0, 4)) - n}${iso.slice(4)}`;
const menosMeses = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
const rotuloTri = iso => `${Math.ceil(Number(iso.slice(5, 7)) / 3)}T${iso.slice(2, 4)}`;
const dataBr = iso => iso.slice(0, 10).split('-').reverse().join('/').slice(0, 5);
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
  const empresas = db.prepare(`SELECT e.cnpj, e.cd_cvm, e.nome, e.setor, e.segmento, e.controle, group_concat(t.ticker) tks
    FROM empresas e JOIN tickers t ON t.cnpj = e.cnpj AND t.tipo = 'acao' GROUP BY e.cnpj`).all();
  const fundStmt = db.prepare('SELECT * FROM fundamentos WHERE cnpj = ? ORDER BY dt_refer, tipo');
  const capitalFre = new Map(db.prepare('SELECT * FROM capital_fre').all().map(r => [r.cnpj, r]));
  // Desdobramentos, grupamentos e bonificações da B3 (src/proventos.js), por prefixo do código
  criarTabelasProventos(db);
  const eventosPorCodigo = new Map();
  for (const ev of db.prepare('SELECT * FROM eventos_acoes').all()) {
    if (!eventosPorCodigo.has(ev.codigo)) eventosPorCodigo.set(ev.codigo, []);
    eventosPorCodigo.get(ev.codigo).push(ev);
  }
  // Última entrega de ITR/DFP de cada empresa no sistema da CVM (src/entregas.js): diz se o resultado
  // novo já saiu e ainda não está nos arquivos abertos, que só são regenerados aos domingos
  criarTabelaEntregas(db);
  const ultimaEntrega = new Map();
  for (const r of db.prepare('SELECT cd_cvm, dt_refer, min(dt_entrega) dt_entrega FROM entregas GROUP BY cd_cvm, dt_refer').all()) {
    const ex = ultimaEntrega.get(r.cd_cvm);
    if (!ex || r.dt_refer > ex.dt_refer) ultimaEntrega.set(r.cd_cvm, r);
  }
  const serieIbov = series.get('BOVA11');
  // Proventos por ação declarados na B3, por código e classe (ITSA|PN): base do dividend yield.
  // Restituição de capital (REST CAP DIN) devolve parte do capital, não é rendimento: fica de fora
  const proventosPorClasse = new Map();
  for (const p of db.prepare("SELECT codigo, classe, data_com, valor FROM proventos WHERE tipo <> 'REST CAP DIN' ORDER BY data_com").all()) {
    const k = `${p.codigo}|${p.classe}`;
    if (!proventosPorClasse.has(k)) proventosPorClasse.set(k, []);
    proventosPorClasse.get(k).push(p);
  }

  const historico = [];
  const fotos = [];

  for (const emp of empresas) {
    const tks = emp.tks.split(',');
    const on = serieClasse(tks.filter(t => t.slice(4) === '3'));
    const pn = serieClasse(tks.filter(t => /^[4-8]$/.test(t.slice(4))));
    if (!on.d.length && !pn.d.length) continue;
    const tickerPrincipal = tks.map(t => [t, volumeMedio(t, hoje)]).sort((a, b) => b[1] - a[1])[0];
    const liquidez = tickerPrincipal[1];
    // Dividend yield pelos proventos por ação da B3 (soma das datas com em 12 meses ÷ preço), como nas
    // plataformas de análise. O fluxo de caixa registra a data do pagamento, que pode cair em outro
    // ano, e no consolidado inclui o que as controladas pagam aos minoritários delas.
    const tp = tickerPrincipal[0], seriePrincipal = series.get(tp);
    const evPrincipal = (eventosPorCodigo.get(tp.slice(0, 4)) ?? []).filter(ev => ev.classe === classeTicker(tp) && ev.data_com < hoje);
    const provs = proventosPorClasse.get(`${tp.slice(0, 4)}|${classeTicker(tp)}`);
    const somaProventos = (ate, anos) => {
      const ini = menosAnos(ate, anos);
      let soma = 0;
      for (const p of provs) if (p.data_com > ini && p.data_com <= ate) soma += p.valor / fatorAte(evPrincipal, p.data_com);
      return soma;
    };
    const precoAjustado = data => {
      const p = seriePrincipal ? precoEm(seriePrincipal, data) : null;
      return p ? p / fatorAte(evPrincipal, data) : null;
    };
    const dyProventos = (data, anos = 1) => {
      const p = provs ? precoAjustado(data) : null;
      return p ? somaProventos(data, anos) / anos / p : null;
    };

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
    const ajusteFre = ajustarPeloFre(linhaTempoAcoes, regs, capitalFre.get(emp.cnpj), on.v.length >= pn.v.length ? on : pn);
    const eventosEmp = [...new Set(tks.map(t => t.slice(0, 4)))].flatMap(c => eventosPorCodigo.get(c) ?? []);
    const ajusteEventos = ajustarPorEventos(linhaTempoAcoes, regs, eventosEmp, ajusteFre ? capitalFre.get(emp.cnpj).dt_receb : null);
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
        dy: dyProventos(data) ?? div(b.ttm.dividendos_pagos, vm),
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
    const percentilProprio = (campo, atual, desde = '', minimo = 24) => {
      const hist = anteriores.filter(x => x.data >= desde).map(x => x[campo]).filter(x => x != null && x > 0).sort((a, b) => a - b);
      // Faixa "normal" do próprio histórico: abaixo do p25 está barato, acima do p75 está caro
      const faixa = { mediana: mediana(hist), p25: hist[Math.floor(0.25 * (hist.length - 1))] ?? null,
        p75: hist[Math.floor(0.75 * (hist.length - 1))] ?? null, n: hist.length };
      if (hist.length < minimo || atual == null) return { ...faixa, pct: null };
      return { ...faixa, pct: 100 * hist.filter(x => x < atual).length / hist.length };
    };
    const histPl = percentilProprio('pl', m.pl);
    const histEvEbit = percentilProprio('ev_ebit', m.ev_ebit);
    // Os mesmos múltiplos só nos últimos 2 anos. A mediana desde 2020 inclui 2020–2022, com juro real
    // perto de zero, quando o mercado aceitava pagar mais caro por qualquer lucro. Com o Tesouro IPCA+
    // a 7–8%, "barato contra 2020" exagerava o desconto: a Multiplan parecia 40% abaixo do normal
    // (mediana 15) e estava só 10–20% abaixo do que valeu em 2025–2026 (10 a 12).
    const doisAnos = menosAnos(hoje, 2);
    const histPl2a = percentilProprio('pl', m.pl, doisAnos, 18);
    const histEvEbit2a = percentilProprio('ev_ebit', m.ev_ebit, doisAnos, 18);
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
    const dy3a = dyProventos(hoje, 3) ?? div(media(anuais.slice(-3).map(r => r.ttm.dividendos_pagos)), m.vm);

    // Graham: preço justo = raiz(22,5 x LPA x VPA), comparado com o preço da classe principal
    const lpa = div(t.lucro_contr, acoesTotal), vpa = div(b.pl_contr, acoesTotal);
    const precoRef = m.p.on;
    const graham = lpa > 0 && vpa > 0 ? Math.sqrt(22.5 * lpa * vpa) : null;

    const alertas = [];
    // Salto de preço numa proporção "redonda" depois do último balanço: provável desdobramento/grupamento
    // que a quantidade de ações ainda não reflete. Quedas reais (ex.: 26/10/2026, -14% no Ibovespa) não batem.
    const serieRef = on.v.length >= pn.v.length ? on : pn;
    const ultimoBalanco = regs.filter(r => r.acoes_on != null).at(-1)?.dt_refer;
    // Se o Formulário de Referência já trouxe a nova quantidade de ações, não há o que alertar
    for (let i = indiceAte(serieRef.d, ultimoBalanco) + 1; !ajusteFre && !ajusteEventos && i > 0 && i < serieRef.d.length; i++) {
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
    let lucroSuspeito = false, lucroNormal = null;
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
      // Lucro "normal" usado nas notas do ranking quando o de 12 meses é suspeito: o menor entre a média dos
      // 3 anos anteriores e o operacional depois de impostos (EBIT × 0,66). Assim um ganho extraordinário não
      // vira nota alta de qualidade e preço (Axia, 11/2026: lucro de R$ 18,6 bi com R$ 13,7 bi de um trimestre só)
      if (lucroSuspeito) {
        const bases = [media3, !financeira && t.ebit != null ? t.ebit * 0.66 : null].filter(Number.isFinite);
        if (bases.length) lucroNormal = Math.max(0, Math.min(t.lucro_contr, ...bases));
      }
    }

    // Variação de 12 meses do código principal, ajustada por desdobramento, grupamento e bonificação
    // (sem o ajuste, o desdobramento de 1:5 da SBSP3 aparecia como queda de 82%)
    // ---------- Proteções contra "barata" enganosa (caso Marcopolo, 3T26) ----------
    // 1) Resultado novo já entregue à CVM e ainda fora da base: tudo acima usa o trimestre anterior
    const entrega = ultimaEntrega.get(String(Number(emp.cd_cvm)));
    const resultadoPendente = entrega && entrega.dt_refer > b.dt_refer ? entrega : null;
    if (resultadoPendente) {
      alertas.push(`Resultado do ${rotuloTri(resultadoPendente.dt_refer)} entregue à CVM em ${dataBr(resultadoPendente.dt_entrega)} e ainda fora da base (a CVM publica os números aos domingos): lucro, P/L e notas são do trimestre anterior`);
    }
    // 2) Lucro do último trimestre muito abaixo do mesmo trimestre do ano anterior: os 12 meses ainda
    //    escondem a piora
    // Valor do trimestre isolado: os balanços trazem o acumulado do ano
    const isolado = (r, campo) => {
      if (!r || r[campo] == null) return null;
      const mes = r.dt_refer.slice(5, 7);
      if (mes === '03') return r[campo];
      const ant = porRef.get(`${r.dt_refer.slice(0, 4)}-${{ '06': '03-31', '09': '06-30', '12': '09-30' }[mes]}`);
      return ant?.[campo] != null && ant.dt_ini === r.dt_ini ? r[campo] - ant[campo] : null;
    };
    const lucroTri = r => isolado(r, 'lucro_contr');
    // 5) Efeito fiscal não recorrente: alíquota efetiva (IR/CSLL ÷ resultado antes dos tributos) do
    //    trimestre muito abaixo da média dos 4 anteriores, ou crédito de imposto. Caso Porto 3T26: 3%
    //    contra ~25% (reversão de impostos diferidos); o lucro contábil sobe e o P/L parece menor.
    const aliquota = r => { const e = isolado(r, 'ebt'), i = isolado(r, 'ir'); return e > 0 && i != null ? -i / e : null; };
    const refsAnteriores = [...porRef.keys()].filter(k => k < b.dt_refer).sort().slice(-4);
    const aliquotasAntes = refsAnteriores.map(k => aliquota(porRef.get(k))).filter(x => x != null && x >= 0 && x < 0.6);
    const aliquotaTri = aliquota(b), aliquotaMedia = aliquotasAntes.length >= 2 ? media(aliquotasAntes) : null;
    const efeitoFiscal = aliquotaTri != null && aliquotaMedia != null && (aliquotaTri < 0 || aliquotaMedia - aliquotaTri > 0.10);
    if (efeitoFiscal) {
      const ebtTri = isolado(b, 'ebt'), lucroTriAtual = lucroTri(b);
      // Lucro do trimestre se o imposto tivesse a alíquota média (aproximado, sem separar minoritários)
      const normalizado = ebtTri > 0 ? ebtTri * (1 - aliquotaMedia) : null;
      alertas.push(`Lucro do ${rotuloTri(b.dt_refer)} com efeito fiscal não recorrente: alíquota efetiva de ${br(100 * aliquotaTri, 0)}% contra ${br(100 * aliquotaMedia, 0)}% em média nos trimestres anteriores`
        + (normalizado != null && lucroTriAtual != null ? `; com a alíquota média, o lucro do trimestre seria cerca de R$ ${br(normalizado / 1e6, 0)} mi, e não R$ ${br(lucroTriAtual / 1e6, 0)} mi. O P/L fica mais baixo do que o lucro recorrente justifica` : ''));
    }
    const triAtual = lucroTri(b), triAnoAntes = lucroTri(porRef.get(menosAnos(b.dt_refer, 1)));
    const lucroTriVar = triAtual != null && triAnoAntes > 0 ? triAtual / triAnoAntes - 1 : null;
    if (lucroTriVar != null && lucroTriVar < -0.3) {
      alertas.push(`Lucro do ${rotuloTri(b.dt_refer)} foi ${br(-100 * lucroTriVar, 0)}% menor que um ano antes: os 12 meses ainda não mostram toda a piora`);
    }
    // 3) Dividendo de 12 meses muito acima do normal: pagamento extraordinário que não se repete
    const dividendoExtra = m.dy != null && histDy.mediana > 0 && m.dy >= 2.5 * histDy.mediana && m.dy - histDy.mediana >= 0.05;
    if (dividendoExtra) {
      alertas.push(`Dividendo de 12 meses (${br(100 * m.dy, 1)}%) é ${br(m.dy / histDy.mediana, 0)} vezes a mediana desde 2020 (${br(100 * histDy.mediana, 1)}%): inclui pagamento extraordinário ou queda forte do preço`);
    }
    // 4) Queda forte de preço contra o Ibovespa em 3 meses: o P/L usa o lucro passado e o mercado
    //    pode estar antecipando lucro menor
    const var3m = s => { const i = indiceAte(s?.d ?? [], hoje), j = indiceAte(s?.d ?? [], menosMeses(hoje, 3)); return i >= 0 && j >= 0 ? s.p[i] / s.p[j] - 1 : null; };
    const quedaAcao = var3m(seriePrincipal), quedaIbov = var3m(serieIbov);
    const quedaRelativa = quedaAcao != null && quedaIbov != null ? quedaAcao - quedaIbov : null;
    const quedaForte = quedaAcao != null && quedaAcao < -0.25 && quedaRelativa < -0.15;
    if (quedaForte) {
      alertas.push(`Ação caiu ${br(-100 * quedaAcao, 0)}% em 3 meses (Ibovespa ${br(100 * quedaIbov, 0)}%): o P/L usa o lucro passado e a queda pode estar antecipando lucro menor`);
    }

    const precoSerie = series.get(tickerPrincipal[0]) ?? serieRef;
    const iHoje = indiceAte(precoSerie.d, hoje), i12 = indiceAte(precoSerie.d, menosAnos(hoje, 1));
    const variacao12m = i12 >= 0 && iHoje >= 0
      ? (precoSerie.p[iHoje] / fatorAte(evPrincipal, precoSerie.d[iHoje])) / (precoSerie.p[i12] / fatorAte(evPrincipal, precoSerie.d[i12])) - 1 : null;

    fotos.push({
      cnpj: emp.cnpj, nome: emp.nome, ticker: tickerPrincipal[0], tickers: tks.join(' '),
      setor: (emp.setor ?? '').replace(/^Emp\. Adm\. Part\. - /, '').replace('Sem Setor Principal', 'Holdings diversificadas'),
      segmento: emp.segmento, controle: emp.controle, financeira: financeira ? 1 : 0,
      data: hoje, dt_balanco: b.dt_refer, preco: series.get(tickerPrincipal[0])?.p.at(-1) ?? null,
      variacao_12m: variacao12m,
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
      payout: provs && m.dy != null ? div(m.dy * m.vm, positivo(t.lucro_contr)) : div(t.dividendos_pagos, positivo(t.lucro_contr)),
      // números absolutos (12 meses)
      receita_12m: t.receita, lucro_12m: t.lucro_contr, ebitda_12m: m.ebitda, dividendos_12m: t.dividendos_pagos,
      // comparação com o próprio histórico desde 2020
      pl_mediana: histPl.mediana, pl_percentil: histPl.pct, pl_p25: histPl.p25, pl_p75: histPl.p75,
      ev_ebit_mediana: histEvEbit.mediana, ev_ebit_percentil: histEvEbit.pct,
      pvp_mediana: histPvp.mediana, pvp_percentil: histPvp.pct, dy_mediana: histDy.mediana,
      // e só nos últimos 2 anos (mesmo patamar de juros de hoje)
      pl_mediana_2a: histPl2a.mediana, pl_percentil_2a: histPl2a.pct, pl_p25_2a: histPl2a.p25, pl_p75_2a: histPl2a.p75,
      ev_ebit_mediana_2a: histEvEbit2a.mediana, ev_ebit_percentil_2a: histEvEbit2a.pct,
      meses_historico: Math.max(histPl.n, histEvEbit.n),
      // Graham e Bazin como margem sobre o preço atual
      graham_margem: graham ? graham / precoRef - 1 : null,
      bazin_margem: dy3a != null ? dy3a / 0.06 - 1 : null,
      lucro_suspeito: lucroSuspeito ? 1 : 0, lucro_normalizado: lucroNormal,
      resultado_pendente: resultadoPendente ? `${rotuloTri(resultadoPendente.dt_refer)}|${resultadoPendente.dt_entrega}` : null,
      lucro_tri_var: lucroTriVar,
      aliquota_tri: aliquotaTri, aliquota_media: aliquotaMedia,
      // Motivos para conferir antes de confiar no "barata": a página troca "lucro intacto" por "conferir"
      conferir: [resultadoPendente && 'resultado novo fora da base', lucroTriVar != null && lucroTriVar < -0.3 && 'lucro do último trimestre caiu',
        efeitoFiscal && 'efeito fiscal no lucro',
        dividendoExtra && 'dividendo extraordinário', quedaForte && 'queda forte do preço'].filter(Boolean).join(' | ') || null,
      queda_3m: quedaAcao, queda_3m_ibov: quedaIbov,
      elegivel: liquidez >= LIQUIDEZ_MINIMA && !desatualizado && t.lucro_contr != null ? 1 : 0,
      alertas: alertas.join(' | '),
      acoes_fre: [ajusteFre?.texto, ajusteEventos].filter(Boolean).join(". ") || null,
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

// Desdobramento, grupamento ou bonificação registrado na B3 depois do último balanço (e depois do FRE,
// se ele já trouxe quantidade nova): multiplica a quantidade de ações da classe a partir do pregão
// seguinte à data com. Sem isso o valor de mercado fica errado até o próximo balanço (ex.: ORVR, 1:4).
function ajustarPorEventos(linha, regs, eventos, limite) {
  const ult = regs.filter(r => r.acoes_on != null).at(-1);
  if (!ult || !eventos.length) return null;
  const desde = limite && limite > ult.dt_refer ? limite : ult.dt_refer;
  // PN, PNA e PNB costumam ter um evento cada: conta uma vez só para o grupo das preferenciais
  const vistos = new Set();
  const aplicaveis = eventos.filter(ev => ev.data_com > desde).sort((a, b) => a.data_com.localeCompare(b.data_com)).filter(ev => {
    const chave = `${ev.classe === 'ON' ? 'ON' : 'PN'}|${ev.data_com}|${ev.tipo}|${ev.fator}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  if (!aplicaveis.length) return null;
  for (const ev of aplicaveis) {
    const ant = linha.at(-1);
    const m = ev.tipo === 'GRUPAMENTO' ? ev.fator : 1 + ev.fator / 100;
    const dia = new Date(Date.parse(`${ev.data_com}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
    linha.push({ desde: dia, on: ev.classe === 'ON' ? ant.on * m : ant.on, pn: ev.classe === 'ON' ? ant.pn : ant.pn * m });
  }
  const nomes = { DESDOBRAMENTO: 'desdobramento', GRUPAMENTO: 'grupamento', BONIFICACAO: 'bonificação' };
  return `Quantidade de ações ajustada por ${aplicaveis.map(ev => `${nomes[ev.tipo] ?? ev.tipo} com data com em ${ev.data_com.split('-').reverse().join('/')}`).join(' e ')}, registrado na B3 depois do último balanço`;
}

// Aumento de capital, bonificação ou desdobramento depois do último balanço: a quantidade nova vem
// do Formulário de Referência (FRE). Compara com o total bruto do balanço (o FRE não desconta
// tesouraria; algumas empresas já informam o balanço sem ela) e aplica a variação a partir da data
// de entrega do FRE. Variação acima de 30% só vale se o preço confirmar desdobramento/grupamento.
function ajustarPeloFre(linha, regs, fre, serieRef) {
  const ult = regs.filter(r => r.acoes_on_bruto != null).at(-1);
  if (!fre || !ult || fre.dt_receb <= ult.dt_refer) return null;
  const bruto = ult.acoes_on_bruto + ult.acoes_pn_bruto;
  const tesouraria = bruto - (ult.acoes_on + ult.acoes_pn);
  const totalFre = fre.acoes_on + fre.acoes_pn;
  if (!(bruto > 0) || !(totalFre > 0)) return null;
  // Unidades: há empresas que informam o balanço em milhares e o FRE em unidades
  const q0 = totalFre / bruto;
  const escala = q0 > 500 && q0 < 2000 ? 1000 : q0 > 0.0005 && q0 < 0.002 ? 0.001 : 1;
  const igual = base => Math.abs(totalFre / (base * escala) - 1) < 0.001;
  if (igual(bruto) || igual(bruto + tesouraria)) return null;
  const q = totalFre / (bruto * escala);
  if (Math.abs(q - 1) > 0.3) {
    // Mudança grande: só se houve salto de preço compatível depois do balanço
    const ini = indiceAte(serieRef.d, ult.dt_refer) + 1;
    let confirmado = false;
    for (let i = Math.max(ini, 1); i < serieRef.d.length; i++) {
      if (Math.abs(Math.log(serieRef.p[i] / serieRef.p[i - 1]) + Math.log(q)) < 0.1) { confirmado = true; break; }
    }
    if (!confirmado) return null;
  }
  const ant = linha.at(-1);
  const fator = (frePorClasse, brutoClasse) => brutoClasse > 0 && frePorClasse > 0 ? frePorClasse / (brutoClasse * escala) : q;
  linha.push({
    desde: fre.dt_receb,
    on: ant.on * fator(fre.acoes_on, ult.acoes_on_bruto),
    pn: ant.pn * fator(fre.acoes_pn, ult.acoes_pn_bruto),
  });
  const variacao = Math.round(1000 * (q - 1)) / 10;
  return { q, texto: `Quantidade de ações atualizada pelo Formulário de Referência entregue em ${fre.dt_receb.split('-').reverse().join('/')} (${variacao > 0 ? '+' : ''}${br(variacao, 1)}% desde o balanço de ${ult.dt_refer.split('-').reverse().join('/')})` };
}

// Percentil (0 a 100) de cada valor dentro do grupo. maiorMelhor=false inverte.
function percentis(grupo, campo, maiorMelhor = true) {
  const valor = typeof campo === 'function' ? campo : f => f[campo];
  const vals = grupo.map(valor).filter(Number.isFinite).sort((a, b) => a - b);
  const pct = new Map();
  for (const f of grupo) {
    const v = valor(f);
    if (!Number.isFinite(v) || vals.length < 2) continue;
    let lo = 0, hi = vals.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] < v) lo = m + 1; else hi = m; }
    let p = 100 * lo / (vals.length - 1);
    pct.set(f, maiorMelhor ? p : 100 - p);
  }
  return f => pct.get(f) ?? null;
}

// Percentil do múltiplo contra o próprio histórico pela régua mais exigente: desde 2020 e últimos 2 anos.
// Só é "barata" se for barata contra os dois (o pior dos percentis).
function pctRegua(f, campo) {
  const v = [f[`${campo}_percentil`], f[`${campo}_percentil_2a`]].filter(x => x != null);
  return v.length ? Math.max(...v) : null;
}

// Notas de 0 a 100 em cada pilar, relativas às outras empresas do mesmo grupo
function pontuar(grupo, financeiras) {
  if (!grupo.length) return;
  // Com lucro suspeito, as medidas que dependem do lucro (ROE, lucro/preço, margem, crescimento do lucro) entram
  // nas notas recalculadas pelo lucro normalizado; sem base para normalizar, ficam de fora
  const fatorLucro = f => !f.lucro_suspeito ? 1 : f.lucro_normalizado != null && f.lucro_12m > 0 ? f.lucro_normalizado / f.lucro_12m : null;
  const peloLucro = campo => f => { const k = fatorLucro(f); return k == null || f[campo] == null ? null : f[campo] * k; };
  const cagrNota = f => {
    const k = fatorLucro(f);
    return k == null || f.cagr_lucro_5a == null ? null : k === 1 ? f.cagr_lucro_5a : k > 0 ? (1 + f.cagr_lucro_5a) * k ** (1 / 5) - 1 : null;
  };
  const P = {};
  for (const [campo, maior, valor] of [['roe', 1, peloLucro('roe')], ['roic', 1], ['earnings_yield', 1, peloLucro('earnings_yield')], ['ebit_ev', 1], ['pvp', 0],
    ['div_liq_ebitda', 0], ['liq_corrente', 1], ['div_liq_pl', 0], ['cagr_receita_5a', 1], ['cagr_lucro_5a', 1, cagrNota]]) {
    P[campo] = percentis(grupo, valor ?? campo, !!maior);
  }
  // Margem é comparada dentro do setor: varejo e software não têm a mesma margem "normal"
  const porSetor = Map.groupBy(grupo, f => f.setor);
  const margemSetor = new Map();
  const margem = peloLucro('margem_liq');
  for (const membros of porSetor.values()) {
    const p = membros.length >= 4 ? percentis(membros, margem) : percentis(grupo, margem);
    for (const f of membros) margemSetor.set(f, p(f));
  }

  for (const f of grupo) {
    const consistencia = f.anos_lucro_base ? 100 * f.anos_lucro / f.anos_lucro_base : null;
    // P/L contra o histórico também usa o lucro inflado: com lucro suspeito vale só o EV/EBIT (operacional)
    const pctHist = f.lucro_suspeito ? pctRegua(f, 'ev_ebit') : pctRegua(f, 'pl') ?? pctRegua(f, 'ev_ebit');
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

    const usaPl = f.pl_percentil != null;
    const pctHist = usaPl ? pctRegua(f, 'pl') : pctRegua(f, 'ev_ebit');
    const ok =f.elegivel && f.lucro_12m > 0 && pctHist != null && pctHist <= 25 && !f.alertas.includes('desdobramento') && !f.lucro_suspeito
      && f.nota_qualidade >= 60 && (f.financeira || f.nota_saude >= 50);
    f.oportunidade = ok ? 1 : 0;
    f.nota_oportunidade = ok ? Math.round(0.5 * media([f.nota_qualidade, f.nota_saude]) + 0.5 * (100 - pctHist)) : null;
    if (ok) {
      const campo = usaPl ? 'P/L' : 'EV/EBIT';
      const atual = usaPl ? f.pl : f.ev_ebit, med = usaPl ? f.pl_mediana : f.ev_ebit_mediana;
      const med2a = usaPl ? f.pl_mediana_2a : f.ev_ebit_mediana_2a;
      const contra = (m, quando) => `${br(m, 1)} ${quando} (${Math.round(100 * (atual / m - 1))}%)`;
      f.motivo = `${campo} ${br(atual, 1)} contra mediana de ${contra(med, 'desde 2020')}`
        + (med2a != null ? ` e ${contra(med2a, 'nos últimos 2 anos')}` : '')
        + `; ROE ${br(100 * f.roe, 0)}%`
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
