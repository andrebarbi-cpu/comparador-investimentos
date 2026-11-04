'use strict';
// Comparador de Investimentos: página estática que lê window.DADOS (gerado por src/exportar.js).

const D = window.DADOS;
const $ = (sel, raiz = document) => raiz.querySelector(sel);

// ---------- Formatação ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = x => typeof x === 'number' && Number.isFinite(x);
const num = (x, d = 1) => ok(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const pct = (x, d = 1) => ok(x) ? num(x * 100, d) + '%' : '–';
const pctSinal = (x, d = 1) => ok(x) ? (x > 0 ? '+' : '') + pct(x, d) : '–';
const dinheiro = x => {
  if (!ok(x)) return '–';
  const a = Math.abs(x);
  if (a >= 1e9) return `R$ ${num(x / 1e9, a >= 1e11 ? 0 : 1)} bi`;
  if (a >= 1e6) return `R$ ${num(x / 1e6, a >= 1e8 ? 0 : 1)} mi`;
  return `R$ ${num(x, 2)}`;
};
const data = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
const mesAno = ym => { const [a, m] = ym.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][m - 1]}/${a}`; };
const classeSinal = x => ok(x) ? (x > 0 ? 'positivo' : x < 0 ? 'negativo' : '') : '';
const medidor = v => ok(v) ? `<span class="medidor" title="${v} de 100"><i style="--v:${v}%"></i><span>${v}</span></span>` : '<span class="vazio">–</span>';
const ICONE_ALERTA = '<svg class="icone-alerta" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 19 18H1Z" fill="var(--atencao)"/><path d="M10 8v4.5" stroke="#1a1a19" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="15" r="1.1" fill="#1a1a19"/></svg>';
const listaAlertas = texto => texto ? `<ul class="alertas">${texto.split(' | ').map(a => `<li>${ICONE_ALERTA}<span>${esc(a)}</span></li>`).join('')}</ul>` : '';
const selos = e => {
  const s = [];
  if (naCarteira.has(e.cnpj)) s.push('Na carteira');
  if (e.oportunidade) s.push('Oportunidade');
  if (e.selo_graham) s.push('Graham');
  if (e.selo_bazin) s.push('Bazin');
  if (e.selo_magica) s.push(`Fórmula Mágica #${e.magica_posicao}`);
  return s.length ? `<span class="selos">${s.map(x => `<span class="selo">${x}</span>`).join('')}</span>` : '';
};

// ---------- Índices ----------
const porTicker = new Map();
const porCnpj = new Map();
for (const e of D.empresas) {
  porCnpj.set(e.cnpj, e);
  for (const t of e.tickers.split(' ')) porTicker.set(t, e);
}
const listaTickers = [...porTicker.keys()].sort();
const etf = Object.fromEntries(D.etfs.map(e => [e.ticker, e]));
const ipcaRef = D.empresas.find(e => ok(e.tesouro_ipca_ref))?.tesouro_ipca_ref;

// "29/10/2026" no fechamento oficial; "03/11/2026 às 15:27 (parcial)" durante o pregão
const horaParcial = D.precos_parciais?.hora
  ? new Date(D.precos_parciais.hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : null;
const rotuloPrecos = () => D.precos_parciais ? `${data(D.data_precos)} às ${horaParcial ?? '?'} (parcial)` : data(D.data_precos);

// ---------- Topo ----------
function montarTopo() {
  $('#atualizado').textContent = D.precos_parciais
    ? `Preços de ${rotuloPrecos()}, com 15 min de atraso · fechamento oficial à noite`
    : `Preços de fechamento de ${data(D.data_precos)} · gerado em ${new Date(D.gerado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
  const b = etf.BOVA11, m = D.macro;
  const itens = [];
  if (b) itens.push(`Ibovespa (BOVA11) <b class="${classeSinal(b.ret_1m)}">${pctSinal(b.ret_1m)}</b> em 1 mês, <b>${pct(-b.distancia_maxima_52s, 0)}</b> abaixo do pico de 52 semanas`);
  if (m.selic) itens.push(`Selic <b>${num(m.selic.valor, 2)}%</b>`);
  if (m.ipca_12m) itens.push(`IPCA 12m <b>${num(m.ipca_12m.valor, 2)}%</b>`);
  if (ok(ipcaRef)) itens.push(`Tesouro IPCA+ ~10 anos <b>IPCA + ${num(ipcaRef, 2)}%</b>`);
  if (m.dolar) itens.push(`Dólar <b>R$ ${num(m.dolar.valor, 2)}</b>`);
  $('#contexto').innerHTML = itens.map(i => `<span>${i}</span>`).join('');
}

// ---------- Navegação ----------
const ABAS = { oportunidades: montarOportunidades, carteiras: montarCarteiras, ranking: montarRanking, comparar: montarComparar, etfs: montarEtfs, metodo: montarMetodo };
const montadas = new Set();
let abaAtual = null;

function rota() {
  const h = decodeURIComponent(location.hash.slice(1)) || 'oportunidades';
  const [nome, arg] = h.split('/');
  if (nome === 'importar') { importar(arg); return; }
  if (nome === 'empresa') {
    if (!abaAtual) mostrarAba('oportunidades');
    abrirFicha(arg);
    return;
  }
  fecharFicha();
  mostrarAba(ABAS[nome] ? nome : 'oportunidades', arg);
}
function mostrarAba(nome, arg) {
  abaAtual = nome;
  for (const a of document.querySelectorAll('#abas a')) {
    if (a.dataset.aba === nome) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const s of document.querySelectorAll('.aba')) s.classList.toggle('ativa', s.id === `aba-${nome}`);
  const el = $(`#aba-${nome}`);
  if (nome === 'comparar') ABAS.comparar(el, arg);
  else if (!montadas.has(nome)) { ABAS[nome](el); montadas.add(nome); }
}
const irPara = h => { location.hash = h; };

// ---------- Oportunidades ----------
// Foco: setores perenes e empresas grandes (confiança no aporte). Valores em config/carteiras.json.
const REGRA = D.config?.oportunidades ?? {};
const FOCO = REGRA.foco ?? {};
const grande = e => (e.vm ?? 0) >= (e.financeira ? FOCO.valor_mercado_minimo_financeiras ?? 0 : FOCO.valor_mercado_minimo ?? 0);
const perene = e => (FOCO.setores ?? []).includes(e.setor);
const MODOS_OPORT = {
  foco: ['Setores perenes', e => perene(e) && grande(e)],
  grandes: ['Empresas grandes', e => grande(e)],
  todas: ['Todas', () => true],
};
let modoOport = 'foco';

function montarOportunidades(el) {
  // Fora da carteira e sem setores voláteis (varejo), salvo nota excepcional
  const evitar = new Set(REGRA.setores_evitar ?? []), excecao = REGRA.nota_minima_excecao ?? 101;
  const todas = D.empresas.filter(e => e.oportunidade).sort((a, b) => b.nota_oportunidade - a.nota_oportunidade);
  const daCarteira = todas.filter(e => naCarteira.has(e.cnpj));
  const ocultas = todas.filter(e => !naCarteira.has(e.cnpj) && evitar.has(e.setor) && e.nota_oportunidade < excecao);
  const candidatas = todas.filter(e => !naCarteira.has(e.cnpj) && !ocultas.includes(e));
  const porModo = Object.fromEntries(Object.entries(MODOS_OPORT).map(([k, [, f]]) => [k, candidatas.filter(f)]));
  const lista = porModo[modoOport];
  const linkTk = e => `<a href="#empresa/${esc(e.ticker)}">${esc(e.ticker)}</a>`;
  const bi = v => num(v / 1e9, 0);
  const corte = `valor de mercado a partir de R$ ${bi(FOCO.valor_mercado_minimo)} bi (bancos e seguradoras: R$ ${bi(FOCO.valor_mercado_minimo_financeiras)} bi)`;
  const explicacao = {
    foco: `Bancos, seguros, energia, saneamento e telecom, com ${corte}.`,
    grandes: `Qualquer setor, com ${corte}.`,
    todas: 'Inclui empresas pequenas: mais risco e menos liquidez.',
  }[modoOport];
  const b = etf.BOVA11;
  const queda = b && b.distancia_maxima_52s < -0.1;
  el.innerHTML = `
    <h2>Oportunidades de hoje</h2>
    <p class="intro">Empresas com boa qualidade e finanças saudáveis negociando abaixo do próprio padrão histórico
      de preço sobre lucro (P/L) desde 2020. A nota combina qualidade, saúde e o tamanho do desconto.
      Clique num cartão para ver a ficha completa.</p>
    ${queda ? `<div class="aviso">${ICONE_ALERTA}<div><strong>O mercado está em queda:</strong> o BOVA11 está
      ${pct(-b.distancia_maxima_52s, 0)} abaixo do pico das últimas 52 semanas (${pctSinal(b.ret_1m)} no último mês).
      Os múltiplos usam o lucro dos últimos 12 meses, de antes da queda. Parte do “desconto” pode ser o mercado
      antecipando lucros menores, e não uma pechincha. Confira o motivo da queda antes de decidir.</div></div>` : ''}
    <div class="filtros"><span class="segmentado" role="group" aria-label="Quais empresas mostrar">
      ${Object.entries(MODOS_OPORT).map(([k, [r]]) => `<button data-modo="${k}" aria-pressed="${k === modoOport}">${r} (${porModo[k].length})</button>`).join('')}
    </span></div>
    <p class="contagem" style="margin:0 0 10px">${explicacao}
      ${daCarteira.length ? `Da carteira, ${daCarteira.map(linkTk).join(', ')} também aparece${daCarteira.length > 1 ? 'm' : ''} como oportunidade (veja a aba Carteiras).` : ''}
      ${ocultas.length ? `${ocultas.length} de varejo ficaram de fora por terem nota abaixo de ${excecao}.` : ''}</p>
    <div class="cartoes">${lista.map(cartaoOportunidade).join('') || `<p class="vazio">${modoOport === 'foco'
      ? 'Nenhuma empresa grande de setor perene está barata contra o próprio histórico hoje. Veja “Empresas grandes”.'
      : 'Nenhuma empresa atende aos critérios hoje.'}</p>`}</div>`;
  for (const btn of el.querySelectorAll('[data-modo]')) btn.addEventListener('click', () => { modoOport = btn.dataset.modo; montarOportunidades(el); });
  for (const c of el.querySelectorAll('.cartao')) c.addEventListener('click', () => irPara(`empresa/${c.dataset.ticker}`));
  for (const s of el.querySelectorAll('.spark')) desenharSpark(s, porTicker.get(s.dataset.ticker));
}
function cartaoOportunidade(e) {
  return `<button class="cartao" data-ticker="${esc(e.ticker)}" aria-label="Abrir ficha de ${esc(e.ticker)}">
    <div class="cartao-topo">
      <div><div class="ticker">${esc(e.ticker)}</div><div class="nome">${esc(e.nome)}</div><div class="setor">${esc(e.setor)}</div></div>
      <div class="nota-grande"><b>${e.nota_oportunidade}</b><span>nota de oportunidade</span></div>
    </div>
    <svg class="spark" data-ticker="${esc(e.ticker)}" viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"></svg>
    <p class="motivo">${esc(e.motivo)}</p>
    <div class="mini"><span>Qualidade <b>${e.nota_qualidade ?? '–'}</b></span>${e.financeira ? '' : `<span>Saúde <b>${e.nota_saude ?? '–'}</b></span>`}
      <span>Dividendos <b>${pct(e.dy)}</b></span><span>Liquidez <b>${dinheiro(e.liquidez)}/dia</b></span></div>
    ${selos(e)}${(D.config?.oportunidades?.setores_evitar ?? []).includes(e.setor) ? '<span class="selos"><span class="selo">Varejo · nota excepcional</span></span>' : ''}
    ${listaAlertas(e.alertas)}
  </button>`;
}
// Linha do P/L desde 2020 com a mediana como referência
function desenharSpark(svg, e) {
  const h = (D.historico[e.cnpj] ?? []).map(p => p[1]);
  const vals = h.filter(ok);
  if (vals.length < 2) return;
  const lo = Math.min(...vals, e.pl_mediana ?? Infinity), hi = tetoRobusto(vals, ok(e.pl_mediana) ? [e.pl_mediana, h.at(-1) ?? 0] : []);
  const x = i => 4 + i * 292 / (h.length - 1), y = v => 40 - (Math.min(v, hi) - lo) / (hi - lo || 1) * 36;
  let d = '', caneta = false;
  h.forEach((v, i) => { if (ok(v)) { d += `${caneta ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; caneta = true; } else caneta = false; });
  const ult = h.length - 1;
  svg.innerHTML = `
    ${ok(e.pl_mediana) ? `<line x1="0" x2="300" y1="${y(e.pl_mediana)}" y2="${y(e.pl_mediana)}" stroke="var(--texto-3)" stroke-width="1" vector-effect="non-scaling-stroke"/>` : ''}
    <path d="${d}" fill="none" stroke="var(--serie-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${ok(h[ult]) ? `<line x1="${x(ult)}" x2="${x(ult)}" y1="${y(h[ult])}" y2="${y(h[ult])}" stroke="var(--serie-1)" stroke-width="8" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : ''}`;
  svg.setAttribute('aria-label', `P/L desde 2020; linha cinza é a mediana (${num(e.pl_mediana)})`);
}

// ---------- Carteiras ----------
// A lista de ativos vem de config/carteiras.json (pública). Quantidades e CDBs ficam só no
// navegador de cada um (localStorage); o link de importação leva os dados no "#", que não vai ao servidor.
const CHAVE_LOCAL = 'comparador.carteiras.v1';
function lerLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE_LOCAL));
    if (s && typeof s === 'object') return { qtd: s.qtd ?? {}, cdbs: s.cdbs ?? [] };
  } catch { /* sem acesso ao armazenamento: segue sem quantidades */ }
  return { qtd: {}, cdbs: [] };
}
let local = lerLocal();
let localSalvo = true;
function salvarLocal() {
  try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(local)); localSalvo = true; }
  catch { localSalvo = false; }
}
const paraBase64 = obj => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deBase64 = s => JSON.parse(new TextDecoder().decode(
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
let avisoImportacao = '';
function importar(codigo) {
  try {
    const d = deBase64(codigo);
    Object.assign(local.qtd, d.qtd ?? {});
    if (Array.isArray(d.cdbs) && d.cdbs.length) local.cdbs = d.cdbs;
    salvarLocal();
    avisoImportacao = localSalvo ? 'Quantidades importadas e salvas neste aparelho.'
      : 'Quantidades importadas, mas este navegador não deixa salvar: elas somem ao fechar a página.';
  } catch { avisoImportacao = 'O link de importação está incompleto ou corrompido.'; }
  montadas.delete('carteiras');
  history.replaceState(null, '', '#carteiras');
  rota();
}

const CARTEIRAS = D.config?.carteiras ?? [];
const naCarteira = new Set(CARTEIRAS.flatMap(c => (c.acoes ?? []).map(t => porTicker.get(t)?.cnpj)).filter(Boolean));
const serie = tk => D.precos?.[tk] ?? [];
const precoAtual = tk => serie(tk).at(-1)?.[1] ?? null;
function variacao(tk, dias) {
  const s = serie(tk);
  if (s.length < 2) return null;
  if (dias === 1) return s.at(-1)[1] / s.at(-2)[1] - 1;
  const alvo = new Date(Date.parse(s.at(-1)[0]) - dias * 86400000).toISOString().slice(0, 10);
  const ant = s.findLast(p => p[0] <= alvo);
  return ant ? s.at(-1)[1] / ant[1] - 1 : null;
}
const campoQtd = (chave, passo = 1) => `<input class="campo qtd" type="number" min="0" step="${passo}" inputmode="decimal"
  data-chave="${esc(chave)}" value="${local.qtd[chave] ?? ''}" placeholder="0" aria-label="Quantidade de ${esc(chave)}">`;
const situacao = e => {
  const s = [];
  if (e?.oportunidade) s.push('<span class="selo">Oportunidade</span>');
  if (ok(e?.pl_percentil)) s.push(e.pl_percentil <= 25 ? '<span class="selo">↓ Barata vs. histórico</span>'
    : e.pl_percentil >= 75 ? '<span class="selo">↑ Cara vs. histórico</span>' : '<span class="selo">No padrão</span>');
  if (e?.alertas) {
    const n = e.alertas.split(' | ').length;
    s.push(`<span class="selo" title="${esc(e.alertas)}">⚠ ${n} alerta${n > 1 ? 's' : ''}</span>`);
  }
  return `<span class="selos">${s.join('')}</span>`;
};

function montarCarteiras(el) {
  el.innerHTML = `
    <h2>Carteiras</h2>
    <p class="intro">Acompanhamento dos ativos de vocês. As quantidades ficam salvas só neste aparelho e nunca vão para o
      site. Para levar para outro celular, use “Gerar link com minhas quantidades” no fim da página.</p>
    ${avisoImportacao ? `<div class="aviso" style="border-left-color:var(--destaque)"><div>${esc(avisoImportacao)}</div></div>` : ''}
    <div id="cart-corpo"></div>
    <div class="grafico-bloco" style="margin-top:20px">
      <h3>Levar as quantidades para outro aparelho</h3>
      <p class="tile-sub">O link carrega as quantidades e os CDBs deste aparelho. Quem abrir grava esses números no próprio
        navegador. Mande só para quem você quiser.</p>
      <div class="filtros"><button class="botao" id="cart-link">Gerar link com minhas quantidades</button>
        <input class="campo" id="cart-link-txt" readonly style="flex:1;min-width:200px" aria-label="Link gerado" hidden></div>
    </div>`;
  avisoImportacao = '';
  desenharCarteiras();
  $('#cart-link').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#importar/${paraBase64({ qtd: local.qtd, cdbs: local.cdbs })}`;
    const txt = $('#cart-link-txt');
    txt.hidden = false;
    txt.value = url;
    txt.select();
    try { await navigator.clipboard.writeText(url); $('#cart-link').textContent = 'Link copiado'; }
    catch { /* fica o campo para copiar à mão */ }
  });
}

function desenharCarteiras() {
  const corpo = $('#cart-corpo');
  corpo.innerHTML = CARTEIRAS.map(c => `<section class="carteira" data-id="${esc(c.id)}">
      <h2 style="margin:20px 0 8px">${esc(c.nome)}</h2>
      <div class="blocos" id="resumo-${esc(c.id)}"></div>
      ${blocoConcentracao(c)}
      ${c.acoes?.length ? blocoAcoes(c) : ''}
      ${c.etfs?.length ? blocoEtfs(c) : ''}
      ${c.tesouro?.length ? blocoTesouro(c) : ''}
      ${c.cdb ? blocoCdb() : ''}
    </section>`).join('');
  for (const c of CARTEIRAS) resumoCarteira(c);
  for (const i of corpo.querySelectorAll('input.qtd')) i.addEventListener('change', () => {
    const v = Number(i.value);
    if (v > 0) local.qtd[i.dataset.chave] = v; else delete local.qtd[i.dataset.chave];
    salvarLocal();
    desenharCarteiras();
  });
  for (const tr of corpo.querySelectorAll('tr[data-ticker]')) tr.addEventListener('click', ev => {
    if (!ev.target.closest('input')) irPara(`empresa/${tr.dataset.ticker}`);
  });
  // Clique no título ordena; o segundo clique inverte. Texto começa em A→Z, números do maior para o menor.
  for (const th of corpo.querySelectorAll('th[data-ordem]')) th.addEventListener('click', () => {
    const id = th.closest('.carteira').dataset.id, k = th.dataset.ordem;
    const atual = ordemCarteira[id];
    const col = COLUNAS_CARTEIRA.find(c => c.k === k);
    ordemCarteira[id] = atual?.k === k ? { k, desc: !atual.desc } : { k, desc: !col.texto && k !== 'situacao' && k !== 'pl' };
    desenharCarteiras();
  });
  ligarCdbs();
  for (const c of CARTEIRAS) for (const t of c.tesouro ?? []) graficoTesouro(t);
}

// Valor, renda estimada e peso de cada ação da carteira
function linhasAcoes(c) {
  return c.acoes.map(tk => {
    const e = porTicker.get(tk), p = precoAtual(tk) ?? e?.preco, q = local.qtd[tk] ?? 0;
    return { tk, e, p, q, saldo: q * (p ?? 0), renda: q * (p ?? 0) * (e?.dy ?? 0) };
  });
}
// Colunas da tabela de ações da carteira: rótulo, dica e o valor usado para ordenar
const COLUNAS_CARTEIRA = [
  { k: 'ticker', r: 'Ação', esq: true, v: l => l.tk, texto: true },
  { k: 'qtd', r: 'Qtd.', v: l => l.q },
  { k: 'preco', r: 'Preço', v: l => l.p },
  { k: 'dia', r: 'Dia', v: l => variacao(l.tk, 1) },
  { k: 'ano', r: '12 meses', v: l => variacao(l.tk, 365) },
  { k: 'saldo', r: 'Saldo', v: l => l.saldo },
  { k: 'peso', r: 'Peso', v: l => l.saldo },
  { k: 'dy', r: 'Div. 12m', v: l => l.e?.dy, dica: 'Dividendos e JCP pagos nos últimos 12 meses sobre o preço' },
  { k: 'renda', r: 'Renda/ano', v: l => l.renda, dica: 'Quantidade × preço × dividendos dos últimos 12 meses' },
  { k: 'pl', r: 'P/L × mediana', v: l => ok(l.e?.pl) && ok(l.e?.pl_mediana) ? l.e.pl / l.e.pl_mediana : null, dica: 'P/L de hoje × mediana desde 2020; ordena pelo desconto' },
  { k: 'nota', r: 'Nota', v: l => l.e?.nota_geral },
  { k: 'situacao', r: 'Situação', esq: true, v: l => l.e?.pl_percentil, dica: 'Ordena do mais barato ao mais caro contra o próprio histórico' },
];
const ordemCarteira = {};
function ordenarLinhas(linhas, id) {
  const o = ordemCarteira[id];
  if (!o) return linhas;
  const col = COLUNAS_CARTEIRA.find(c => c.k === o.k);
  return [...linhas].sort((a, b) => {
    const va = col.v(a), vb = col.v(b);
    if (va == null) return 1;
    if (vb == null) return -1;
    const r = col.texto ? String(va).localeCompare(String(vb), 'pt-BR') : va - vb;
    return o.desc ? -r : r;
  });
}
function blocoAcoes(c) {
  const linhas = ordenarLinhas(linhasAcoes(c), c.id);
  const total = linhas.reduce((s, l) => s + l.saldo, 0);
  const o = ordemCarteira[c.id];
  return `<div class="tabela-caixa" style="max-height:none"><table>
    <thead><tr>${COLUNAS_CARTEIRA.map(col => `<th data-ordem="${col.k}" class="${col.esq ? 'esq' : ''}"
      ${col.dica ? `title="${esc(col.dica)}"` : ''} ${o?.k === col.k ? `aria-sort="${o.desc ? 'descending' : 'ascending'}"` : ''}>${col.r}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map(({ tk, e, p, q, saldo, renda }) => `<tr data-ticker="${esc(tk)}">
      <td class="esq empresa"><b>${esc(tk)}</b><span class="nome">${esc(e?.nome ?? '')}</span></td>
      <td>${campoQtd(tk)}</td><td>R$ ${num(p, 2)}</td>
      <td class="${classeSinal(variacao(tk, 1))}">${pctSinal(variacao(tk, 1))}</td>
      <td class="${classeSinal(variacao(tk, 365))}">${pctSinal(variacao(tk, 365))}</td>
      <td>${q ? dinheiro(saldo) : '–'}</td><td>${q && total ? pct(saldo / total, 0) : '–'}</td>
      <td>${pct(e?.dy)}</td><td>${q ? dinheiro(renda) : '–'}</td>
      <td>${ok(e?.pl) && ok(e?.pl_mediana) ? `${num(e.pl)} <span class="setor">× ${num(e.pl_mediana)}</span>` : '–'}</td>
      <td>${medidor(e?.nota_geral)}</td><td class="esq">${situacao(e)}</td></tr>`).join('')}</tbody>
  </table></div>
  ${alertasCarteira(linhas)}`;
}
function alertasCarteira(linhas) {
  const com = linhas.filter(l => l.e?.alertas);
  if (!com.length) return '';
  return `<div class="aviso" style="margin-top:12px">${ICONE_ALERTA}<div><strong>Alertas da carteira</strong>
    <ul class="alertas">${com.flatMap(l => l.e.alertas.split(' | ')
      .map(a => `<li><span><b>${esc(l.tk)}:</b> ${esc(a)}</span></li>`)).join('')}</ul></div></div>`;
}
function blocoEtfs(c) {
  return `<div class="tabela-caixa" style="max-height:none;margin-top:12px"><table>
    <thead><tr><th class="esq">ETF</th><th>Qtd.</th><th>Preço</th><th>Dia</th><th>1 mês</th><th>12 meses</th>
      <th>CDI 12m</th><th>Do pico 52s</th><th>Saldo</th></tr></thead>
    <tbody>${c.etfs.map(tk => {
      const e = etf[tk], q = local.qtd[tk] ?? 0, p = precoAtual(tk) ?? e?.preco;
      return `<tr style="cursor:default"><td class="esq"><b>${esc(tk)}</b></td><td>${campoQtd(tk)}</td><td>R$ ${num(p, 2)}</td>
        <td class="${classeSinal(variacao(tk, 1))}">${pctSinal(variacao(tk, 1))}</td>
        <td class="${classeSinal(variacao(tk, 30))}">${pctSinal(variacao(tk, 30))}</td>
        <td class="${classeSinal(variacao(tk, 365))}">${pctSinal(variacao(tk, 365))}</td>
        <td>${pct(e?.cdi_12m)}</td><td>${pct(e?.distancia_maxima_52s)}</td><td>${q ? dinheiro(q * p) : '–'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

const chaveTesouro = t => `${t.titulo}|${t.vencimento}`;
function infoTesouro(t) {
  const s = D.tesouro_series?.[chaveTesouro(t)] ?? [];
  const ult = s.at(-1);
  const em = dias => {
    const alvo = new Date(Date.parse(ult[0]) - dias * 86400000).toISOString().slice(0, 10);
    return s.findLast(p => p[0] <= alvo);
  };
  const taxas = s.map(p => p[1]).filter(ok);
  return {
    s, ult, taxa: ult?.[1], pu: ult?.[2],
    pu1m: ult && em(30) ? ult[2] / em(30)[2] - 1 : null,
    pu12m: ult && em(365) ? ult[2] / em(365)[2] - 1 : null,
    pctTaxa: taxas.length > 20 ? 100 * taxas.filter(x => x < ult[1]).length / taxas.length : null,
  };
}
function blocoTesouro(c) {
  return c.tesouro.map(t => {
    const i = infoTesouro(t), ch = `TD:${chaveTesouro(t)}`, q = local.qtd[ch] ?? 0;
    if (!i.ult) return `<p class="vazio">Sem dados para ${esc(t.titulo)} ${esc(t.vencimento)}.</p>`;
    return `<div class="tabela-caixa" style="max-height:none;margin-top:12px"><table>
      <thead><tr><th class="esq">Título</th><th>Qtd. (títulos)</th><th>Taxa hoje</th><th>Preço do título</th>
        <th>1 mês</th><th>12 meses</th><th>Saldo</th></tr></thead>
      <tbody><tr style="cursor:default">
        <td class="esq"><b>${esc(t.titulo)} ${t.vencimento.slice(0, 4)}</b><span class="nome" style="display:block">vence em ${data(t.vencimento)}</span></td>
        <td>${campoQtd(ch, 0.01)}</td><td>IPCA + ${num(i.taxa, 2)}%</td><td>R$ ${num(i.pu, 2)}</td>
        <td class="${classeSinal(i.pu1m)}">${pctSinal(i.pu1m)}</td><td class="${classeSinal(i.pu12m)}">${pctSinal(i.pu12m)}</td>
        <td>${q ? dinheiro(q * i.pu) : '–'}</td></tr></tbody></table></div>
      <div class="grafico-bloco" style="margin-top:12px"><h3>Taxa do ${esc(t.titulo)} ${t.vencimento.slice(0, 4)}</h3>
        <div class="tile-sub">${ok(i.pctTaxa) ? `Hoje a taxa está acima de ${num(i.pctTaxa, 0)}% dos dias desde ${data(i.s[0][0])}. ` : ''}
          Taxa alta = título barato: bom momento para comprar mais. Para quem já tem, o saldo cai quando a taxa sobe
          e sobe quando ela cai; levando até o vencimento, recebe a taxa contratada.</div>
        <div class="grafico" id="g-td-${esc(t.vencimento)}"></div></div>`;
  }).join('');
}
function graficoTesouro(t) {
  const el = document.getElementById(`g-td-${t.vencimento}`);
  if (!el) return;
  const porMes = new Map();
  for (const [d, taxa] of infoTesouro(t).s) if (ok(taxa)) porMes.set(d.slice(0, 7), taxa);
  const pontos = [...porMes];
  const mediaTaxa = pontos.reduce((s, p) => s + p[1], 0) / pontos.length;
  graficoLinhas(el, {
    series: [{ nome: 'Taxa (IPCA +)', cor: 'var(--serie-1)', pontos }], fmt: v => `${num(v, 2)}%`,
    fmtEixo: v => `${num(v, 1)}%`, ref: { y: mediaTaxa, rotulo: `média ${num(mediaTaxa, 2)}%` },
  });
}

// CDB: rende um percentual do CDI a partir da data de aplicação; IR pela tabela regressiva
function calcularCdb(cdb) {
  const pctCdi = (Number(cdb.pct) || 100) / 100;
  let fator = 1;
  for (const [d, taxa] of D.cdi_diario ?? []) if (d > cdb.data) fator *= 1 + taxa / 100 * pctCdi;
  const aplicado = Number(cdb.valor) || 0;
  const bruto = aplicado * fator;
  const dias = (Date.parse(D.data_precos) - Date.parse(cdb.data)) / 86400000;
  const aliquota = dias <= 180 ? 0.225 : dias <= 360 ? 0.2 : dias <= 720 ? 0.175 : 0.15;
  return { bruto, rend: fator - 1, aliquota, liquido: bruto - Math.max(0, bruto - aplicado) * aliquota };
}
function blocoCdb() {
  const linhas = local.cdbs.map((c, i) => {
    const r = c.valor && c.data ? calcularCdb(c) : null;
    return `<tr style="cursor:default" data-cdb="${i}">
      <td class="esq"><input class="campo" data-campo="nome" value="${esc(c.nome ?? '')}" placeholder="Banco" style="width:120px" aria-label="Banco"></td>
      <td><input class="campo" data-campo="valor" type="number" min="0" step="0.01" value="${c.valor ?? ''}" placeholder="R$" style="width:110px" aria-label="Valor aplicado"></td>
      <td><input class="campo" data-campo="data" type="date" value="${esc(c.data ?? '')}" aria-label="Data da aplicação"></td>
      <td><input class="campo" data-campo="pct" type="number" min="0" step="1" value="${c.pct ?? 100}" style="width:80px" aria-label="Percentual do CDI"></td>
      <td>${r ? dinheiro(r.bruto) : '–'}</td><td>${r ? pctSinal(r.rend) : '–'}</td>
      <td>${r ? pct(r.aliquota, 1) : '–'}</td><td>${r ? dinheiro(r.liquido) : '–'}</td>
      <td><button class="botao" data-remover="${i}" aria-label="Remover CDB">×</button></td></tr>`;
  }).join('');
  return `<div class="grafico-bloco" style="margin-top:12px"><h3>CDB</h3>
    <div class="tile-sub">Valor estimado pelo CDI diário do Banco Central (até ${data(D.cdi_diario?.at(-1)?.[0])}),
      para CDB pós-fixado. IR pela tabela regressiva.</div>
    <div style="overflow-x:auto"><table>
      <thead><tr><th class="esq">Banco</th><th>Aplicado</th><th>Data</th><th>% do CDI</th><th>Valor bruto</th>
        <th>Rendeu</th><th>IR</th><th>Líquido</th><th></th></tr></thead>
      <tbody>${linhas || '<tr style="cursor:default"><td colspan="9" class="vazio esq">Nenhum CDB cadastrado neste aparelho.</td></tr>'}</tbody>
    </table></div>
    <button class="botao" id="cdb-novo" style="margin-top:8px">Adicionar CDB</button></div>`;
}
function ligarCdbs() {
  $('#cdb-novo')?.addEventListener('click', () => { local.cdbs.push({ pct: 100 }); salvarLocal(); desenharCarteiras(); });
  for (const b of document.querySelectorAll('[data-remover]')) b.addEventListener('click', () => {
    local.cdbs.splice(Number(b.dataset.remover), 1);
    salvarLocal();
    desenharCarteiras();
  });
  for (const i of document.querySelectorAll('tr[data-cdb] input')) i.addEventListener('change', () => {
    local.cdbs[Number(i.closest('tr').dataset.cdb)][i.dataset.campo] = i.type === 'number' ? Number(i.value) : i.value;
    salvarLocal();
    desenharCarteiras();
  });
}

function resumoCarteira(c) {
  const el = document.getElementById(`resumo-${c.id}`);
  let saldo = 0, renda = 0;
  if (c.acoes) for (const l of linhasAcoes(c)) { saldo += l.saldo; renda += l.renda; }
  for (const tk of c.etfs ?? []) saldo += (local.qtd[tk] ?? 0) * (precoAtual(tk) ?? 0);
  for (const t of c.tesouro ?? []) saldo += (local.qtd[`TD:${chaveTesouro(t)}`] ?? 0) * (infoTesouro(t).pu ?? 0);
  if (c.cdb) for (const cdb of local.cdbs) if (cdb.valor && cdb.data) saldo += calcularCdb(cdb).bruto;
  if (!saldo) { el.innerHTML = '<p class="tile-sub" style="margin:0">Preencha as quantidades para ver o saldo e a renda estimada.</p>'; return; }
  el.innerHTML = `<div class="bloco"><h3>Saldo estimado</h3><div class="tile-valor">${dinheiro(saldo)}</div>
      <div class="tile-sub">Pelos preços de ${rotuloPrecos()}</div></div>
    ${c.acoes ? `<div class="bloco"><h3>Renda anual estimada</h3><div class="tile-valor">${dinheiro(renda)}</div>
      <div class="tile-sub">${pct(renda / saldo)} sobre o saldo, pelos dividendos dos últimos 12 meses</div></div>` : ''}`;
}

// Fatia de cada setor no saldo. Bancos, seguradoras e holdings financeiras contam juntos,
// porque o risco é o mesmo (juros, crédito, política). ETF, Tesouro e CDB aparecem como classes.
function itensConcentracao(c) {
  const grupos = new Map();
  const somar = (nome, valor, ativo, acao) => {
    if (!(valor > 0)) return;
    const g = grupos.get(nome) ?? { nome, valor: 0, ativos: [], acao };
    g.valor += valor;
    g.ativos.push(ativo);
    grupos.set(nome, g);
  };
  if (c.acoes) for (const l of linhasAcoes(c)) {
    somar(l.e?.financeira ? 'Financeiro (bancos e seguros)' : l.e?.setor ?? 'Outros', l.saldo, l.tk, true);
  }
  for (const tk of c.etfs ?? []) somar(`ETF (${tk})`, (local.qtd[tk] ?? 0) * (precoAtual(tk) ?? 0), tk, false);
  for (const t of c.tesouro ?? []) {
    somar('Tesouro Direto', (local.qtd[`TD:${chaveTesouro(t)}`] ?? 0) * (infoTesouro(t).pu ?? 0), `${t.titulo} ${t.vencimento.slice(0, 4)}`, false);
  }
  if (c.cdb) for (const cdb of local.cdbs) if (cdb.valor && cdb.data) somar('CDB', calcularCdb(cdb).bruto, cdb.nome || 'CDB', false);
  const total = [...grupos.values()].reduce((s, g) => s + g.valor, 0);
  return { total, itens: [...grupos.values()].map(g => ({ ...g, fatia: g.valor / total })).sort((a, b) => b.valor - a.valor) };
}
function blocoConcentracao(c) {
  const { total, itens } = itensConcentracao(c);
  if (!total || itens.length < 2 && !itens[0]?.acao) return '';
  const limite = D.config?.concentracao?.limite_setor;
  const acima = itens.filter(i => i.acao && ok(limite) && i.fatia > limite);
  return `<div class="grafico-bloco" style="margin-bottom:12px">
    <h3>Concentração por setor</h3>
    <div class="tile-sub">${ok(limite) && c.acoes ? `A linha vertical marca o limite de referência de ${pct(limite, 0)} por setor de ações.` : 'Fatia de cada classe no saldo.'}</div>
    <div class="barras" role="list">${itens.map(i => `<div class="barra-linha" role="listitem">
      <div class="barra-rotulo">${esc(i.nome)}<span class="setor">${i.ativos.map(esc).join(', ')}</span></div>
      <div class="barra-trilho"><i style="width:${(100 * i.fatia).toFixed(1)}%"></i>
        ${ok(limite) && c.acoes ? `<b class="barra-limite" style="left:${100 * limite}%" aria-hidden="true"></b>` : ''}</div>
      <div class="barra-valor">${acima.includes(i) ? `${ICONE_ALERTA.replace('icone-alerta', 'icone-alerta icone-mini')} ` : ''}<b>${pct(i.fatia, 0)}</b>
        <span class="setor">${dinheiro(i.valor)}</span></div></div>`).join('')}</div>
    ${acima.length ? `<p class="tile-sub" style="margin:8px 0 0">${acima.map(i => `<b>${esc(i.nome)}</b> está com ${pct(i.fatia, 0)} do saldo, acima do limite de ${pct(limite, 0)}`).join('; ')}.
      Uma notícia ruim para o setor afeta quase toda a carteira de uma vez. Novos aportes em outros setores diminuem esse risco.</p>` : ''}
  </div>`;
}

// ---------- Ranking ----------
const COLUNAS = [
  { k: 'ticker', r: 'Empresa', esq: true, f: (v, e) => `<b>${esc(e.ticker)}</b><span class="nome">${esc(e.nome)}</span>`, cls: 'empresa', texto: true },
  { k: 'setor', r: 'Setor', esq: true, f: v => esc(v), texto: true },
  { k: 'nota_geral', r: 'Nota', f: medidor, maior: 1, dica: 'Média das quatro notas' },
  { k: 'nota_qualidade', r: 'Qualid.', f: medidor, maior: 1, dica: 'ROE, ROIC, margem contra o setor, anos com lucro' },
  { k: 'nota_preco', r: 'Preço', f: medidor, maior: 1, dica: 'Lucro/preço, EBIT/EV, P/VP e desconto contra o próprio histórico' },
  { k: 'nota_saude', r: 'Saúde', f: medidor, maior: 1, nf: true, dica: 'Dívida líquida/EBITDA, liquidez corrente, dívida/PL' },
  { k: 'nota_crescimento', r: 'Cresc.', f: medidor, maior: 1, dica: 'Crescimento anual de receita e lucro em 5 anos' },
  { k: 'pl', r: 'P/L', f: v => num(v), maior: 0 },
  { k: 'pvp', r: 'P/VP', f: v => num(v, 2), maior: 0 },
  { k: 'ev_ebitda', r: 'EV/EBITDA', f: v => num(v), maior: 0, nf: true },
  { k: 'dy', r: 'Div. 12m', f: v => pct(v), maior: 1, dica: 'Dividendos e JCP pagos nos últimos 12 meses sobre o valor de mercado' },
  { k: 'roe', r: 'ROE', f: v => pct(v), maior: 1 },
  { k: 'roic', r: 'ROIC', f: v => pct(v), maior: 1, nf: true },
  { k: 'margem_liq', r: 'Marg. líq.', f: v => pct(v), maior: 1, nf: true },
  { k: 'div_liq_ebitda', r: 'Dív./EBITDA', f: v => v >= 99 ? '<span title="EBITDA negativo">n/a</span>' : num(v), maior: 0, nf: true },
  { k: 'cagr_lucro_5a', r: 'Lucro 5a', f: v => pct(v), maior: 1, dica: 'Crescimento anual do lucro em 5 anos' },
  { k: 'pl_percentil', r: 'P/L × hist.', f: v => ok(v) ? `${num(v, 0)}%` : '–', maior: 0, dica: 'Em quantos % dos meses desde 2020 o P/L foi MENOR que hoje (baixo = barato contra o próprio histórico)' },
  { k: 'liquidez', r: 'Liquidez/dia', f: v => dinheiro(v), maior: 1 },
  { k: 'selos', r: 'Selos', esq: true, f: (v, e) => selos(e), semOrdem: true },
];
const estadoRanking = { grupo: 'empresas', busca: '', setor: '', liquidez: 1e6, grandes: true, perenes: false, oport: false, graham: false, bazin: false, magica: false, foraRanking: false, ordem: 'nota_geral', desc: true };

function montarRanking(el) {
  const setores = [...new Set(D.empresas.map(e => e.setor))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  el.innerHTML = `
    <h2>Ranking</h2>
    <p class="intro">Notas de 0 a 100 comparam cada empresa com as demais do mesmo grupo. Bancos e seguradoras têm
      régua própria (sem EBITDA nem dívida líquida). Clique nos títulos para ordenar e numa linha para abrir a ficha.</p>
    <div class="filtros">
      <span class="segmentado" role="group" aria-label="Grupo">
        <button data-grupo="empresas">Empresas</button><button data-grupo="financeiras">Bancos e seguradoras</button>
      </span>
      <input type="search" id="r-busca" placeholder="Buscar ticker ou nome" aria-label="Buscar">
      <select id="r-setor" aria-label="Setor"><option value="">Todos os setores</option>${setores.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="r-liq" aria-label="Liquidez mínima">
        <option value="0">Qualquer liquidez</option><option value="1000000" selected>Liquidez ≥ R$ 1 mi/dia</option>
        <option value="10000000">≥ R$ 10 mi/dia</option><option value="50000000">≥ R$ 50 mi/dia</option>
      </select>
      <label title="Valor de mercado mínimo da visão de foco (bancos e seguradoras têm corte maior)"><input type="checkbox" id="r-grandes" checked> Só empresas grandes</label>
      <label title="Bancos, seguros, energia, saneamento e telecom"><input type="checkbox" id="r-perenes"> Só setores perenes</label>
      <label><input type="checkbox" id="r-oport"> Só oportunidades</label>
      <label><input type="checkbox" id="r-graham"> Graham</label>
      <label><input type="checkbox" id="r-bazin"> Bazin</label>
      <label><input type="checkbox" id="r-magica"> Fórmula Mágica</label>
      <label title="Empresas com pouca liquidez ou balanço atrasado não recebem nota"><input type="checkbox" id="r-fora"> Incluir sem nota</label>
      <span class="contagem" id="r-contagem"></span>
    </div>
    <div class="tabela-caixa"><table id="r-tabela"><thead></thead><tbody></tbody></table></div>`;
  const s = estadoRanking;
  for (const btn of el.querySelectorAll('[data-grupo]')) btn.addEventListener('click', () => { s.grupo = btn.dataset.grupo; desenharRanking(); });
  $('#r-busca').addEventListener('input', ev => { s.busca = ev.target.value.trim().toUpperCase(); desenharRanking(); });
  $('#r-setor').addEventListener('change', ev => { s.setor = ev.target.value; desenharRanking(); });
  $('#r-liq').addEventListener('change', ev => { s.liquidez = Number(ev.target.value); desenharRanking(); });
  for (const [id, k] of [['r-grandes', 'grandes'], ['r-perenes', 'perenes'], ['r-oport', 'oport'], ['r-graham', 'graham'], ['r-bazin', 'bazin'], ['r-magica', 'magica'], ['r-fora', 'foraRanking']])
    $(`#${id}`).addEventListener('change', ev => { s[k] = ev.target.checked; desenharRanking(); });
  $('#r-tabela tbody').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-ticker]'); if (tr) irPara(`empresa/${tr.dataset.ticker}`); });
  $('#r-tabela tbody').addEventListener('keydown', ev => { const tr = ev.target.closest('tr[data-ticker]'); if (tr && ev.key === 'Enter') irPara(`empresa/${tr.dataset.ticker}`); });
  $('#r-tabela thead').addEventListener('click', ev => {
    const th = ev.target.closest('th[data-k]');
    if (!th) return;
    const col = COLUNAS.find(c => c.k === th.dataset.k);
    if (s.ordem === col.k) s.desc = !s.desc; else { s.ordem = col.k; s.desc = col.texto ? false : col.maior !== 0; }
    desenharRanking();
  });
  desenharRanking();
}
function desenharRanking() {
  const s = estadoRanking, fin = s.grupo === 'financeiras';
  for (const b of document.querySelectorAll('[data-grupo]')) b.setAttribute('aria-pressed', b.dataset.grupo === s.grupo);
  const cols = COLUNAS.filter(c => !(fin && c.nf));
  const linhas = D.empresas.filter(e => !!e.financeira === fin
    && (s.foraRanking || e.elegivel)
    && (e.liquidez ?? 0) >= s.liquidez
    && (!s.grandes || grande(e)) && (!s.perenes || perene(e))
    && (!s.setor || e.setor === s.setor)
    && (!s.busca || e.tickers.includes(s.busca) || e.nome.toUpperCase().includes(s.busca))
    && (!s.oport || e.oportunidade) && (!s.graham || e.selo_graham) && (!s.bazin || e.selo_bazin) && (!s.magica || e.selo_magica));
  const col = COLUNAS.find(c => c.k === s.ordem) ?? COLUNAS[2];
  linhas.sort((a, b) => {
    const va = a[col.k], vb = b[col.k];
    if (va == null || va === '') return 1;
    if (vb == null || vb === '') return -1;
    const r = col.texto ? String(va).localeCompare(String(vb), 'pt-BR') : va - vb;
    return s.desc ? -r : r;
  });
  $('#r-tabela thead').innerHTML = `<tr>${cols.map(c => `<th data-k="${c.k}" class="${c.esq ? 'esq' : ''}" ${c.dica ? `title="${esc(c.dica)}"` : ''}
    ${c.k === s.ordem ? `aria-sort="${s.desc ? 'descending' : 'ascending'}"` : ''}>${c.r}</th>`).join('')}</tr>`;
  $('#r-tabela tbody').innerHTML = linhas.map(e => `<tr data-ticker="${esc(e.ticker)}" tabindex="0">${cols.map(c =>
    `<td class="${c.cls ?? ''} ${c.esq ? 'esq' : ''}">${c.f(e[c.k], e)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${cols.length}" class="vazio">Nenhuma empresa com esses filtros.</td></tr>`;
  $('#r-contagem').textContent = `${linhas.length} empresas`;
}

// ---------- Ficha da empresa ----------
let focoAntesDaFicha = null;
function abrirFicha(ticker) {
  const e = porTicker.get(ticker);
  if (!e) { irPara(abaAtual ?? 'oportunidades'); return; }
  const fundo = $('#ficha-fundo'), ficha = $('#ficha');
  if (fundo.hidden) focoAntesDaFicha = document.activeElement;
  const fin = !!e.financeira;
  const outros = e.tickers.split(' ').filter(t => t !== e.ticker);
  const linha = (rotulo, valor, dica) => `<dt${dica ? ` title="${esc(dica)}"` : ''}>${rotulo}</dt><dd>${valor}</dd>`;
  ficha.innerHTML = `
    <button class="fechar" aria-label="Fechar">×</button>
    <div class="ficha-cabecalho">
      <h2 id="ficha-titulo">${esc(e.ticker)}</h2>
      <span class="nome">${esc(e.nome)}</span>
      <span class="setor">${esc(e.setor)}${e.segmento ? ' · ' + esc(e.segmento) : ''}${e.controle ? ' · controle ' + esc(e.controle.toLowerCase()) : ''}</span>
    </div>
    ${outros.length ? `<div class="setor">Outros códigos: ${outros.map(esc).join(', ')}</div>` : ''}
    <div class="acoes-ficha">
      <a class="botao botao-principal" href="#comparar/${encodeURIComponent(e.ticker)}">Comparar com outras</a>
      ${selos(e)}
    </div>
    ${e.oportunidade ? `<div class="aviso" style="border-left-color:var(--destaque)"><div><strong>Por que é oportunidade:</strong> ${esc(e.motivo)}.</div></div>` : ''}
    ${!e.elegivel ? `<div class="aviso">${ICONE_ALERTA}<div><strong>Fora do ranking:</strong> ${(e.liquidez ?? 0) < 1e6 ? 'negocia menos de R$ 1 mi por dia' : 'balanço atrasado ou sem lucro informado'}, por isso não recebe nota.</div></div>` : ''}
    ${e.alertas ? `<div class="aviso">${ICONE_ALERTA}<div><strong>Atenção</strong>${listaAlertas(e.alertas)}</div></div>` : ''}
    <div class="blocos">
      <div class="bloco"><h3>Preço</h3><div class="tile-valor">R$ ${num(e.preco, 2)}</div>
        <div class="tile-sub"><span class="${classeSinal(e.variacao_12m)}">${pctSinal(e.variacao_12m)}</span> em 12 meses</div></div>
      <div class="bloco"><h3>Valor de mercado</h3><div class="tile-valor">${dinheiro(e.vm)}</div>
        <div class="tile-sub">Liquidez ${dinheiro(e.liquidez)}/dia</div></div>
      <div class="bloco"><h3>P/L</h3><div class="tile-valor">${num(e.pl)}</div>
        <div class="tile-sub">Mediana desde 2020: ${num(e.pl_mediana)}${ok(e.pl_percentil) ? ` · mais barato que em ${num(100 - e.pl_percentil, 0)}% dos meses` : ''}</div></div>
      <div class="bloco"><h3>Dividendos</h3><div class="tile-valor">${pct(e.dy)}</div>
        <div class="tile-sub">Últimos 12 meses · média de 3 anos ${pct(e.dy_3a)}</div></div>
    </div>
    <div class="blocos">
      <div class="bloco"><h3>Notas (0 a 100)</h3><div class="notas-ficha">
        ${[['Geral', e.nota_geral], ['Qualidade', e.nota_qualidade], ['Preço', e.nota_preco], ...(fin ? [] : [['Saúde', e.nota_saude]]), ['Crescimento', e.nota_crescimento]]
          .map(([r, v]) => `<div class="medidor"><span>${r}</span>${ok(v) ? `<i style="--v:${v}%"></i><span>${v}</span>` : '<span class="vazio">–</span>'}</div>`).join('')}
        ${e.magica_posicao ? `<div class="tile-sub">Fórmula Mágica: ${e.magica_posicao}ª posição</div>` : ''}
      </div></div>
      <div class="bloco"><h3>Valuation</h3><dl class="lista">
        ${linha('P/L', num(e.pl))}${linha('P/VP', num(e.pvp, 2))}
        ${fin ? '' : linha('EV/EBIT', num(e.ev_ebit)) + linha('EV/EBITDA', num(e.ev_ebitda))}
        ${linha('Lucro / preço', pct(e.earnings_yield), 'Inverso do P/L: quanto a empresa lucra por real investido')}
        ${linha('Contra Tesouro IPCA+', `<span class="${classeSinal(e.premio_vs_tesouro)}">${ok(e.premio_vs_tesouro) ? (e.premio_vs_tesouro > 0 ? '+' : '') + num(e.premio_vs_tesouro * 100, 1) + ' p.p.' : '–'}</span>`, `Lucro/preço menos a taxa real do Tesouro IPCA+ (${num(e.tesouro_ipca_ref, 2)}%)`)}
        ${linha('Graham', ok(e.graham_margem) ? `<span class="${classeSinal(e.graham_margem)}">${pctSinal(e.graham_margem, 0)}</span>` : '–', 'Preço justo de Graham comparado ao preço atual')}
        ${linha('Bazin', ok(e.bazin_margem) ? `<span class="${classeSinal(e.bazin_margem)}">${pctSinal(e.bazin_margem, 0)}</span>` : '–', 'Preço-teto de Bazin (dividendo médio 3 anos ÷ 6%) comparado ao preço atual')}
      </dl></div>
      <div class="bloco"><h3>Rentabilidade</h3><dl class="lista">
        ${linha('ROE', pct(e.roe))}${fin ? '' : linha('ROIC', pct(e.roic))}
        ${fin ? '' : linha('Margem bruta', pct(e.margem_bruta)) + linha('Margem EBIT', pct(e.margem_ebit)) + linha('Margem líquida', pct(e.margem_liq))}
        ${linha('Lucro 12m', dinheiro(e.lucro_12m))}${linha('Receita 12m', dinheiro(e.receita_12m))}
      </dl></div>
      ${fin ? '' : `<div class="bloco"><h3>Endividamento</h3><dl class="lista">
        ${linha('Dívida líquida', dinheiro(e.divida_liq))}
        ${linha('Dív. líq. / EBITDA', e.div_liq_ebitda >= 99 ? 'EBITDA negativo' : num(e.div_liq_ebitda))}
        ${linha('Dív. líq. / PL', num(e.div_liq_pl, 2))}${linha('Liquidez corrente', num(e.liq_corrente, 2))}
        ${linha('EBITDA 12m', dinheiro(e.ebitda_12m))}
      </dl></div>`}
      <div class="bloco"><h3>Crescimento e constância</h3><dl class="lista">
        ${fin ? '' : linha('Receita, 5 anos', pctSinal(e.cagr_receita_5a) + ' a.a.')}
        ${linha('Lucro, 5 anos', pctSinal(e.cagr_lucro_5a) + ' a.a.')}
        ${linha('Anos com lucro', `${e.anos_lucro} de ${e.anos_lucro_base}`)}
        ${linha('Anos com dividendo', `${e.anos_dividendo} dos últimos ${Math.min(5, e.anos_lucro_base)}`)}
        ${linha('Payout 12m', pct(e.payout))}
      </dl></div>
    </div>
    <div class="graficos">
      <div class="grafico-bloco"><h3>P/L mês a mês</h3><div class="tile-sub">Linha cinza: mediana desde 2020. Meses sem lucro ficam em branco.</div><div class="grafico" id="g-pl"></div></div>
      <div class="grafico-bloco"><h3>P/VP mês a mês</h3><div class="tile-sub">Preço sobre patrimônio líquido</div><div class="grafico" id="g-pvp"></div></div>
      <div class="grafico-bloco"><h3>Lucro líquido por ano</h3><div class="tile-sub">Atribuído aos controladores</div><div class="grafico" id="g-lucro"></div></div>
      <div class="grafico-bloco"><h3>${fin ? 'Receitas de intermediação' : 'Receita líquida'} por ano</h3><div class="tile-sub">&nbsp;</div><div class="grafico" id="g-receita"></div></div>
      <div class="grafico-bloco"><h3>Dividendos e JCP pagos por ano</h3><div class="tile-sub">Pela demonstração de fluxo de caixa</div><div class="grafico" id="g-div"></div></div>
      ${fin ? '' : `<div class="grafico-bloco"><h3>Dívida líquida por ano</h3><div class="tile-sub">Negativa = mais caixa que dívida</div><div class="grafico" id="g-divida"></div></div>`}
    </div>
    <p class="tile-sub">Balanço mais recente: ${data(e.dt_balanco)} · preços de ${data(e.data)} · CNPJ ${esc(e.cnpj)}</p>
    ${e.acoes_fre ? `<p class="tile-sub">${esc(e.acoes_fre)}. O valor de mercado e os múltiplos já usam a quantidade nova.</p>` : ''}`;
  fundo.hidden = false;
  document.body.style.overflow = 'hidden';
  $('.fechar', ficha).addEventListener('click', () => irPara(abaAtual));
  $('.fechar', ficha).focus();
  fundo.scrollTop = 0;

  const hist = D.historico[e.cnpj] ?? [];
  graficoLinhas($('#g-pl'), { series: [{ nome: 'P/L', cor: 'var(--serie-1)', pontos: hist.map(p => [p[0], p[1]]) }], fmt: v => num(v), ref: ok(e.pl_mediana) ? { y: e.pl_mediana, rotulo: `mediana ${num(e.pl_mediana)}` } : null });
  graficoLinhas($('#g-pvp'), { series: [{ nome: 'P/VP', cor: 'var(--serie-1)', pontos: hist.map(p => [p[0], p[2]]) }], fmt: v => num(v, 2), ref: ok(e.pvp_mediana) ? { y: e.pvp_mediana, rotulo: `mediana ${num(e.pvp_mediana, 2)}` } : null });
  const anos = (D.anuais[e.cnpj] ?? []).filter(a => a[0] >= 2015);
  graficoColunas($('#g-lucro'), { pontos: anos.map(a => [String(a[0]), a[2]]), fmt: dinheiro });
  graficoColunas($('#g-receita'), { pontos: anos.map(a => [String(a[0]), a[1]]), fmt: dinheiro });
  graficoColunas($('#g-div'), { pontos: anos.map(a => [String(a[0]), a[3]]), fmt: dinheiro });
  if (!fin) graficoColunas($('#g-divida'), { pontos: anos.map(a => [String(a[0]), a[4]]), fmt: dinheiro });
}
function fecharFicha() {
  const fundo = $('#ficha-fundo');
  if (fundo.hidden) return;
  fundo.hidden = true;
  document.body.style.overflow = '';
  esconderDica();
  focoAntesDaFicha?.focus?.();
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('#ficha-fundo').hidden) irPara(abaAtual); });
$('#ficha-fundo').addEventListener('click', ev => { if (ev.target.id === 'ficha-fundo') irPara(abaAtual); });

// ---------- Comparar ----------
const LINHAS_COMPARAR = [
  ['Setor', e => esc(e.setor)],
  ['Preço', e => `R$ ${num(e.preco, 2)}`],
  ['Valor de mercado', e => dinheiro(e.vm)],
  ['Nota geral', e => e.nota_geral ?? '–', 'nota_geral', 1],
  ['Qualidade', e => e.nota_qualidade ?? '–', 'nota_qualidade', 1],
  ['Preço (nota)', e => e.nota_preco ?? '–', 'nota_preco', 1],
  ['Saúde', e => e.nota_saude ?? '–', 'nota_saude', 1],
  ['Crescimento', e => e.nota_crescimento ?? '–', 'nota_crescimento', 1],
  ['P/L', e => num(e.pl), 'pl', 0],
  ['P/L × mediana desde 2020', e => ok(e.pl) && ok(e.pl_mediana) ? pctSinal(e.pl / e.pl_mediana - 1, 0) : '–'],
  ['P/VP', e => num(e.pvp, 2), 'pvp', 0],
  ['EV/EBITDA', e => num(e.ev_ebitda), 'ev_ebitda', 0],
  ['Dividend yield (12 meses)', e => pct(e.dy), 'dy', 1],
  ['Dividend yield (média 3 anos)', e => pct(e.dy_3a), 'dy_3a', 1],
  ['Dividend yield mediano desde 2020', e => pct(e.dy_mediana), 'dy_mediana', 1],
  ['Earnings yield (lucro/preço)', e => pct(e.earnings_yield), 'earnings_yield', 1],
  ['ROE', e => pct(e.roe), 'roe', 1],
  ['ROIC', e => pct(e.roic), 'roic', 1],
  ['Margem líquida', e => pct(e.margem_liq), 'margem_liq', 1],
  ['Dív. líq. / EBITDA', e => e.div_liq_ebitda >= 99 ? 'n/a' : num(e.div_liq_ebitda), 'div_liq_ebitda', 0],
  ['Receita, 5 anos (a.a.)', e => pctSinal(e.cagr_receita_5a), 'cagr_receita_5a', 1],
  ['Lucro, 5 anos (a.a.)', e => pctSinal(e.cagr_lucro_5a), 'cagr_lucro_5a', 1],
  ['Anos com lucro', e => `${e.anos_lucro}/${e.anos_lucro_base}`],
  ['Lucro/preço contra Tesouro IPCA+', e => ok(e.premio_vs_tesouro) ? (e.premio_vs_tesouro > 0 ? '+' : '') + num(e.premio_vs_tesouro * 100, 1) + ' p.p.' : '–', 'premio_vs_tesouro', 1],
  ['Variação 12 meses', e => pctSinal(e.variacao_12m)],
  ['Liquidez diária', e => dinheiro(e.liquidez), 'liquidez', 1],
  ['Selos', e => selos(e) || '–'],
  ['Alertas', e => e.alertas ? `<span title="${esc(e.alertas)}">${e.alertas.split(' | ').length}</span>` : '–'],
];
const INDICADORES_GRAFICO = { pl: ['P/L', 1, v => num(v)], pvp: ['P/VP', 2, v => num(v, 2)], ev_ebitda: ['EV/EBITDA', 3, v => num(v)], dy: ['Dividend yield', 4, v => pct(v)] };
let indicadorComparar = 'pl';

function montarComparar(el, arg) {
  const sel = (arg ?? '').split(',').map(t => t.trim().toUpperCase()).filter(t => porTicker.has(t)).slice(0, 4);
  el.innerHTML = `
    <h2>Comparar</h2>
    <p class="intro">Escolha até quatro ações. O ponto azul marca a melhor de cada linha. Copie o endereço da página para mandar a comparação.</p>
    <datalist id="lista-tickers">${listaTickers.map(t => `<option value="${t}">${esc(porTicker.get(t).nome)}</option>`).join('')}</datalist>
    <div class="seletores">${[0, 1, 2, 3].map(i => `<input class="campo" list="lista-tickers" placeholder="Ticker ${i + 1}" aria-label="Ticker ${i + 1}" value="${esc(sel[i] ?? '')}">`).join('')}
      <button class="botao" id="c-limpar">Limpar</button>
      <button class="botao botao-principal" id="c-imagem">${toque ? 'Compartilhar como imagem' : 'Salvar como imagem'}</button>
      <span class="contagem" id="c-imagem-msg"></span></div>
    <div id="c-corpo"></div>`;
  const campos = [...el.querySelectorAll('.seletores .campo')];
  const aplicar = () => {
    const v = campos.map(c => c.value.trim().toUpperCase()).filter(t => porTicker.has(t));
    const novo = `comparar/${[...new Set(v)].join(',')}`;
    if (decodeURIComponent(location.hash.slice(1)) !== novo) history.replaceState(null, '', '#' + novo);
    desenharComparacao([...new Set(v)].map(t => porTicker.get(t)), [...new Set(v)]);
  };
  for (const c of campos) c.addEventListener('change', aplicar);
  $('#c-limpar').addEventListener('click', () => { campos.forEach(c => { c.value = ''; }); aplicar(); });
  $('#c-imagem').addEventListener('click', () => {
    if (!selecaoComparar.length) { $('#c-imagem-msg').textContent = 'Escolha pelo menos uma ação para gerar a imagem.'; return; }
    exportarImagem($('#c-captura'), `comparacao-${selecaoComparar.join('-')}-${D.data_precos}.png`, $('#c-imagem-msg'));
  });
  desenharComparacao(sel.map(t => porTicker.get(t)), sel);
}
let selecaoComparar = [];
function desenharComparacao(emps, tks) {
  selecaoComparar = tks;
  const corpo = $('#c-corpo');
  if (!emps.length) {
    const sug = D.empresas.filter(e => e.oportunidade).sort((a, b) => b.nota_oportunidade - a.nota_oportunidade).slice(0, 3).map(e => e.ticker);
    corpo.innerHTML = `<p class="vazio">Digite os tickers acima. Sugestão: <a href="#comparar/${sug.join(',')}">${sug.join(', ')}</a> (as três maiores notas de oportunidade).</p>`;
    return;
  }
  const melhor = (campo, maior) => {
    if (!campo) return null;
    const vals = emps.map(e => e[campo]).filter(v => ok(v) && !(campo === 'div_liq_ebitda' && v >= 99));
    if (vals.length < 2) return null;
    return maior ? Math.max(...vals) : Math.min(...vals.filter(v => campo === 'pl' || campo === 'pvp' || campo === 'ev_ebitda' ? v > 0 : true));
  };
  const misturado = new Set(emps.map(e => !!e.financeira)).size > 1;
  corpo.innerHTML = `
    <div id="c-captura">
    <div class="so-captura captura-cabecalho"><b>Comparador de Investimentos</b>
      <span>${tks.join(' × ')} · preços de ${rotuloPrecos()}</span></div>
    ${misturado ? `<div class="aviso">${ICONE_ALERTA}<div>As notas de bancos e seguradoras são calculadas contra outros bancos e seguradoras, não contra as demais empresas. Compare as notas só dentro do mesmo grupo.</div></div>` : ''}
    <div class="tabela-caixa" style="max-height:none"><table>
      <thead><tr><th class="esq">Indicador</th>${tks.map((t, i) => `<th><span style="display:inline-block;width:10px;height:3px;border-radius:2px;background:var(--serie-${i + 1});vertical-align:middle;margin-right:6px"></span><a href="#empresa/${t}">${t}</a></th>`).join('')}</tr></thead>
      <tbody>${LINHAS_COMPARAR.map(([rot, f, campo, maior]) => {
        const m = melhor(campo, maior);
        return `<tr style="cursor:default"><td class="esq">${rot}</td>${emps.map(e => `<td class="${m != null && e[campo] === m ? 'melhor' : ''}">${f(e)}</td>`).join('')}</tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="grafico-bloco" style="margin-top:12px">
      <h3>Histórico mês a mês<span class="so-captura" id="c-ind-nome"></span></h3>
      <div class="filtros periodos nao-imprimir"><span class="segmentado" role="group" aria-label="Indicador">
        ${Object.entries(INDICADORES_GRAFICO).map(([k, [r]]) => `<button data-ind="${k}" aria-pressed="${k === indicadorComparar}">${r}</button>`).join('')}
      </span></div>
      <div class="grafico" id="g-comparar"></div>
    </div>
    <p class="so-captura captura-rodape">${esc(location.host + location.pathname)} · dados da CVM, B3, Banco Central e Tesouro.
      Material de estudo, não é recomendação de compra ou venda.</p>
    </div>`;
  const desenhar = () => {
    const [nome, idx, fmt] = INDICADORES_GRAFICO[indicadorComparar];
    $('#c-ind-nome').textContent = `: ${nome}`;
    graficoLinhas($('#g-comparar'), {
      fmt, altura: 280, fmtEixo: indicadorComparar === 'dy' ? v => pct(v, 0) : null,
      series: emps.map((e, i) => ({ nome: tks[i], cor: `var(--serie-${i + 1})`, pontos: (D.historico[e.cnpj] ?? []).map(p => [p[0], p[idx]]) })),
      eixoZero: indicadorComparar === 'dy',
    });
  };
  for (const b of corpo.querySelectorAll('[data-ind]')) b.addEventListener('click', () => {
    indicadorComparar = b.dataset.ind;
    corpo.querySelectorAll('[data-ind]').forEach(x => x.setAttribute('aria-pressed', x === b));
    desenhar();
  });
  desenhar();
}

// ---------- Exportar como imagem ----------
// A biblioteca (html-to-image, ~20 KB) só é baixada no primeiro clique.
const toque = matchMedia('(pointer: coarse)').matches;
let bibliotecaImagem;
function carregarBibliotecaImagem() {
  bibliotecaImagem ??= new Promise((resolver, rejeitar) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js';
    s.onload = () => resolver(window.htmlToImage);
    s.onerror = () => { bibliotecaImagem = null; rejeitar(new Error('sem conexão com a biblioteca de imagem')); };
    document.head.appendChild(s);
  });
  return bibliotecaImagem;
}
// Gera o PNG do elemento numa largura fixa (para a tabela não sair cortada no celular)
async function gerarImagem(no) {
  const lib = await carregarBibliotecaImagem();
  // Redesenha os gráficos na largura atual sem esperar o ResizeObserver (que atrasa em aba escondida)
  const redesenhar = () => {
    for (const g of no.querySelectorAll('.grafico')) {
      if (!g._desenhar) continue;
      g._largura = Math.round(g.clientWidth);
      g._desenhar(g._largura);
    }
  };
  document.body.classList.add('capturando');
  try {
    redesenhar();
    return await lib.toBlob(no, {
      pixelRatio: 2, skipFonts: true, cacheBust: false,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
    });
  } finally {
    document.body.classList.remove('capturando');
    redesenhar();
  }
}
async function exportarImagem(no, nome, aviso) {
  aviso.textContent = 'Gerando imagem…';
  try {
    const blob = await gerarImagem(no);
    const arquivo = new File([blob], nome, { type: 'image/png' });
    // No celular abre o compartilhamento (WhatsApp etc.); no computador baixa o arquivo
    if (toque && navigator.canShare?.({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: 'Comparação de ações' });
      aviso.textContent = '';
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      aviso.textContent = `Imagem salva: ${nome}`;
    }
  } catch (e) {
    aviso.textContent = e.name === 'AbortError' ? '' : `Não foi possível gerar a imagem (${e.message}).`;
  }
}

// ---------- ETFs e renda fixa ----------
let periodoEtf = 3;
const indexador = titulo => /IPCA|Renda\+|Educa\+/.test(titulo) ? 'IPCA + ' : /IGPM/.test(titulo) ? 'IGP-M + ' : /Selic/.test(titulo) ? 'Selic + ' : '';
function montarEtfs(el) {
  const linhaRet = (r, c) => `${pctSinal(r)}${ok(c) ? `<span class="setor"> · CDI ${pct(c)}</span>` : ''}`;
  const premios = D.empresas.filter(e => e.elegivel && ok(e.premio_vs_tesouro) && e.nota_qualidade >= 60 && !e.lucro_suspeito && (e.financeira || e.nota_saude >= 50))
    .sort((a, b) => b.premio_vs_tesouro - a.premio_vs_tesouro).slice(0, 10);
  const tes = D.tesouro;
  el.innerHTML = `
    <h2>ETFs e renda fixa</h2>
    <p class="intro">IVVB11 acompanha o S&amp;P 500 (as 500 maiores empresas dos EUA) e WRLD11 o mercado global, ambos
      em reais: o retorno inclui a variação do dólar (${pctSinal(etf.IVVB11?.dolar_12m)} em 12 meses). BOVA11 é o Ibovespa,
      para referência. Tudo comparado com o CDI do mesmo período.</p>
    <div class="tabela-caixa" style="max-height:none"><table>
      <thead><tr><th class="esq">ETF</th><th>Preço</th><th>1 mês</th><th>12 meses</th><th>3 anos (a.a.)</th><th>5 anos (a.a.)</th>
        <th title="Quanto o preço está abaixo da máxima das últimas 52 semanas">Do pico 52s</th><th title="Pior queda do pico ao fundo desde o início">Maior queda</th>
        <th title="Volatilidade anualizada dos últimos 12 meses">Volatilidade</th><th>Liquidez/dia</th></tr></thead>
      <tbody>${D.etfs.map(e => `<tr style="cursor:default"><td class="esq"><b>${e.ticker}</b><span class="nome" style="display:block">desde ${data(e.desde)}</span></td>
        <td>R$ ${num(e.preco, 2)}</td><td class="${classeSinal(e.ret_1m)}">${pctSinal(e.ret_1m)}</td>
        <td>${linhaRet(e.ret_12m, e.cdi_12m)}</td><td>${linhaRet(e.ret_3a_aa, e.cdi_3a_aa)}</td><td>${linhaRet(e.ret_5a_aa, e.cdi_5a_aa)}</td>
        <td>${pct(e.distancia_maxima_52s)}</td><td>${pct(e.maior_queda)}</td><td>${pct(e.volatilidade_anual)}</td><td>${dinheiro(e.liquidez)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="grafico-bloco" style="margin-top:12px">
      <h3>R$ 100 investidos no início do período</h3>
      <div class="filtros periodos"><span class="segmentado" role="group" aria-label="Período">
        ${[[1, '1 ano'], [3, '3 anos'], [5, '5 anos'], [10, 'Desde 2016']].map(([a, r]) => `<button data-anos="${a}" aria-pressed="${a === periodoEtf}">${r}</button>`).join('')}
      </span><span class="contagem" id="etf-nota"></span></div>
      <div class="grafico" id="g-etf"></div>
    </div>
    <div class="duas-colunas">
      <div class="grafico-bloco"><h3>Tesouro Direto hoje</h3><div class="tile-sub">Taxas de compra de ${data(D.macro.tesouro_data)}</div>
        <table><thead><tr><th class="esq">Título · vencimento: taxa (★ = na carteira)</th></tr></thead><tbody>
        ${[...Map.groupBy(tes, t => t.titulo)].map(([titulo, ts]) => `<tr style="cursor:default"><td class="esq" style="white-space:normal">
          <b>${esc(titulo)}</b><div class="setor">${ts.map(t => `${CARTEIRAS.some(c => (c.tesouro ?? []).some(x => x.titulo === t.titulo && x.vencimento === t.vencimento)) ? '★ ' : ''}${t.vencimento.slice(0, 4)}: ${indexador(titulo)}${num(t.taxa, 2)}%`).join(' · ')}</div></td></tr>`).join('')}
        </tbody></table></div>
      <div class="grafico-bloco"><h3>Ações que mais pagam acima do Tesouro</h3>
        <div class="tile-sub">Lucro/preço (o inverso do P/L, um rendimento real aproximado) menos a taxa do Tesouro IPCA+ ~10 anos
          (${num(ipcaRef, 2)}%). Só empresas com qualidade ≥ 60, saúde ≥ 50 e sem sinal de lucro não recorrente.</div>
        <table><thead><tr><th class="esq">Ação</th><th>Lucro/preço</th><th>Acima do Tesouro</th><th>Qualidade</th></tr></thead><tbody>
        ${premios.map(e => `<tr data-ticker="${esc(e.ticker)}"><td class="esq"><b>${esc(e.ticker)}</b> <span class="setor">${esc(e.setor)}</span></td>
          <td>${pct(e.earnings_yield)}</td><td class="${classeSinal(e.premio_vs_tesouro)}">${e.premio_vs_tesouro > 0 ? '+' : ''}${num(e.premio_vs_tesouro * 100, 1)} p.p.</td><td>${e.nota_qualidade}</td></tr>`).join('')}
        </tbody></table></div>
    </div>`;
  for (const tr of el.querySelectorAll('tr[data-ticker]')) tr.addEventListener('click', () => irPara(`empresa/${tr.dataset.ticker}`));
  const desenhar = () => {
    const ultimoMes = D.series.CDI.at(-1)[0];
    const [a, m] = ultimoMes.split('-').map(Number);
    const inicio = periodoEtf === 10 ? '2016-01' : `${a - periodoEtf}-${String(m).padStart(2, '0')}`;
    const fora = [];
    const series = ['IVVB11', 'WRLD11', 'BOVA11', 'CDI'].map((tk, i) => {
      const s = (D.series[tk] ?? []).filter(p => p[0] >= inicio);
      if (!s.length || s[0][0] > inicio) { fora.push(tk); return null; }
      return { nome: tk, cor: `var(--serie-${i + 1})`, pontos: s.map(p => [p[0], 100 * p[1] / s[0][1]]) };
    }).filter(Boolean);
    $('#etf-nota').textContent = fora.length ? `${fora.join(', ')} ainda não existia no início do período` : '';
    graficoLinhas($('#g-etf'), { series, fmt: v => `R$ ${num(v, 0)}`, fmtEixo: v => num(v, 0), ref: { y: 100, rotulo: '' }, altura: 280 });
  };
  for (const b of el.querySelectorAll('[data-anos]')) b.addEventListener('click', () => {
    periodoEtf = Number(b.dataset.anos);
    el.querySelectorAll('[data-anos]').forEach(x => x.setAttribute('aria-pressed', x === b));
    desenhar();
  });
  desenhar();
}

// ---------- Método ----------
function montarMetodo(el) {
  el.innerHTML = `
    <h2>Como funciona</h2>
    <div class="texto-metodo">
      <h3>De onde vêm os dados</h3>
      <p>Balanços trimestrais e anuais da CVM (Dados Abertos), cotações oficiais da B3 (arquivo COTAHIST), juros,
        inflação e dólar do Banco Central e taxas do Tesouro Direto. Tudo é baixado automaticamente todo dia. O histórico
        de balanços começa em 2015; o de múltiplos, em 2020, porque antes disso a CVM não publica a quantidade de ações.</p>
      <h3>Indicadores</h3>
      <ul>
        <li><b>Últimos 12 meses:</b> lucro, receita, EBITDA e dividendos somam os quatro trimestres mais recentes.</li>
        <li><b>Sem olhar o futuro:</b> em cada data do histórico só vale o balanço que já tinha sido entregue à CVM.</li>
        <li><b>Valor de mercado</b> soma as ações ON e PN, cada uma pelo seu preço.</li>
        <li><b>EBITDA</b> não inclui o lucro de coligadas (equivalência patrimonial).</li>
        <li><b>Dividendos</b> são os efetivamente pagos (dividendos + JCP), pelo fluxo de caixa.</li>
      </ul>
      <h3>Notas de 0 a 100</h3>
      <p>Cada nota é a posição da empresa entre as demais do mesmo grupo (empresas, ou bancos e seguradoras). Só entram
        empresas que negociam pelo menos R$ 1 milhão por dia e têm balanço com menos de 200 dias.</p>
      <ul>
        <li><b>Qualidade:</b> ROE, ROIC, margem líquida comparada com o próprio setor e anos com lucro nos últimos 10.</li>
        <li><b>Preço:</b> lucro/preço, EBIT/EV, P/VP e quanto o P/L está abaixo do próprio histórico.</li>
        <li><b>Saúde:</b> dívida líquida/EBITDA, liquidez corrente e dívida líquida/patrimônio.</li>
        <li><b>Crescimento:</b> crescimento anual de receita e lucro em 5 anos.</li>
      </ul>
      <h3>Oportunidade</h3>
      <p>Empresa com lucro, qualidade ≥ 60, saúde ≥ 50 e P/L (ou EV/EBIT) mais barato do que em pelo menos 75% dos meses
        desde 2020. A nota de oportunidade é metade qualidade e saúde, metade o tamanho do desconto.</p>
      <h3>Selos clássicos</h3>
      <ul>
        <li><b>Graham:</b> preço abaixo de √(22,5 × lucro por ação × patrimônio por ação).</li>
        <li><b>Bazin:</b> dividendo médio dos últimos 3 anos de pelo menos 6% do preço atual.</li>
        <li><b>Fórmula Mágica (Greenblatt):</b> as 30 melhores somando a posição em EBIT/EV e em ROIC.</li>
      </ul>
      <h3>Limitações</h3>
      <ul>
        <li>Desdobramentos e grupamentos recentes podem distorcer os múltiplos até o balanço seguinte; quando o preço salta
          numa proporção redonda (1:2, 1:10…), a empresa recebe um alerta e sai das oportunidades.</li>
        <li>Capex e dividendos são identificados pela descrição das contas, que cada empresa escreve do seu jeito.</li>
        <li>Barato contra o passado não é sinônimo de barato: o mercado pode estar prevendo lucros menores.</li>
      </ul>
      <p><b>Esta ferramenta aponta candidatas para estudo. Não é recomendação de compra ou venda.</b></p>
    </div>`;
}

// ---------- Gráficos (SVG) ----------
const dica = $('#dica');
function mostrarDica(html, x, y) {
  dica.innerHTML = html;
  dica.hidden = false;
  const r = dica.getBoundingClientRect();
  const px = x + 14 + r.width > innerWidth ? x - r.width - 14 : x + 14;
  const py = Math.min(Math.max(8, y - r.height / 2), innerHeight - r.height - 8);
  dica.style.left = `${px}px`;
  dica.style.top = `${py}px`;
}
function esconderDica() { dica.hidden = true; }

// Redesenha cada gráfico quando a largura do contêiner muda
const observador = new ResizeObserver(itens => {
  for (const it of itens) {
    const el = it.target, w = Math.round(it.contentRect.width);
    if (w && w !== el._largura) { el._largura = w; el._desenhar(w); }
  }
});
function montarGrafico(el, desenhar) {
  el._desenhar = desenhar;
  el._largura = Math.round(el.clientWidth) || 600;
  desenhar(el._largura);
  observador.observe(el);
}

function escalaBonita(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const passoBruto = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(passoBruto));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * mag).find(p => p >= passoBruto);
  const ini = Math.floor(min / passo) * passo, fim = Math.ceil(max / passo) * passo;
  const marcas = [];
  for (let v = ini; v <= fim + passo / 2; v += passo) marcas.push(Number(v.toFixed(10)));
  return { ini, fim, marcas };
}
// Teto da escala que ignora picos extremos (ex.: P/L de 300 quando o lucro quase zerou)
function tetoRobusto(vals, extras = []) {
  const ord = [...vals].sort((a, b) => a - b);
  const q95 = ord[Math.floor(0.95 * (ord.length - 1))];
  const max = ord.at(-1);
  if (!(q95 > 0) || max <= 2.5 * q95) return Math.max(max, ...extras);
  return Math.max(q95 * 1.25, ...extras);
}
const casas = passo => passo >= 1 ? 0 : passo >= 0.1 ? 1 : 2;
const compacto = v => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${num(v / 1e9, a >= 1e10 ? 0 : 1)} bi`;
  if (a >= 1e6) return `${num(v / 1e6, 0)} mi`;
  return null;
};

function graficoLinhas(el, { series, fmt, fmtEixo = null, ref = null, altura = 220, eixoZero = false }) {
  const meses = [...new Set(series.flatMap(s => s.pontos.map(p => p[0])))].sort();
  const vals = series.flatMap(s => s.pontos.map(p => p[1])).filter(ok);
  el.innerHTML = '';
  if (meses.length < 2 || !vals.length) { el.innerHTML = '<p class="vazio">Sem histórico suficiente.</p>'; return; }
  const mapas = series.map(s => new Map(s.pontos));
  const ultimos = mapas.map(mp => mp.get(meses.findLast(mm => ok(mp.get(mm))))).filter(ok);
  const idClip = `clip${Math.random().toString(36).slice(2)}`;
  montarGrafico(el, w => {
    let lo = Math.min(...vals, ...(ref ? [ref.y] : []));
    const hi = tetoRobusto(vals, [...(ref ? [ref.y] : []), ...ultimos]);
    if (eixoZero) lo = Math.min(0, lo);
    const esc_ = escalaBonita(lo, hi);
    const passo = esc_.marcas[1] - esc_.marcas[0];
    const rotY = v => compacto(v) ?? (fmtEixo ? fmtEixo(v) : num(v, casas(passo)));
    const cortado = Math.max(...vals) > esc_.fim;
    const esqM = Math.max(...esc_.marcas.map(v => rotY(v).length)) * 6.5 + 10;
    const m = { e: esqM, d: 12, t: series.length > 1 ? 8 : 8, b: 24 };
    const W = w, H = altura, pw = W - m.e - m.d, ph = H - m.t - m.b;
    const X = i => m.e + i * pw / (meses.length - 1);
    const Y = v => m.t + ph - (v - esc_.ini) / (esc_.fim - esc_.ini) * ph;
    const anos = meses.map((mm, i) => [mm, i]).filter(([mm], i) => mm.endsWith('-01') || i === 0);
    const passoAno = Math.ceil(anos.length / Math.max(1, Math.floor(pw / 48)));
    let svg = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(series.map(s => s.nome).join(', '))}">
      <defs><clipPath id="${idClip}"><rect x="0" y="${m.t - 4}" width="${W}" height="${ph + 8}"/></clipPath></defs>`;
    for (const v of esc_.marcas) svg += `<line x1="${m.e}" x2="${W - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grade)" stroke-width="1"/>
      <text x="${m.e - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(rotY(v))}</text>`;
    anos.filter((_, k) => k % passoAno === 0).forEach(([mm, i]) => { svg += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${mm.endsWith('-01') ? mm.slice(0, 4) : mesAno(mm)}</text>`; });
    if (ref) svg += `<line x1="${m.e}" x2="${W - m.d}" y1="${Y(ref.y)}" y2="${Y(ref.y)}" stroke="var(--texto-3)" stroke-width="1"/>
      ${ref.rotulo ? `<text x="${m.e + 4}" y="${Y(ref.y) - 5}">${esc(ref.rotulo)}</text>` : ''}`;
    mapas.forEach((mp, si) => {
      let d = '', caneta = false;
      meses.forEach((mm, i) => { const v = mp.get(mm); if (ok(v)) { d += `${caneta ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; caneta = true; } else caneta = false; });
      svg += `<path d="${d}" fill="none" stroke="${series[si].cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#${idClip})"/>`;
      const ult = meses.findLastIndex(mm => ok(mp.get(mm)));
      if (ult >= 0) svg += `<circle cx="${X(ult)}" cy="${Y(mp.get(meses[ult]))}" r="4" fill="${series[si].cor}" stroke="var(--superficie)" stroke-width="2"/>`;
    });
    if (cortado) svg += `<text x="${W - m.d}" y="${m.t + 10}" text-anchor="end">picos acima de ${esc(rotY(esc_.fim))} cortados</text>`;
    svg += `<line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="var(--texto-3)" stroke-width="1" visibility="hidden"/>
      <g class="pontos-cruz"></g>
      <rect x="${m.e}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent" class="alvo"/></svg>`;
    el.innerHTML = (series.length > 1 ? `<div class="legenda">${series.map(s => `<span><i style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>` : '') + svg;
    const alvo = $('.alvo', el), cruz = $('.cruz', el), pontos = $('.pontos-cruz', el);
    const mover = ev => {
      const r = alvo.getBoundingClientRect();
      const cx = (ev.touches?.[0] ?? ev).clientX, cy = (ev.touches?.[0] ?? ev).clientY;
      const i = Math.max(0, Math.min(meses.length - 1, Math.round((cx - r.left) / r.width * (meses.length - 1))));
      cruz.setAttribute('x1', X(i)); cruz.setAttribute('x2', X(i)); cruz.setAttribute('visibility', 'visible');
      pontos.innerHTML = mapas.map((mp, si) => ok(mp.get(meses[i])) && mp.get(meses[i]) <= esc_.fim ? `<circle cx="${X(i)}" cy="${Y(mp.get(meses[i]))}" r="4" fill="${series[si].cor}" stroke="var(--superficie)" stroke-width="2"/>` : '').join('');
      mostrarDica(`<div class="dica-titulo">${mesAno(meses[i])}</div>${series.map((s, si) =>
        `<div class="dica-linha"><span><i style="background:${s.cor}"></i>${esc(s.nome)}</span><b>${ok(mapas[si].get(meses[i])) ? esc(fmt(mapas[si].get(meses[i]))) : '–'}</b></div>`).join('')}`, cx, cy);
    };
    const sair = () => { cruz.setAttribute('visibility', 'hidden'); pontos.innerHTML = ''; esconderDica(); };
    alvo.addEventListener('mousemove', mover);
    alvo.addEventListener('touchmove', mover, { passive: true });
    alvo.addEventListener('mouseleave', sair);
    alvo.addEventListener('touchend', sair);
  });
}

function graficoColunas(el, { pontos, fmt, altura = 200 }) {
  const vals = pontos.map(p => p[1]).filter(ok);
  el.innerHTML = '';
  if (!vals.length) { el.innerHTML = '<p class="vazio">Sem dados.</p>'; return; }
  montarGrafico(el, w => {
    const esc_ = escalaBonita(Math.min(0, ...vals), Math.max(0, ...vals));
    const rotY = v => compacto(v) ?? num(v, 0);
    const m = { e: Math.max(...esc_.marcas.map(v => rotY(v).length)) * 6.5 + 10, d: 8, t: 8, b: 24 };
    const pw = w - m.e - m.d, ph = altura - m.t - m.b;
    const faixa = pw / pontos.length, larg = Math.min(24, faixa * 0.6);
    const Y = v => m.t + ph - (v - esc_.ini) / (esc_.fim - esc_.ini) * ph;
    const base = Y(0);
    const passoRot = Math.ceil(pontos.length / Math.max(1, Math.floor(pw / 40)));
    let svg = `<svg width="${w}" height="${altura}" role="img">`;
    for (const v of esc_.marcas) svg += `<line x1="${m.e}" x2="${w - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grade)" stroke-width="1"/>
      <text x="${m.e - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(rotY(v))}</text>`;
    pontos.forEach(([rot, v], i) => {
      const cx = m.e + faixa * (i + .5), x = cx - larg / 2;
      if ((pontos.length - 1 - i) % passoRot === 0) svg += `<text x="${cx}" y="${altura - 6}" text-anchor="middle">${esc(rot)}</text>`;
      if (!ok(v) || v === 0) return;
      // Coluna com a ponta de dados arredondada (4px) e a base reta
      const topo = Y(v), r = Math.min(4, Math.abs(base - topo) / 2, larg / 2);
      const d = v > 0
        ? `M${x},${base}V${topo + r}Q${x},${topo} ${x + r},${topo}H${x + larg - r}Q${x + larg},${topo} ${x + larg},${topo + r}V${base}Z`
        : `M${x},${base}V${topo - r}Q${x},${topo} ${x + r},${topo}H${x + larg - r}Q${x + larg},${topo} ${x + larg},${topo - r}V${base}Z`;
      svg += `<path d="${d}" fill="${v < 0 ? 'var(--negativo-col)' : 'var(--serie-1)'}"/>
        <rect x="${m.e + faixa * i}" y="${m.t}" width="${faixa}" height="${ph}" fill="transparent" data-i="${i}" class="alvo-col"/>`;
    });
    svg += `<line x1="${m.e}" x2="${w - m.d}" y1="${base}" y2="${base}" stroke="var(--texto-3)" stroke-width="1"/></svg>`;
    el.innerHTML = svg;
    for (const a of el.querySelectorAll('.alvo-col')) {
      a.addEventListener('mousemove', ev => { const [rot, v] = pontos[a.dataset.i]; mostrarDica(`<div class="dica-titulo">${esc(rot)}</div><b>${esc(fmt(v))}</b>`, ev.clientX, ev.clientY); });
      a.addEventListener('mouseleave', esconderDica);
    }
  });
}

// ---------- Início ----------
montarTopo();
window.addEventListener('hashchange', rota);
rota();
