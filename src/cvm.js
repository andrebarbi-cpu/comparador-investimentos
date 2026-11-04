// Dados oficiais das companhias abertas: cadastro, códigos de negociação e demonstrações
// financeiras (DFP anual e ITR trimestral). Fonte: https://dados.cvm.gov.br
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baixar, abrirZip, lerCsv, log, RAIZ } from './util.js';
import { transacao, arquivoMudou, marcarArquivo } from './db.js';

const BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA';

// ---------- Cadastro e tickers ----------

export async function atualizarCadastro(db, anoFim) {
  const url = `${BASE}/CAD/DADOS/cad_cia_aberta.csv`;
  const arq = await baixar(url, 'cvm/cad_cia_aberta.csv', { forcar: true });
  const texto = readFileSync(arq).toString('latin1');

  // O cadastro tem uma linha por registro histórico; a ativa prevalece
  const porCnpj = new Map();
  for (const r of lerCsv(texto)) {
    if (r.CATEG_REG !== 'Categoria A') continue;
    const atual = porCnpj.get(r.CNPJ_CIA);
    if (!atual || r.SIT === 'ATIVO') porCnpj.set(r.CNPJ_CIA, r);
  }

  // Tickers e segmento de listagem vêm do Formulário Cadastral (FCA) dos últimos anos.
  // O preenchimento é irregular: há empresas com "data de fim de negociação" em ação ativa (Raízen,
  // C&A) e mercado em branco (Multilaser), então esses campos não servem de filtro.
  const classeDe = cod => (cod.slice(4) === '3' ? 'ON' : cod.slice(4) === '11' ? 'UNIT' : 'PN');
  const tickers = new Map(), segmentos = new Map();
  for (let ano = anoFim - 2; ano <= anoFim; ano++) {
    const zipUrl = `${BASE}/DOC/FCA/DADOS/fca_cia_aberta_${ano}.zip`;
    const zipArq = await baixar(zipUrl, `cvm/fca_cia_aberta_${ano}.zip`, { forcar: ano === anoFim });
    if (!zipArq) continue;
    const zip = abrirZip(zipArq);
    for (const r of lerCsv(zip.texto(`fca_cia_aberta_valor_mobiliario_${ano}.csv`))) {
      const cod = (r.Codigo_Negociacao ?? '').trim().toUpperCase();
      // Ticker começa com letra (B3SA3 tem dígito no meio; o "000000" do BTG não é ticker)
      if ((r.Mercado && r.Mercado !== 'Bolsa') || !/^[A-Z][A-Z0-9]{3}\d{1,2}$/.test(cod)) continue;
      if (!/^(A[çc][õo]es|Units?)/i.test(r.Valor_Mobiliario ?? '')) continue;
      tickers.set(cod, { cnpj: r.CNPJ_Companhia, classe: classeDe(cod) });
      if (r.Segmento) segmentos.set(r.CNPJ_Companhia, r.Segmento);
    }
  }
  // Correções manuais para quem preencheu o cadastro errado (ex.: BTG com "000000")
  const correcoes = JSON.parse(readFileSync(join(RAIZ, 'config', 'correcoes_cadastro.json'), 'utf8'));
  for (const [cnpj, cods] of Object.entries(correcoes.tickers)) {
    if (cnpj.startsWith('_')) continue;
    for (const cod of cods) tickers.set(cod, { cnpj, classe: classeDe(cod) });
  }
  // Papéis negociados na B3 sem cadastro herdam a empresa de outro código com o mesmo prefixo
  // (ex.: KLBN4 a partir de KLBN11)
  const porPrefixo = new Map();
  for (const [cod, t] of tickers) {
    const p = cod.slice(0, 4);
    porPrefixo.set(p, porPrefixo.has(p) && porPrefixo.get(p) !== t.cnpj ? null : t.cnpj);
  }
  let herdados = 0;
  for (const { ticker } of db.prepare(`SELECT DISTINCT ticker FROM cotacoes WHERE data >= date('now', '-90 day')`).all()) {
    const cnpj = porPrefixo.get(ticker.slice(0, 4));
    if (cnpj && !tickers.has(ticker) && /^[A-Z0-9]{4}([3-8]|11)$/.test(ticker)) {
      tickers.set(ticker, { cnpj, classe: classeDe(ticker) });
      herdados++;
    }
  }

  transacao(db, () => {
    const insEmp = db.prepare(`INSERT INTO empresas (cnpj, cd_cvm, nome, setor, situacao, controle, segmento)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cnpj) DO UPDATE SET cd_cvm=excluded.cd_cvm, nome=excluded.nome,
      setor=excluded.setor, situacao=excluded.situacao, controle=excluded.controle,
      segmento=COALESCE(excluded.segmento, empresas.segmento)`);
    for (const r of porCnpj.values()) {
      const nome = correcoes.nomes[r.CNPJ_CIA] ?? (r.DENOM_COMERC || r.DENOM_SOCIAL);
      insEmp.run(r.CNPJ_CIA, r.CD_CVM, nome, r.SETOR_ATIV || null,
        r.SIT, r.CONTROLE_ACIONARIO || null, segmentos.get(r.CNPJ_CIA) ?? null);
    }
    // A lista de ações é refeita a cada vez, para sair o que deixou de existir ou entrou por engano
    db.exec("DELETE FROM tickers WHERE tipo = 'acao'");
    const insTic = db.prepare(`INSERT INTO tickers (ticker, cnpj, classe, tipo) VALUES (?, ?, ?, 'acao')
      ON CONFLICT(ticker) DO UPDATE SET cnpj=excluded.cnpj, classe=excluded.classe, tipo='acao'`);
    for (const [cod, t] of tickers) insTic.run(cod, t.cnpj, t.classe);
  });
  log(`Cadastro: ${porCnpj.size} empresas, ${tickers.size} tickers de ações (${herdados} pelo prefixo)`);
}

// ---------- Formulário de Referência (quantidade de ações entre balanços) ----------

// Guarda a quantidade de ações integralizadas da versão mais recente do FRE de cada empresa.
// O arquivo aberto da CVM só traz a última versão; o ano anterior entra primeiro e o atual por cima.
export async function atualizarCapitalFre(db, anoFim) {
  const ins = db.prepare(`INSERT OR REPLACE INTO capital_fre (cnpj, versao, dt_receb, acoes_on, acoes_pn) VALUES (?, ?, ?, ?, ?)`);
  let n = 0;
  for (const ano of [anoFim - 1, anoFim]) {
    const url = `${BASE}/DOC/FRE/DADOS/fre_cia_aberta_${ano}.zip`;
    const arq = await baixar(url, `cvm/fre_cia_aberta_${ano}.zip`, { forcar: ano === anoFim });
    if (!arq) continue;
    const zip = abrirZip(arq);
    const recebido = new Map();
    for (const r of lerCsv(zip.texto(`fre_cia_aberta_${ano}.csv`))) recebido.set(`${r.CNPJ_CIA}|${r.VERSAO}`, r.DT_RECEB);
    transacao(db, () => {
      for (const r of lerCsv(zip.texto(`fre_cia_aberta_capital_social_${ano}.csv`))) {
        if (r.Tipo_Capital !== 'Capital Integralizado') continue;
        const on = Number(r.Quantidade_Acoes_Ordinarias) || 0, pn = Number(r.Quantidade_Acoes_Preferenciais) || 0;
        const dt = recebido.get(`${r.CNPJ_Companhia}|${r.Versao}`);
        if (!(on + pn > 0) || !dt) continue;
        ins.run(r.CNPJ_Companhia, Number(r.Versao), dt, on, pn);
        n++;
      }
    });
  }
  log(`Formulário de Referência: quantidade de ações de ${n} empresas`);
}

// ---------- Demonstrações financeiras ----------

const DEMONSTRACOES = ['BPA', 'BPP', 'DRE', 'DFC_MI', 'DFC_MD', 'DVA'];

// Baixa e processa um ano de DFP ou ITR. Com `soSeMudou`, pula se o arquivo remoto não mudou.
export async function atualizarDemonstracoes(db, tipo, ano, { soSeMudou = false } = {}) {
  const t = tipo.toLowerCase();
  const url = `${BASE}/DOC/${tipo}/DADOS/${t}_cia_aberta_${ano}.zip`;
  const st = await arquivoMudou(db, url);
  if (!st.existe || (soSeMudou && !st.mudou)) return 0;
  const arq = await baixar(url, `cvm/${t}_cia_aberta_${ano}.zip`, { forcar: soSeMudou });
  if (!arq) return 0;
  const zip = abrirZip(arq);

  // 1) Índice: versão mais recente de cada (empresa, data de referência)
  const recs = new Map();
  for (const r of lerCsv(zip.texto(`${t}_cia_aberta_${ano}.csv`))) {
    const chave = `${r.CNPJ_CIA}|${r.DT_REFER}`;
    const versao = Number(r.VERSAO);
    const atual = recs.get(chave);
    if (atual && atual.versao >= versao) continue;
    recs.set(chave, { cnpj: r.CNPJ_CIA, dt_refer: r.DT_REFER, versao, dt_receb: r.DT_RECEB,
      contas: { con: {}, ind: {} }, acoes: null });
  }

  // 2) Contas até o 3º nível (ex.: 6.02.01), só do exercício atual e da versão mais recente
  for (const dem of DEMONSTRACOES) {
    const chaveDem = dem.startsWith('DFC') ? 'DFC' : dem;
    for (const escopo of ['con', 'ind']) {
      const texto = zip.texto(`${t}_cia_aberta_${dem}_${escopo}_${ano}.csv`);
      for (const r of lerCsv(texto)) {
        if (r.ORDEM_EXERC !== 'ÚLTIMO') continue;
        const rec = recs.get(`${r.CNPJ_CIA}|${r.DT_REFER}`);
        if (!rec || Number(r.VERSAO) !== rec.versao) continue;
        const cod = r.CD_CONTA;
        if (cod.split('.').length > 3) continue;
        const mult = r.ESCALA_MOEDA === 'MIL' ? 1000 : 1;
        const vl = parseFloat(r.VL_CONTA) * mult;
        if (!Number.isFinite(vl)) continue;
        const mapa = (rec.contas[escopo][chaveDem] ??= new Map());
        const dtIni = r.DT_INI_EXERC || null;
        const ex = mapa.get(cod);
        // No ITR a DRE vem duas vezes: o trimestre e o acumulado do ano. Fica o acumulado.
        if (!ex || (dtIni && ex.dtIni && dtIni < ex.dtIni)) mapa.set(cod, { ds: r.DS_CONTA, vl, dtIni });
      }
    }
  }

  // 3) Quantidade de ações (descontadas as em tesouraria)
  for (const r of lerCsv(zip.texto(`${t}_cia_aberta_composicao_capital_${ano}.csv`))) {
    const rec = recs.get(`${r.CNPJ_CIA}|${r.DT_REFER}`);
    if (!rec || Number(r.VERSAO) !== rec.versao) continue;
    const n = c => Number(r[c]) || 0;
    rec.acoes = {
      on: n('QT_ACAO_ORDIN_CAP_INTEGR') - n('QT_ACAO_ORDIN_TESOURO'),
      pn: n('QT_ACAO_PREF_CAP_INTEGR') - n('QT_ACAO_PREF_TESOURO'),
      // Brutas (com tesouraria): comparáveis ao Formulário de Referência, que não desconta tesouraria
      brutoOn: n('QT_ACAO_ORDIN_CAP_INTEGR'),
      brutoPn: n('QT_ACAO_PREF_CAP_INTEGR'),
    };
  }

  // 4) Extrai os campos padronizados e grava
  const ins = db.prepare(`INSERT OR REPLACE INTO fundamentos (cnpj, dt_refer, tipo, dt_ini, dt_receb, versao,
    consolidado, receita, lucro_bruto, ebit, equivalencia, da, lucro_liq, lucro_contr, fco, fci, fcf, capex, dividendos_pagos,
    ativo_total, ativo_circ, caixa, passivo_circ, divida_cp, divida_lp, pl, pl_contr, acoes_on, acoes_pn,
    acoes_on_bruto, acoes_pn_bruto)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let gravados = 0;
  transacao(db, () => {
    for (const rec of recs.values()) {
      // Consolidado só vale se tiver números: há empresas que entregam o consolidado zerado (ex.: TIM, DFP 2025)
      const temValores = esc => !!(esc.DRE?.get('3.01')?.vl || esc.BPA?.get('1')?.vl);
      const temCon = temValores(rec.contas.con);
      const c = temCon ? rec.contas.con : rec.contas.ind;
      if (!c.BPA && !c.DRE) continue;
      const f = extrairCampos(c, temCon ? rec.contas.ind : null);
      ins.run(rec.cnpj, rec.dt_refer, tipo, f.dt_ini, rec.dt_receb, rec.versao, temCon ? 1 : 0,
        f.receita, f.lucro_bruto, f.ebit, f.equivalencia, f.da, f.lucro_liq, f.lucro_contr, f.fco, f.fci, f.fcf, f.capex,
        f.dividendos_pagos, f.ativo_total, f.ativo_circ, f.caixa, f.passivo_circ, f.divida_cp, f.divida_lp,
        f.pl, f.pl_contr, rec.acoes?.on ?? null, rec.acoes?.pn ?? null,
        rec.acoes?.brutoOn ?? null, rec.acoes?.brutoPn ?? null);
      gravados++;
    }
  });
  marcarArquivo(db, url, st.modificado);
  log(`${tipo} ${ano}: ${gravados} demonstrações`);
  return gravados;
}

// Traduz o plano de contas da CVM para campos fixos. Os códigos de 1º e 2º nível são
// padronizados; abaixo disso cada empresa nomeia como quer, então a busca é pela descrição.
// `outro` é o escopo individual, usado quando o consolidado não abre uma linha (ex.: bancos).
function extrairCampos(c, outro) {
  const v = (dem, cod, padrao) => {
    const x = c[dem]?.get(cod);
    if (!x) return null;
    if (padrao && !padrao.test(x.ds)) return null;
    return x.vl;
  };
  const filhosDe = (mapa, pai) => [...(mapa?.entries() ?? [])]
    .filter(([cod]) => cod.startsWith(pai + '.') && cod.split('.').length === pai.split('.').length + 1)
    .map(([cod, x]) => ({ cod, ...x }));
  const filhos = (dem, pai) => filhosDe(c[dem], pai);
  // Soma das saídas de caixa nas contas cuja descrição casa com o padrão; null se nenhuma conta casa
  const somaAbsNegativos = (lista, padrao) => {
    const contas = lista.filter(x => padrao.test(x.ds));
    return contas.length ? contas.filter(x => x.vl < 0).reduce((s, x) => s - x.vl, 0) : null;
  };
  const DIVIDENDOS = /dividendo|juros sobre (o )?capital|jcp|provento|remunera[çc][ãa]o aos acionistas/i;

  // Patrimônio líquido: a conta de 2º nível do passivo chamada "Patrimônio Líquido..."
  const contaPl = filhos('BPP', '2').find(x => /patrim[ôo]nio l[íi]quido/i.test(x.ds));
  const minoritarios = contaPl ? filhos('BPP', contaPl.cod).find(x => /n[ãa]o.controlador/i.test(x.ds)) : null;

  // Lucro: a última conta de 2º nível da DRE que fala em lucro/resultado do período
  const contasLucro = filhos('DRE', '3').filter(x => /(lucro|resultado).*(per[íi]odo|exerc[íi]cio)/i.test(x.ds));
  const contaLucro = contasLucro.at(-1);
  const contr = contaLucro
    ? filhos('DRE', contaLucro.cod).find(x => /controladora/i.test(x.ds) && !/n[ãa]o.controlador/i.test(x.ds))
    : null;

  // Lucro de coligadas entra no EBIT da CVM; separado para não inflar o EBITDA de holdings
  const equivalencia = filhos('DRE', '3.04').find(x => /equival[êe]ncia/i.test(x.ds));
  const da = v('DVA', '7.04.01', /deprecia|amortiza/i);
  const caixa = (v('BPA', '1.01.01', /caixa/i) ?? 0) + (v('BPA', '1.01.02', /aplica/i) ?? 0);
  const fluxoInv = filhos('DFC', '6.02');
  const fluxoFin = filhos('DFC', '6.03');

  return {
    dt_ini: c.DRE?.get('3.01')?.dtIni ?? c.DFC?.get('6.01')?.dtIni ?? null,
    receita: v('DRE', '3.01'),
    lucro_bruto: v('DRE', '3.03', /bruto/i),
    ebit: v('DRE', '3.05', /antes do resultado financeiro/i),
    equivalencia: equivalencia?.vl ?? null,
    da: da == null ? null : Math.abs(da),
    lucro_liq: contaLucro?.vl ?? null,
    // Algumas empresas deixam a linha "atribuído aos controladores" zerada no ITR; aí vale o lucro total
    lucro_contr: (contr?.vl || null) ?? contaLucro?.vl ?? null,
    fco: v('DFC', '6.01'),
    fci: v('DFC', '6.02'),
    fcf: v('DFC', '6.03'),
    capex: c.DFC ? (somaAbsNegativos(fluxoInv, /imobilizado|intang[íi]vel/i) ?? 0) : null,
    dividendos_pagos: c.DFC ? (somaAbsNegativos(fluxoFin, DIVIDENDOS)
      ?? somaAbsNegativos(filhosDe(outro?.DFC, '6.03'), DIVIDENDOS) ?? 0) : null,
    ativo_total: v('BPA', '1'),
    ativo_circ: v('BPA', '1.01', /circulante/i),
    caixa: caixa || null,
    passivo_circ: v('BPP', '2.01', /circulante/i),
    divida_cp: v('BPP', '2.01.04', /empr[ée]stimo|financiamento/i),
    divida_lp: v('BPP', '2.02.01', /empr[ée]stimo|financiamento/i),
    pl: contaPl?.vl ?? null,
    pl_contr: contaPl ? contaPl.vl - (minoritarios?.vl ?? 0) : null,
  };
}
