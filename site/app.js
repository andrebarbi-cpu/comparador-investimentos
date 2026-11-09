'use strict';
// Comparador de Investimentos: página estática que lê window.DADOS (gerado por src/exportar.js).

const D = window.DADOS;

// ---------- Pregão de hoje ou fechamento oficial ----------
// Durante o pregão os dados trazem o preço parcial (15 min de atraso) e, em D.oficial, o último
// fechamento oficial. A escolha fica salva no aparelho; no modo oficial os números que dependem do
// preço (P/L, P/VP, dividend yield, margens de Graham e Bazin) são refeitos com o preço do fechamento.
const CHAVE_MODO_PRECOS = 'comparador.precos';
const PARCIAL = D.precos_parciais;
let modoPrecos = 'agora';
try { if (D.oficial && localStorage.getItem(CHAVE_MODO_PRECOS) === 'oficial') modoPrecos = 'oficial'; } catch { /* sem armazenamento */ }
if (modoPrecos === 'oficial') aplicarFechamentoOficial();
function aplicarFechamentoOficial() {
  const O = D.oficial.precos;
  for (const e of D.empresas) {
    const o = O[e.ticker];
    if (!o || !(e.preco > 0)) continue;
    const f = o[0] / e.preco;
    if (typeof e.ev === 'number' && typeof e.vm === 'number') {
      const ev = e.ev + e.vm * (f - 1);
      if (e.ev > 0) { if (e.ev_ebit != null) e.ev_ebit *= ev / e.ev; if (e.ev_ebitda != null) e.ev_ebitda *= ev / e.ev; }
      e.ev = ev;
    }
    for (const k of ['vm', 'pl', 'pvp']) if (typeof e[k] === 'number') e[k] *= f;
    for (const k of ['dy', 'dy_3a', 'earnings_yield', 'ebit_ev']) if (typeof e[k] === 'number') e[k] /= f;
    for (const k of ['graham_margem', 'bazin_margem']) if (typeof e[k] === 'number') e[k] = (1 + e[k]) / f - 1;
    if (typeof e.variacao_12m === 'number') e.variacao_12m = (1 + e.variacao_12m) * f - 1;
    if (typeof e.earnings_yield === 'number' && typeof e.tesouro_ipca_ref === 'number') e.premio_vs_tesouro = e.earnings_yield - e.tesouro_ipca_ref / 100;
    e.preco = o[0]; e.var_dia = o[1]; e.data = D.oficial.data;
  }
  for (const x of D.etfs) {
    const o = O[x.ticker];
    if (!o || !(x.preco > 0)) continue;
    const f = o[0] / x.preco;
    for (const k of ['ret_1m', 'ret_12m']) if (typeof x[k] === 'number') x[k] = (1 + x[k]) * f - 1;
    x.preco = o[0]; x.var_dia = o[1];
  }
  for (const tk of Object.keys(D.precos ?? {})) if (D.precos[tk].at(-1)?.[0] === D.data_precos) D.precos[tk].pop();
  for (const [tk, t] of Object.entries(D.tickers ?? {})) {
    const o = O[tk];
    if (o) D.tickers[tk] = [o[0], o[1], t[2] != null ? (1 + t[2]) * o[0] / t[0] - 1 : null, o[2]];
  }
  D.data_precos = D.oficial.data;
  D.precos_parciais = null;
}
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
  // P/L que vale contra a régua: o recorrente quando há ganho não recorrente listado (config/lucro-recorrente.json)
  e.pl_uso = ok(e.pl_recorrente) ? e.pl_recorrente : e.pl;
  e.regua = reguaPl(e);
  e.pl_pct_regua = e.regua.pct;
}

// Régua do P/L contra o próprio histórico. A mediana desde 2020 inclui os anos de juro real perto de
// zero (2020–2022), quando qualquer lucro valia mais; com o Tesouro IPCA+ a 7–8% ela exagera o
// desconto. Vale a mais exigente entre "desde 2020" e "últimos 2 anos": preço normal e caro pela
// mediana e pelo percentil 75 MENORES, e "mais barato que" pelo percentil MAIOR.
function reguaPl(e) {
  const menor = (a, b) => ok(a) && ok(b) ? Math.min(a, b) : (ok(a) ? a : b);
  const pcts = (ok(e.pl_recorrente) ? [e.pl_rec_percentil, e.pl_rec_percentil_2a] : [e.pl_percentil, e.pl_percentil_2a]).filter(ok);
  const mediana = menor(e.pl_mediana, e.pl_mediana_2a);
  return { mediana, p25: menor(e.pl_p25, e.pl_p25_2a), p75: menor(e.pl_p75, e.pl_p75_2a),
    pct: pcts.length ? Math.max(...pcts) : null,
    recente: ok(e.pl_mediana_2a) && ok(e.pl_mediana) && e.pl_mediana_2a < e.pl_mediana };
}
const listaTickers = [...porTicker.keys()].sort();
const etf = Object.fromEntries(D.etfs.map(e => [e.ticker, e]));
const ipcaRef = D.empresas.find(e => ok(e.tesouro_ipca_ref))?.tesouro_ipca_ref;

// "29/10/2026" no fechamento oficial; "03/11/2026 às 15:27 (parcial)" durante o pregão
const horaParcial = PARCIAL?.hora
  ? new Date(PARCIAL.hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : null;
const rotuloPrecos = () => D.precos_parciais ? `${data(D.data_precos)} às ${horaParcial ?? '?'} (parcial)`
  : modoPrecos === 'oficial' ? `${data(D.data_precos)} (fechamento oficial)` : data(D.data_precos);

// ---------- Tema claro/escuro ----------
// Sem escolha salva, segue o sistema. Os gráficos usam variáveis de cor, então trocam junto.
const CHAVE_TEMA = 'comparador.tema';
const ICONE_SOL = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="3.5"/><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4"/></svg>';
const ICONE_LUA = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z"/></svg>';
const temaAtual = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function pintarBotaoTema() {
  const escuro = temaAtual() === 'dark';
  const b = $('#tema');
  b.innerHTML = `${escuro ? ICONE_SOL : ICONE_LUA}<span>${escuro ? 'Tema claro' : 'Tema escuro'}</span>`;
  b.setAttribute('aria-label', escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro');
}
$('#tema').addEventListener('click', () => {
  const novo = temaAtual() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = novo;
  try { localStorage.setItem(CHAVE_TEMA, novo); } catch { /* sem armazenamento: vale só nesta visita */ }
  pintarBotaoTema();
});
pintarBotaoTema();

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
  // Pregão em andamento: escolha entre o preço de agora (parcial) e o último fechamento oficial
  if (D.oficial) {
    const el = $('#modo-precos');
    el.hidden = false;
    el.innerHTML = `<span class="segmentado" role="group" aria-label="Quais preços usar">
      <button data-modo-precos="agora" aria-pressed="${modoPrecos === 'agora'}" title="Preço do pregão em andamento, com 15 minutos de atraso">Pregão de hoje · ${horaParcial ?? 'parcial'}</button>
      <button data-modo-precos="oficial" aria-pressed="${modoPrecos === 'oficial'}" title="Último fechamento oficial da B3">Fechamento de ${data(D.oficial.data).slice(0, 5)}</button></span>`;
    for (const b of el.querySelectorAll('[data-modo-precos]')) b.addEventListener('click', () => {
      if (b.dataset.modoPrecos === modoPrecos) return;
      try { localStorage.setItem(CHAVE_MODO_PRECOS, b.dataset.modoPrecos); } catch { /* vale só nesta visita */ }
      location.reload();
    });
  }
  montarBusca();
  // Altura do topo fixo: o menu de seções da página do ativo gruda logo abaixo dele
  new ResizeObserver(() => document.documentElement.style.setProperty('--topo-altura', `${$('.topo').offsetHeight}px`)).observe($('.topo'));
}

// Busca de ativo no topo: ticker ou parte do nome; Enter abre a página da ação (ETF abre a aba de ETFs)
function montarBusca() {
  const campo = $('#busca'), lista = $('#busca-lista');
  // Todos os códigos de cada empresa (ALUP11, ALUP3, ALUP4...), o principal primeiro
  const todos = [...D.empresas.flatMap(e => [e.ticker, ...e.tickers.split(' ').filter(t => t !== e.ticker && D.tickers?.[t])]
      .map((tk, i) => ({ tk, nome: e.nome, outros: tk, vm: (e.vm ?? 0) / (i ? 10 : 1) }))),
    ...D.etfs.map(x => ({ tk: x.ticker, nome: x.nome, outros: x.ticker, vm: 1e13, etf: true }))];
  let achados = [], sel = 0;
  const abrir = a => { campo.value = ''; lista.hidden = true; campo.blur(); irPara(a.etf ? 'etfs' : `empresa/${a.tk}`); };
  const desenhar = () => {
    lista.innerHTML = achados.map((a, i) => `<li role="option" data-i="${i}" ${i === sel ? 'aria-selected="true"' : ''}><b>${esc(a.tk)}</b><span>${esc(a.nome)}</span>${a.etf ? '<em>ETF</em>' : ''}</li>`).join('')
      || '<li class="vazio">Nenhum ativo encontrado</li>';
    lista.hidden = false;
  };
  campo.addEventListener('input', () => {
    const q = campo.value.trim().toUpperCase();
    if (!q) { lista.hidden = true; return; }
    achados = todos.filter(a => a.outros.includes(q) || a.nome.toUpperCase().includes(q))
      .sort((a, b) => (b.tk.startsWith(q) - a.tk.startsWith(q)) || b.vm - a.vm).slice(0, 8);
    sel = 0;
    desenhar();
  });
  campo.addEventListener('keydown', ev => {
    if (lista.hidden || !achados.length) return;
    if (ev.key === 'ArrowDown') { sel = (sel + 1) % achados.length; desenhar(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { sel = (sel - 1 + achados.length) % achados.length; desenhar(); ev.preventDefault(); }
    else if (ev.key === 'Enter') abrir(achados[sel]);
    else if (ev.key === 'Escape') lista.hidden = true;
  });
  lista.addEventListener('mousedown', ev => { const li = ev.target.closest('[data-i]'); if (li) abrir(achados[Number(li.dataset.i)]); });
  campo.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 150));
  document.addEventListener('keydown', ev => {
    if (ev.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { ev.preventDefault(); campo.focus(); }
  });
}

// ---------- Navegação ----------
const ABAS = { inicio: montarInicio, ativo: montarAtivo, oportunidades: montarOportunidades, carteiras: montarCarteiras, ranking: montarRanking, comparar: montarComparar, etfs: montarEtfs, simulador: montarSimulador, metodo: montarMetodo };
const montadas = new Set();
let abaAtual = null;

function rota() {
  const h = decodeURIComponent(location.hash.slice(1)) || 'inicio';
  const [nome, arg] = h.split('/');
  if (nome === 'importar') { importar(arg); return; }
  if (nome === 'empresa') {
    if (abaAtual && abaAtual !== 'ativo') voltarPara = abaAtual;
    mostrarAba('ativo', arg);
    return;
  }
  esconderDica();
  mostrarAba(ABAS[nome] ? nome : 'inicio', arg);
  window.scrollTo(0, 0);
}
function mostrarAba(nome, arg) {
  abaAtual = nome;
  document.body.dataset.aba = nome;
  for (const a of document.querySelectorAll('#abas a')) {
    if (a.dataset.aba === nome) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  for (const s of document.querySelectorAll('.aba')) s.classList.toggle('ativa', s.id === `aba-${nome}`);
  const el = $(`#aba-${nome}`);
  // Comparar depende do link; o Início, das quantidades, que podem ter mudado na Carteira
  if (nome === 'comparar' || nome === 'inicio' || nome === 'ativo') ABAS[nome](el, arg);
  else if (!montadas.has(nome)) { ABAS[nome](el); montadas.add(nome); }
}
const irPara = h => { location.hash = h; };

// ---------- Ordenação por vários critérios ----------
// Um critério: ordena normalmente. Dois ou mais: cada linha ganha uma posição de 0 a 100 em cada
// critério (100 = a melhor na direção escolhida) e a lista ordena pela média, para subir quem vai
// bem em todos ao mesmo tempo. Desempate puro não serviria: P/VP e preço quase nunca empatam.
// Valor ausente conta como o pior.
const vazio = v => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
function ordenarPorCriterios(linhas, criterios, valor, ehTexto) {
  const comparar = (a, b, k) => ehTexto(k) ? String(a).localeCompare(String(b), 'pt-BR') : a - b;
  if (criterios.length < 2) {
    if (!criterios.length) return { linhas, combinado: null };
    const { k, desc } = criterios[0];
    return { combinado: null, linhas: [...linhas].sort((a, b) => {
      const va = valor(a, k), vb = valor(b, k);
      if (vazio(va)) return 1;
      if (vazio(vb)) return -1;
      return desc ? -comparar(va, vb, k) : comparar(va, vb, k);
    }) };
  }
  const soma = new Map(linhas.map(l => [l, 0]));
  for (const { k, desc } of criterios) {
    const com = linhas.filter(l => !vazio(valor(l, k))).sort((a, b) => comparar(valor(a, k), valor(b, k), k));
    // Valores iguais ficam na mesma posição
    let inicio = 0;
    com.forEach((l, i) => {
      if (i > 0 && comparar(valor(com[i - 1], k), valor(l, k), k) !== 0) inicio = i;
      const p = com.length > 1 ? inicio / (com.length - 1) : 1;
      soma.set(l, soma.get(l) + (desc ? p : 1 - p));
    });
  }
  const combinado = new Map([...soma].map(([l, s]) => [l, Math.round(100 * s / criterios.length)]));
  return { combinado, linhas: [...linhas].sort((a, b) => combinado.get(b) - combinado.get(a)) };
}
// Clique no título: o 1º inclui o critério, o 2º inverte a direção, o 3º tira
function alternarCriterio(criterios, k, descPadrao) {
  const i = criterios.findIndex(c => c.k === k);
  if (i < 0) return [...criterios, { k, desc: descPadrao, invertido: false }];
  if (!criterios[i].invertido) return criterios.map((c, j) => (j === i ? { ...c, desc: !c.desc, invertido: true } : c));
  return criterios.filter((_, j) => j !== i);
}
const marcaCriterio = (criterios, k) => {
  const i = criterios.findIndex(c => c.k === k);
  return i < 0 ? '' : ` <span class="marca-ordem">${'①②③④⑤⑥⑦⑧⑨'[i] ?? i + 1}${criterios[i].desc ? '↓' : '↑'}</span>`;
};
const descreverCriterios = (criterios, rotulo) => criterios.map(c => `${rotulo(c.k)} ${c.desc ? '↓' : '↑'}`).join(' + ');

// ---------- Início ----------
// Painel do dia: mercado, a carteira de quem abriu, o que merece atenção, a agenda da semana e o mapa de calor.
let modoMapa = null;
function montarInicio(el) {
  const c = CARTEIRAS[0];
  const hora = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }));
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const t = c ? totaisCarteira(c) : { saldo: 0 };
  const temQtd = t.saldo > 0;
  modoMapa ??= temQtd ? 'carteira' : 'bolsa';
  const oport = D.empresas.filter(e => e.oportunidade && !naCarteira.has(e.cnpj) && perene(e) && grande(e))
    .sort((a, b) => b.nota_oportunidade - a.nota_oportunidade).slice(0, 3);
  el.innerHTML = `
    <div class="inicio-topo"><div><h2>${saudacao}</h2>
      <p class="intro" style="margin-bottom:0">Resumo de ${rotuloPrecos()}: o mercado, a carteira e o que pede atenção.</p></div>
      <a class="botao" href="#carteiras">Abrir a carteira</a></div>
    <div class="indicadores">${blocosMercado()}</div>
    ${blocoMercadoNoticias()}
    ${temQtd ? `<div class="indicadores indicadores-carteira">
      <div class="bloco"><h3>Sua carteira</h3><div class="tile-valor">${dinheiro(t.saldo)}</div><div class="tile-sub">Saldo estimado com Tesouro e CDB</div></div>
      <div class="bloco"><h3>Hoje</h3><div class="tile-valor ${classeSinal(t.dia)}">${t.dia >= 0 ? '+' : '−'}${dinheiro(Math.abs(t.dia))}</div>
        <div class="tile-sub"><span class="${classeSinal(t.dia)}">${pctSinal(t.dia / (t.bolsa - t.dia))}</span> em ações e ETFs</div></div>
      <div class="bloco"><h3>Renda anual estimada</h3><div class="tile-valor">${dinheiro(t.renda)}</div><div class="tile-sub">${dinheiro(t.renda / 12)} por mês, pelos dividendos de 12 meses</div></div>
    </div>` : `<div class="aviso aviso-info"><div>Preencha as quantidades na <a href="#carteiras">Carteira</a>
      para ver aqui o saldo, quanto ela variou hoje e a renda estimada. Os números ficam só neste aparelho.</div></div>`}
    <div class="inicio-grade">
      <div class="grafico-bloco"><h3>Merece atenção</h3><div class="tile-sub">Gatilhos das regras da carteira e movimentos fortes do dia</div>
        <div class="atencao">${itensAtencao(c).map(itemAtencao).join('') || '<p class="vazio">Nada fora do normal hoje.</p>'}</div></div>
      <div class="grafico-bloco"><h3>Resultados da semana</h3><div class="tile-sub">Temporada ${esc(AGENDA.trimestre ?? '')} · empresas da carteira e acompanhadas</div>
        <div class="atencao">${agendaSemana() || '<p class="vazio">Nenhum resultado nos próximos dias.</p>'}</div></div>
    </div>
    ${blocoTermometroInicio(c)}
    <div class="grafico-bloco" style="margin-top:12px">
      <div class="mapa-topo"><div><h3>Mapa do dia</h3><div class="tile-sub" id="mapa-legenda"></div></div>
        <span class="segmentado" role="group" aria-label="O que mostrar no mapa">
          <button data-mapa="carteira" aria-pressed="${modoMapa === 'carteira'}">Carteira</button>
          <button data-mapa="bolsa" aria-pressed="${modoMapa === 'bolsa'}">Maiores da bolsa</button></span></div>
      <div class="mapa" id="mapa"></div>
      <div class="mapa-escala" aria-hidden="true"><span>−4%</span><i></i><span>0</span><i class="alta"></i><span>+4%</span></div>
    </div>
    ${oport.length ? `<div class="inicio-titulo"><h3 class="secao" style="margin:0">Oportunidades em destaque</h3><a href="#oportunidades">Ver todas</a></div>
      <div class="cartoes">${oport.map(cartaoOportunidade).join('')}</div>` : ''}`;
  for (const b of el.querySelectorAll('[data-mapa]')) b.addEventListener('click', () => { modoMapa = b.dataset.mapa; montarInicio(el); });
  for (const a of el.querySelectorAll('[data-ir]')) a.addEventListener('click', () => irPara(a.dataset.ir));
  for (const k of el.querySelectorAll('.cartao')) k.addEventListener('click', () => irPara(`empresa/${k.dataset.ticker}`));
  for (const s of el.querySelectorAll('.spark')) desenharSpark(s, porTicker.get(s.dataset.ticker));
  desenharMapa($('#mapa'), c);
}

// Saldo, renda, quanto ações e ETFs variaram hoje (em reais) e quanto há em bolsa
function totaisCarteira(c) {
  let saldo = 0, renda = 0, dia = 0, bolsa = 0;
  const somarBolsa = (tk, valor) => { bolsa += valor; const v = variacao(tk, 1); if (ok(v)) dia += valor * v / (1 + v); };
  if (c.acoes) for (const l of linhasAcoes(c)) { saldo += l.saldo; renda += l.renda; somarBolsa(l.tk, l.saldo); }
  for (const tk of c.etfs ?? []) { const v = (local.qtd[tk] ?? 0) * (precoAtual(tk) ?? 0); saldo += v; somarBolsa(tk, v); }
  for (const t of c.tesouro ?? []) saldo += (local.qtd[`TD:${chaveTesouro(t)}`] ?? 0) * (infoTesouro(t).pu ?? 0);
  if (c.cdb) for (const cdb of local.cdbs) if (cdb.valor && cdb.data) saldo += calcularCdb(cdb).bruto;
  return { saldo, renda, dia, bolsa };
}

function blocosMercado() {
  const b = etf.BOVA11, m = D.macro, r = m.dolar_12m;
  const bloco = (titulo, valor, sub, href) => `<a class="bloco bloco-link" ${href ? `href="${href}"` : ''}><h3>${titulo}</h3><div class="tile-valor">${valor}</div><div class="tile-sub">${sub}</div></a>`;
  return [
    b && bloco('Ibovespa (BOVA11)', `<span class="${classeSinal(b.var_dia)}">${pctSinal(b.var_dia)}</span>`,
      `${pctSinal(b.ret_1m)} no mês · ${pct(-b.distancia_maxima_52s, 0)} abaixo do pico`, '#etfs'),
    m.dolar && bloco('Dólar', `R$ ${num(m.dolar.valor, 2)}`, r ? `${pctSinal(m.dolar.valor / r.mediana - 1, 0)} contra a mediana de 12 meses` : '', '#etfs'),
    etf.IVVB11 && bloco('S&P 500 (IVVB11)', `<span class="${classeSinal(etf.IVVB11.var_dia)}">${pctSinal(etf.IVVB11.var_dia)}</span>`, `${pctSinal(etf.IVVB11.ret_12m, 0)} em 12 meses`, '#etfs'),
    m.selic && bloco('Selic', `${num(m.selic.valor, 2)}%`, m.ipca_12m ? `IPCA 12 meses ${num(m.ipca_12m.valor, 2)}%` : '', '#etfs'),
    ok(ipcaRef) && bloco('Tesouro IPCA+', `${num(ipcaRef, 2)}%`, 'Taxa real do título de ~10 anos', '#etfs'),
  ].filter(Boolean).join('');
}

// ---------- Notícias ligadas aos movimentos ----------
// Fatos agrupados por dia e tema (src/noticias.js). Confirmado = dois ou mais veículos reconhecidos
// publicaram o mesmo tema no mesmo dia, ou a própria empresa publicou na CVM (fato relevante ou
// comunicado: f.of). Uma fonte de imprensa sozinha aparece, mas nunca vira "motivo".
const NOTICIAS = D.noticias ?? {};
const TEMA_ROTULO = { resultado: 'Resultado', dividendos: 'Dividendos', 'recomendação': 'Recomendação de analistas',
  'operação societária': 'Operação societária', esclarecimento: 'Esclarecimento da empresa', 'regulação e justiça': 'Regulação e justiça',
  'fiscal e política': 'Fiscal e política', 'juros e inflação': 'Juros e inflação', exterior: 'Exterior', commodities: 'Commodities',
  'câmbio': 'Câmbio', resumo: 'Resumo do mercado', outros: 'Outros' };
const confirmado = f => f.conf >= 2 || !!f.of;
function fatosDe(e, tk) {
  const vistos = new Set();
  return [...new Set([tk, ...(e?.tickers?.split(' ') ?? [])])].flatMap(c => NOTICIAS[c] ?? [])
    .filter(f => f.tema !== 'resumo' && !vistos.has(f.d + f.tema) && vistos.add(f.d + f.tema))
    .sort((a, b) => b.d.localeCompare(a.d) || b.conf - a.conf);
}
// Dia útil anterior: notícia que sai depois do fechamento mexe com o pregão seguinte
function diaUtilAnterior(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
function motivoEmpresa(e, tk, dia = D.data_precos) {
  const dias = [dia, diaUtilAnterior(dia)];
  // Comunicado de rotina da CVM ("renúncia de conselheiro") sem eco na imprensa não explica movimento
  return fatosDe(e, tk).filter(f => dias.includes(f.d) && confirmado(f) && !(f.of === 'comunicado' && f.conf < 2 && f.tema === 'outros'))
    .sort((a, b) => (a.tema === 'outros') - (b.tema === 'outros') || b.conf - a.conf || !!b.of - !!a.of)[0] ?? null;
}
// Motivos do mercado no dia: dólar por último (costuma ser efeito, não causa); a mesma manchete não se repete
function motivosMercado(dia = D.data_precos) {
  const vistos = new Set();
  return (NOTICIAS.MERCADO ?? []).filter(f => f.d === dia && confirmado(f) && !['outros', 'resumo'].includes(f.tema))
    .sort((a, b) => (a.tema === 'câmbio') - (b.tema === 'câmbio') || b.conf - a.conf)
    .filter(f => !vistos.has(f.titulo) && vistos.add(f.titulo)).slice(0, 3);
}
const fontesTexto = f => f.fontes.map(x => x[0]).join(', ');
const fontesLinks = f => f.fontes.map(([n, l]) => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(', ');
const seloConfirmacao = f => [
  f.of && `<span class="etiqueta etiqueta-movimento" title="Documento entregue pela própria empresa à CVM (${f.of})">oficial · CVM</span>`,
  f.conf >= 2 ? `<span class="etiqueta etiqueta-compra" title="Publicado por ${f.conf} veículos reconhecidos no mesmo dia">${f.conf} fontes</span>`
    : !f.of && '<span class="etiqueta etiqueta-conferir" title="Menos de dois veículos reconhecidos publicaram: trate como boato até confirmar">não confirmado</span>',
].filter(Boolean).join('');
const selosFato = f => `<span class="fato-selos">${seloConfirmacao(f)}</span>`;
const linhaFato = (f, extra = '') => `<li class="fato"><div class="fato-topo"><span class="fato-data">${data(f.d).slice(0, 5)}</span>
  <span class="fato-tema">${esc(TEMA_ROTULO[f.tema] ?? f.tema)}</span>${extra}${selosFato(f)}</div>
  <a class="fato-titulo" href="${esc(f.link)}" target="_blank" rel="noopener">${esc(f.titulo)}</a>
  <div class="fato-fontes">${f.fontes.length > 1 ? 'Fontes' : 'Fonte'}: ${fontesLinks(f)}</div></li>`;
// Texto do movimento forte no "Merece atenção": notícia confirmada da empresa, senão o motivo do mercado
function explicarMovimento(e, tk, v) {
  const m = motivoEmpresa(e, tk);
  if (m) return `Provável motivo (${TEMA_ROTULO[m.tema].toLowerCase()}): ${m.titulo} · ${fontesTexto(m)}`;
  const mm = motivosMercado()[0], ibov = etf.BOVA11?.var_dia;
  if (mm && ok(ibov) && Math.abs(ibov) >= 0.005 && Math.sign(ibov) === Math.sign(v))
    return `Sem notícia confirmada da empresa; o Ibovespa ${ibov < 0 ? 'caiu' : 'subiu'} ${pctSinal(ibov)} com ${TEMA_ROTULO[mm.tema].toLowerCase()} · ${fontesTexto(mm)}`;
  return `${e?.nome ?? ''} · nenhuma notícia confirmada por 2 fontes`;
}
function blocoMercadoNoticias() {
  if (!NOTICIAS.MERCADO) return '';
  const fatos = motivosMercado(), b = etf.BOVA11;
  return `<div class="grafico-bloco" style="margin-bottom:12px"><h3>Por que o mercado se mexeu</h3>
    <div class="tile-sub">Ibovespa ${b ? `<span class="${classeSinal(b.var_dia)}">${pctSinal(b.var_dia)}</span>` : ''} em ${data(D.data_precos)} ·
      motivos citados por ao menos 2 veículos reconhecidos no dia</div>
    ${fatos.length ? `<ul class="fatos">${fatos.map(f => linhaFato(f)).join('')}</ul>` : '<p class="vazio" style="margin:8px 0 0">Nenhum motivo confirmado por 2 fontes até agora.</p>'}</div>
    ${blocoPolitica()}`;
}
// Política e contas públicas dos últimos dias: discurso, anúncio da Fazenda, votação. O que saiu depois do
// fechamento (inclusive no fim de semana) é o que pesa no próximo pregão, então vem marcado.
function blocoPolitica() {
  const lista = NOTICIAS.POLITICA ?? [];
  if (!lista.length) return '';
  const desde = diaUtilAnterior(diaUtilAnterior(D.data_precos));
  const recentes = lista.filter(f => f.d >= desde).sort((a, b) => b.d.localeCompare(a.d) || b.conf - a.conf);
  const fatos = [...recentes.filter(confirmado), ...recentes.filter(f => !confirmado(f))].slice(0, 4)
    .sort((a, b) => b.d.localeCompare(a.d) || b.conf - a.conf);
  if (!fatos.length) return '';
  const depois = f => f.d > D.data_precos ? '<span class="etiqueta etiqueta-movimento" title="Saiu depois do último pregão: pesa na próxima abertura">depois do fechamento</span>' : '';
  return `<div class="grafico-bloco" style="margin-bottom:12px"><h3>Política e contas públicas</h3>
    <div class="tile-sub">Discursos, anúncios da Fazenda e votações que mexem com juros, dólar e bolsa · últimos 3 dias úteis e o fim de semana</div>
    <ul class="fatos">${fatos.map(f => linhaFato(f, depois(f))).join('')}</ul></div>`;
}
function secaoNoticias(e, tk) {
  const fatos = fatosDe(e, tk);
  if (!fatos.length) return '';
  return `<section class="ativo-secao" id="s-noticias"><h3 class="secao">Notícias</h3>
    <div class="grafico-bloco"><div class="tile-sub">Últimos 45 dias, por dia e tema. <b>Confirmado</b>: dois ou mais veículos reconhecidos
      publicaram o mesmo tema no mesmo dia. Uma fonte sozinha fica marcada como não confirmada. Ao lado, a variação da ação no pregão.</div>
    <ul class="fatos">${fatos.map(f => linhaFato(f, `<span class="fato-var" data-dia="${f.d}"></span>`)).join('')}</ul></div></section>`;
}
// Variação da ação no pregão do dia (ou no primeiro pregão depois dele)
function variacaoNoDia(precos, dia) {
  const i = (precos ?? []).findIndex(p => p[0] >= dia);
  return i > 0 ? precos[i][1] / precos[i - 1][1] - 1 : null;
}

// Itens do "Merece atenção", do mais urgente ao menos
function itensAtencao(c) {
  if (!c) return [];
  const itens = [];
  const tem = tk => local.qtd[tk] > 0;
  for (const l of c.acoes ? linhasAcoes(c) : []) {
    const { tk, e, p, g } = l, nome = e?.nome;
    if (g.st.startsWith('↑')) itens.push({ tipo: 'venda', ordem: 1, tk, tkLogo: e?.ticker, rotulo: 'Realizar', titulo: `${tk}: ${g.st.slice(2)}`,
      texto: `Preço R$ ${num(p, 2)}; caro a partir de R$ ${num(g.caro, 2)}${tem(tk) ? ' · você tem' : ''}`, href: `empresa/${tk}` });
    else if (g.st.startsWith('↓')) itens.push({ tipo: 'compra', ordem: 2, tk, tkLogo: e?.ticker, rotulo: 'Em promoção', titulo: `${tk} abaixo do preço normal`,
      texto: `R$ ${num(p, 2)} · normal R$ ${num(g.normal, 2)} (${pctSinal(g.normal / p - 1, 0)}) · ${g.pendente ? 'resultado novo ainda fora da base: conferir' : g.conferir ? 'sinal de piora: conferir' : 'lucro intacto pela regra'}${tem(tk) ? ' · você tem' : ''}`, href: `empresa/${tk}` });
    else if (g.st.startsWith('Barata')) itens.push({ tipo: 'conferir', ordem: 3, tk, tkLogo: e?.ticker, rotulo: 'Conferir', titulo: `${tk} barata, mas com tese em dúvida`,
      texto: g.tese.join('; '), href: `empresa/${tk}` });
    const v = variacao(tk, 1);
    if (ok(v) && Math.abs(v) >= 0.03) itens.push({ tipo: 'movimento', ordem: 4, tk, tkLogo: e?.ticker, rotulo: v > 0 ? 'Alta forte' : 'Queda forte',
      titulo: `${tk} ${pctSinal(v)} hoje`, texto: explicarMovimento(e, tk, v), href: `empresa/${tk}` });
  }
  // Tesouro perto do gatilho de venda e dólar com movimento expressivo
  const g = REGRAS.tesouro_venda;
  for (const t of c.tesouro ?? []) {
    const i = infoTesouro(t);
    if (g && i.taxa && i.taxa <= g.parcial) itens.push({ tipo: 'venda', ordem: 1, rotulo: 'Realizar', titulo: `${t.titulo} ${t.vencimento.slice(0, 4)} no gatilho de venda`,
      texto: `Taxa IPCA + ${num(i.taxa, 2)}%, gatilho em ${num(g.parcial, 1)}%`, href: 'carteiras' });
  }
  const d = D.macro.dolar, r = D.macro.dolar_12m, gd = REGRAS.rebalancear_ivvb;
  if (d && r && gd && d.valor / r.mediana - 1 >= gd.dolar_acima) itens.push({ tipo: 'venda', ordem: 1, tk: 'IVVB11', rotulo: 'Rebalancear',
    titulo: 'Dólar muito acima do normal', texto: `R$ ${num(d.valor, 2)}, ${pctSinal(d.valor / r.mediana - 1, 0)} contra a mediana de 12 meses`, href: 'carteiras' });
  // Classes fora da faixa (só com quantidades preenchidas)
  if (c.faixas) {
    const { valores, investido } = pesosClasses(c);
    const nomes = { tesouro: 'Tesouro longo', global: 'Global', acoes: 'Ações Brasil' };
    if (investido) for (const [k, nome] of Object.entries(nomes)) {
      const [lo, hi] = c.faixas[k] ?? [], f = valores[k] / investido;
      if (f < lo) itens.push({ tipo: 'faixa', ordem: 5, rotulo: 'Aportar', titulo: `${nome} abaixo da faixa`, texto: `${pct(f, 0)} da parte investida; faixa de ${pct(lo, 0)} a ${pct(hi, 0)}`, href: 'carteiras' });
      else if (f > hi && k !== 'global') itens.push({ tipo: 'venda', ordem: 1, rotulo: 'Acima da faixa', titulo: `${nome} acima da faixa`, texto: `${pct(f, 0)} da parte investida; faixa de ${pct(lo, 0)} a ${pct(hi, 0)}`, href: 'carteiras' });
    }
  }
  return itens.sort((a, b) => a.ordem - b.ordem);
}
const itemAtencao = i => `<button class="atencao-item tipo-${i.tipo}" data-ir="${esc(i.href)}">
  <span class="atencao-txt"><b>${esc(i.titulo)}</b><span>${esc(i.texto ?? '')}</span></span>
  <span class="etiqueta etiqueta-${i.tipo}">${esc(i.rotulo)}</span></button>`;

// Resultados de 3 dias atrás até 10 dias à frente
function agendaSemana() {
  const interessa = new Set([...CARTEIRAS.flatMap(c => c.acoes ?? []), ...(AGENDA.acompanhar ?? [])]);
  const hoje = hojeIso(), dia = 864e5;
  return AGENDA.datas.filter(d => interessa.has(d.ticker))
    .map(d => ({ ...d, dias: Math.round((Date.parse(d.data) - Date.parse(hoje)) / dia) }))
    .filter(d => d.dias >= -3 && d.dias <= 10).sort((a, b) => a.data.localeCompare(b.data)).map(d => {
      const e = porTicker.get(d.ticker);
      const quando = d.dias === 0 ? 'Hoje' : d.dias === 1 ? 'Amanhã' : d.dias < 0 ? 'Divulgado' : `Em ${d.dias} dias`;
      const semana = new Date(`${d.data}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      const resumo = d.dias < 0 && e ? resumoTrimestre(e) : null;
      return `<button class="atencao-item" data-ir="empresa/${esc(d.ticker)}">
        <span class="data-bloco"><b>${d.data.slice(8, 10)}</b><span>${esc(semana)}</span></span>
        <span class="atencao-txt"><b>${esc(d.ticker)}${d.quando ? ` · ${esc(d.quando)}` : ''}${d.confirmado ? '' : ' (a confirmar)'}</b>
        <span>${resumo ?? esc(e?.nome ?? '')}${local.qtd[d.ticker] > 0 ? ' · você tem' : ''}</span></span>
        <span class="etiqueta ${d.dias <= 1 && d.dias >= 0 ? 'etiqueta-resultado' : ''}">${quando}</span></button>`;
    }).join('');
}

// Mapa de calor: retângulos proporcionais ao valor (saldo na carteira, valor de mercado na bolsa), cor pela variação do dia
function desenharMapa(el, c) {
  let itens, legenda;
  if (modoMapa === 'carteira' && c) {
    const lista = [...(c.acoes ?? []).map(tk => ({ tk, e: porTicker.get(tk) })), ...(c.etfs ?? []).map(tk => ({ tk, etf: true }))]
      .map(x => ({ ...x, v: variacao(x.tk, 1), valor: (local.qtd[x.tk] ?? 0) * (precoAtual(x.tk) ?? 0) }));
    const comQtd = lista.some(x => x.valor > 0);
    itens = (comQtd ? lista.filter(x => x.valor > 0) : lista.map(x => ({ ...x, valor: 1 })));
    legenda = comQtd ? 'Ações e ETFs da carteira; tamanho = quanto você tem' : 'Ações e ETFs da carteira (preencha as quantidades para o tamanho seguir o saldo)';
  } else {
    itens = D.empresas.filter(e => e.elegivel && ok(e.var_dia) && e.vm > 0).sort((a, b) => b.vm - a.vm).slice(0, 40)
      .map(e => ({ tk: e.ticker, e, v: e.var_dia, valor: e.vm }));
    legenda = 'As 40 maiores empresas da bolsa; tamanho = valor de mercado';
  }
  $('#mapa-legenda').textContent = `${legenda}. Cor: variação de ${rotuloPrecos()}.`;
  itens.sort((a, b) => b.valor - a.valor);
  montarGrafico(el, w => {
    const h = w < 560 ? 300 : 340;
    const total = itens.reduce((s, x) => s + x.valor, 0) || 1;
    const caixas = quadricular(itens.map(x => ({ ...x, area: x.valor / total * w * h })), 0, 0, w, h);
    el.style.height = `${h}px`;
    el.innerHTML = caixas.map(x => {
      const forca = ok(x.v) ? Math.min(1, Math.abs(x.v) / 0.04) : 0;
      const cor = !ok(x.v) || forca < 0.02 ? 'var(--superficie-2)'
        : `color-mix(in srgb, var(${x.v > 0 ? '--mapa-alta' : '--mapa-baixa'}) ${Math.round(18 + 72 * forca)}%, var(--superficie-2))`;
      const cabe = x.w > 54 && x.h > 34, grande = x.w > 110 && x.h > 64;
      return `<button class="mapa-caixa ${forca > 0.45 ? 'forte' : ''}" style="left:${x.x}px;top:${x.y}px;width:${x.w}px;height:${x.h}px;background:${cor}"
        data-ir="${x.etf ? 'etfs' : `empresa/${esc(x.tk)}`}" title="${esc(x.tk)}${x.e ? ' · ' + esc(x.e.nome) : ''}: ${pctSinal(x.v)}">
        ${cabe ? `<b style="font-size:${grande ? '1rem' : '.78rem'}">${esc(x.tk)}</b><span>${pctSinal(x.v)}</span>` : ''}</button>`;
    }).join('');
    for (const b of el.querySelectorAll('[data-ir]')) b.addEventListener('click', () => irPara(b.dataset.ir));
  });
}
// Treemap "squarified": enche faixas ao longo do lado menor enquanto as caixas ficarem mais quadradas
function quadricular(itens, x, y, w, h) {
  const out = [];
  let resto = itens.filter(i => i.area > 0);
  while (resto.length) {
    const lado = Math.min(w, h);
    const pior = l => {
      const s = l.reduce((a, b) => a + b.area, 0), mx = Math.max(...l.map(z => z.area)), mn = Math.min(...l.map(z => z.area));
      return Math.max(lado * lado * mx / (s * s), s * s / (lado * lado * mn));
    };
    const linha = [resto[0]];
    let i = 1;
    while (i < resto.length && pior([...linha, resto[i]]) <= pior(linha)) linha.push(resto[i++]);
    const s = linha.reduce((a, b) => a + b.area, 0);
    if (w >= h) {
      const lw = s / h; let yy = y;
      for (const z of linha) { const zh = z.area / lw; out.push({ ...z, x, y: yy, w: lw, h: zh }); yy += zh; }
      x += lw; w -= lw;
    } else {
      const lh = s / w; let xx = x;
      for (const z of linha) { const zw = z.area / lh; out.push({ ...z, x: xx, y, w: zw, h: lh }); xx += zw; }
      y += lh; h -= lh;
    }
    resto = resto.slice(i);
  }
  return out;
}

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
      de preço sobre lucro (P/L), tanto desde 2020 quanto nos últimos 2 anos, com juro alto como hoje. A nota combina qualidade, saúde e o tamanho do desconto.
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
    ${e.conferir ? `<span class="selos"><span class="selo selo-conferir" title="Motivos para conferir antes de confiar no desconto">⚠ Conferir: ${esc(e.conferir.replaceAll(' | ', ', '))}</span></span>` : ''}
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
// Aceita só números finitos e não negativos e CDBs com os campos conhecidos: o que vem do link ou do
// armazenamento não pode virar HTML na página nem quebrar as contas
const numeroValido = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
function limparDados(d) {
  const numeros = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
    .filter(([k, v]) => typeof k === 'string' && k.length < 80 && numeroValido(v) != null));
  const cdbs = (Array.isArray(d?.cdbs) ? d.cdbs : []).filter(c => c && typeof c === 'object').map(c => ({
    nome: typeof c.nome === 'string' ? c.nome.slice(0, 40) : '',
    valor: numeroValido(c.valor), data: /^\d{4}-\d{2}-\d{2}$/.test(c.data ?? '') ? c.data : '', pct: numeroValido(c.pct) ?? 100,
  }));
  return { qtd: numeros(d?.qtd), cdbs, reserva: numeros(d?.reserva) };
}
function lerLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE_LOCAL));
    if (s && typeof s === 'object') {
      // Antes eram duas carteiras ("dividendos" e "global"); a reserva era da global
      const reserva = s.reserva ?? {};
      if (reserva.global && !reserva.principal) reserva.principal = reserva.global;
      return { ...limparDados({ qtd: s.qtd, cdbs: s.cdbs, reserva }), soTenho: !!s.soTenho };
    }
  } catch { /* sem acesso ao armazenamento: segue sem quantidades */ }
  return { qtd: {}, cdbs: [], reserva: {} };
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
    const d = limparDados(deBase64(codigo));
    // O link traz a carteira inteira de quem gerou: substitui a deste aparelho, depois de confirmar
    const temAlgo = Object.keys(local.qtd).length || local.cdbs.length;
    if (temAlgo && !confirm('Este link substitui as quantidades, os CDBs e a reserva salvos neste aparelho pelos do link. Continuar?')) {
      avisoImportacao = 'Importação cancelada: nada foi alterado.';
    } else {
      local = { ...local, qtd: d.qtd, cdbs: d.cdbs, reserva: d.reserva };
      salvarLocal();
      avisoImportacao = localSalvo ? 'Quantidades importadas e salvas neste aparelho.'
      : 'Quantidades importadas, mas este navegador não deixa salvar: elas somem ao fechar a página.';
    }
  } catch { avisoImportacao = 'O link de importação está incompleto ou corrompido.'; }
  montadas.delete('carteiras');
  history.replaceState(null, '', '#carteiras');
  rota();
}

const CARTEIRAS = D.config?.carteiras ?? [];
const naCarteira = new Set(CARTEIRAS.flatMap(c => (c.acoes ?? []).map(t => porTicker.get(t)?.cnpj)).filter(Boolean));
const serie = tk => D.precos?.[tk] ?? [];
// Códigos fora da carteira (e secundários, como ALUP4) usam o resumo D.tickers: [preço, dia, 12 meses, data]
const precoAtual = tk => serie(tk).at(-1)?.[1] ?? D.tickers?.[tk]?.[0] ?? null;
function variacao(tk, dias) {
  const s = serie(tk);
  if (s.length < 2) return dias === 1 ? D.tickers?.[tk]?.[1] ?? null : dias === 365 ? D.tickers?.[tk]?.[2] ?? null : null;
  // Papel que não negociou no último pregão não variou nesse dia
  if (dias === 1) return s.at(-1)[0] !== D.data_precos ? 0 : s.at(-1)[1] / s.at(-2)[1] - 1;
  const alvo = new Date(Date.parse(s.at(-1)[0]) - dias * 86400000).toISOString().slice(0, 10);
  const ant = s.findLast(p => p[0] <= alvo);
  return ant ? s.at(-1)[1] / ant[1] - 1 : null;
}
const campoQtd = (chave, passo = 1) => `<input class="campo qtd" type="number" min="0" step="${passo}" inputmode="decimal"
  data-chave="${esc(chave)}" value="${esc(local.qtd[chave] ?? '')}" placeholder="0" aria-label="Quantidade de ${esc(chave)}">`;
// Situação de uma ação da carteira: o gatilho pela regra, selos e, embaixo, o que pesa contra a tese
const situacao = l => {
  const { e, g } = l, s = [`<span class="selo">${g.st}</span>`];
  if (e?.oportunidade) s.push('<span class="selo">Oportunidade</span>');
  if (e?.alertas) {
    const n = e.alertas.split(' | ').length;
    s.push(`<span class="selo" title="${esc(e.alertas)}">⚠ ${n} alerta${n > 1 ? 's' : ''}</span>`);
  }
  const obs = [g.ehTrade ? 'ação de trade' : '', ...g.tese].filter(Boolean);
  return `<span class="selos">${s.join('')}</span>${obs.length ? `<span class="tese">${obs.map(esc).join('; ')}</span>` : ''}`;
};

function montarCarteiras(el) {
  el.innerHTML = `
    <h2>Carteira</h2>
    <p class="intro">Todos os ativos que vocês acompanham numa lista só. Cada um preenche as próprias quantidades: elas ficam
      salvas só neste aparelho e nunca vão para o site. Para levar para outro celular, use “Gerar link com minhas quantidades” no fim da página.</p>
    ${avisoImportacao ? `<div class="aviso aviso-info"><div>${esc(avisoImportacao)}</div></div>` : ''}
    ${blocoAgenda()}
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
    const url = `${location.origin}${location.pathname}#importar/${paraBase64({ qtd: local.qtd, cdbs: local.cdbs, reserva: local.reserva })}`;
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
      <div class="carteira-topo">
        <label class="tile-sub"><input type="checkbox" data-so-tenho ${local.soTenho ? 'checked' : ''}> Mostrar só o que tenho</label></div>
      <div class="blocos" id="resumo-${esc(c.id)}"></div>
      <h3 class="secao">Ativos</h3>
      ${c.acoes?.length ? blocoAcoes(c) : ''}
      ${c.etfs?.length ? blocoEtfs(c) : ''}
      ${c.tesouro?.length ? blocoTesouro(c) : ''}
      ${c.cdb ? blocoCdb() : ''}
      <h3 class="secao">Análise</h3>
      ${blocoConcentracao(c)}
      ${blocoGatilhos(c)}
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
  // Títulos: o 1º clique inclui o critério, o 2º inverte, o 3º tira (vários critérios = posição combinada).
  // Texto começa em A→Z; números do maior para o menor, menos desconto e situação (o mais barato primeiro).
  for (const th of corpo.querySelectorAll('th[data-ordem]')) th.addEventListener('click', () => {
    const id = th.closest('.carteira').dataset.id, k = th.dataset.ordem;
    const col = COLUNAS_CARTEIRA.find(c => c.k === k);
    ordemCarteira[id] = alternarCriterio(ordemCarteira[id] ?? [], k, !col.texto && k !== 'situacao' && k !== 'pl');
    desenharCarteiras();
  });
  for (const b of corpo.querySelectorAll('[data-limpar-ordem]')) b.addEventListener('click', () => {
    delete ordemCarteira[b.dataset.limparOrdem];
    desenharCarteiras();
  });
  ligarCdbs();
  for (const i of corpo.querySelectorAll('input[data-so-tenho]')) i.addEventListener('change', () => { local.soTenho = i.checked; salvarLocal(); desenharCarteiras(); });
  for (const i of corpo.querySelectorAll('input[data-reserva]')) i.addEventListener('change', () => {
    const v = Number(i.value);
    if (v > 0) local.reserva[i.dataset.reserva] = v; else delete local.reserva[i.dataset.reserva];
    salvarLocal();
    desenharCarteiras();
  });
  for (const c of CARTEIRAS) for (const t of c.tesouro ?? []) graficoTesouro(t);
}

// Valor, renda estimada e peso de cada ação da carteira
function linhasAcoes(c) {
  return c.acoes.map(tk => {
    const e = porTicker.get(tk), p = precoAtual(tk) ?? e?.preco, q = local.qtd[tk] ?? 0;
    return { tk, e, p, q, saldo: q * (p ?? 0), renda: q * (p ?? 0) * (e?.dy ?? 0), g: gatilhoAcao(tk, e, p) };
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
  { k: 'pl', r: 'P/L × mediana', v: l => ok(l.e?.pl_uso) && ok(l.e?.regua.mediana) ? l.e.pl_uso / l.e.regua.mediana : null, dica: 'P/L de hoje × mediana (a menor entre desde 2020 e últimos 2 anos); ordena pelo desconto' },
  { k: 'normal', r: 'Normal', v: l => ok(l.g.normal) ? l.g.normal / l.p - 1 : null, dica: 'Preço com o P/L mediano (a menor entre desde 2020 e últimos 2 anos), supondo o lucro de hoje; ordena pela distância até ele' },
  { k: 'caro', r: 'Caro', v: l => ok(l.g.caro) ? l.g.caro / l.p - 1 : null, dica: 'Preço com o P/L do percentil 75 (o menor entre desde 2020 e últimos 2 anos), supondo o lucro de hoje' },
  { k: 'nota', r: 'Nota', v: l => l.e?.nota_geral },
  { k: 'situacao', r: 'Situação e tese', esq: true, v: l => l.e?.pl_pct_regua, dica: 'O que a regra manda fazer e o que pesa contra a tese; ordena do mais barato ao mais caro contra o próprio histórico' },
];
const ordemCarteira = {};
const colunaCarteira = k => COLUNAS_CARTEIRA.find(c => c.k === k);
function blocoAcoes(c) {
  const criterios = ordemCarteira[c.id] ?? [];
  const { linhas, combinado } = ordenarPorCriterios(linhasAcoes(c).filter(l => !local.soTenho || l.q > 0), criterios, (l, k) => colunaCarteira(k).v(l), k => colunaCarteira(k).texto);
  const total = linhas.reduce((s, l) => s + l.saldo, 0);
  const aviso = criterios.length ? `<div class="filtros" style="margin:0 0 8px"><span class="contagem" style="margin:0">Ordenando por
    ${esc(descreverCriterios(criterios, k => colunaCarteira(k).r))}${combinado ? ' (posição combinada)' : ''}</span>
    <button class="botao" data-limpar-ordem="${esc(c.id)}">Limpar ordenação</button></div>` : '';
  return `<p class="tile-sub" style="margin:0 0 8px">Normal é o preço em que o P/L volta à mediana; caro, ao percentil 75.
    Vale a régua mais exigente entre desde 2020 e os últimos 2 anos (juro alto como hoje). Os dois supõem o lucro de hoje. A situação segue as regras de config/carteiras.json: elas apontam o momento, a decisão é de vocês.</p>
  ${aviso}<div class="tabela-caixa" style="max-height:none"><table>
    <thead><tr>${COLUNAS_CARTEIRA.map(col => `<th data-ordem="${col.k}" class="${col.esq ? 'esq' : ''}"
      ${col.dica ? `title="${esc(col.dica)}"` : ''} ${criterios[0]?.k === col.k ? `aria-sort="${criterios[0].desc ? 'descending' : 'ascending'}"` : ''}>${col.r}${marcaCriterio(criterios, col.k)}</th>`).join('')}${combinado ? '<th>Combinado</th>' : ''}</tr></thead>
    <tbody>${linhas.map(l => { const { tk, e, p, q, saldo, renda, g } = l; return `<tr data-ticker="${esc(tk)}">
      <td class="esq empresa"><b>${esc(tk)}</b><span class="nome">${esc(e?.nome ?? '')}</span></td>
      <td>${campoQtd(tk)}</td><td>R$ ${num(p, 2)}</td>
      <td class="${classeSinal(variacao(tk, 1))}">${pctSinal(variacao(tk, 1))}</td>
      <td class="${classeSinal(variacao(tk, 365))}">${pctSinal(variacao(tk, 365))}</td>
      <td>${q ? dinheiro(saldo) : '–'}</td><td>${q && total ? pct(saldo / total, 0) : '–'}</td>
      <td>${pct(e?.dy)}</td><td>${q ? dinheiro(renda) : '–'}</td>
      <td>${ok(e?.pl_uso) && ok(e?.regua.mediana) ? `${num(e.pl_uso)}${ok(e.pl_recorrente) ? '<sup title="P/L pelo lucro recorrente, sem ganho não recorrente">rec.</sup>' : ''} <span class="setor">× ${num(e.regua.mediana)}</span>` : '–'}</td>
      <td>${celulaAlvo(g.normal, p)}</td><td>${celulaAlvo(g.caro, p)}</td>
      <td>${medidor(e?.nota_geral)}</td><td class="esq situacao">${situacao(l)}</td>${combinado ? `<td>${medidor(combinado.get(l))}</td>` : ''}</tr>`; }).join('')}</tbody>
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
    <tbody>${c.etfs.filter(tk => !local.soTenho || local.qtd[tk] > 0).map(tk => {
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
      <td><input class="campo" data-campo="valor" type="number" min="0" step="0.01" value="${esc(c.valor ?? '')}" placeholder="R$" style="width:110px" aria-label="Valor aplicado"></td>
      <td><input class="campo" data-campo="data" type="date" value="${esc(c.data ?? '')}" aria-label="Data da aplicação"></td>
      <td><input class="campo" data-campo="pct" type="number" min="0" step="1" value="${esc(c.pct ?? 100)}" style="width:80px" aria-label="Percentual do CDI"></td>
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
  const { saldo, renda, dia, bolsa } = totaisCarteira(c);
  if (!saldo) { el.innerHTML = '<p class="tile-sub" style="margin:0">Preencha as quantidades para ver o saldo e a renda estimada.</p>'; return; }
  el.innerHTML = `<div class="resumo-coluna"><div class="bloco"><h3>Saldo estimado</h3><div class="tile-valor">${dinheiro(saldo)}</div>
      <div class="tile-sub">Pelos preços de ${rotuloPrecos()}</div></div>
    ${bolsa ? `<div class="bloco"><h3>Hoje</h3><div class="tile-valor ${classeSinal(dia)}">${dia >= 0 ? '+' : '−'}${dinheiro(Math.abs(dia))}</div>
      <div class="tile-sub"><span class="${classeSinal(dia)}">${pctSinal(dia / (bolsa - dia))}</span> em ações e ETFs</div></div>` : ''}
    ${c.acoes ? `<div class="bloco"><h3>Renda anual estimada</h3><div class="tile-valor">${dinheiro(renda)}</div>
      <div class="tile-sub">${pct(renda / saldo)} sobre o saldo, pelos dividendos dos últimos 12 meses</div></div>` : ''}</div>
    <div class="bloco bloco-rosca"><h3>Onde está o dinheiro</h3>${rosca(itensConcentracao(c).itens)}</div>`;
}

// Rosca com as maiores fatias; o que passar de 6 vira "Outros"
function rosca(itens) {
  const fatias = itens.slice(0, 6).map((i, k) => ({ nome: i.nome, fatia: i.fatia, valor: i.valor, cor: `var(--serie-${k + 1})` }));
  const resto = itens.slice(6);
  if (resto.length) fatias.push({ nome: 'Outros', fatia: resto.reduce((s, i) => s + i.fatia, 0), valor: resto.reduce((s, i) => s + i.valor, 0), cor: 'var(--texto-3)' });
  const R = 42, C = 2 * Math.PI * R;
  let acum = 0;
  const arcos = fatias.map(f => {
    const tam = Math.max(0, f.fatia * C - (fatias.length > 1 ? 1.5 : 0));
    const arco = `<circle r="${R}" cx="50" cy="50" fill="none" stroke="${f.cor}" stroke-width="14"
      stroke-dasharray="${tam} ${C - tam}" stroke-dashoffset="${-acum}" transform="rotate(-90 50 50)"><title>${esc(f.nome)}: ${pct(f.fatia, 0)}</title></circle>`;
    acum += f.fatia * C;
    return arco;
  }).join('');
  return `<div class="rosca"><svg viewBox="0 0 100 100" role="img" aria-label="Distribuição do saldo">${arcos}</svg>
    <ul class="rosca-legenda">${fatias.map(f => `<li><i style="background:${f.cor}"></i><span>${esc(f.nome)}</span><b>${pct(f.fatia, 0)}</b></li>`).join('')}</ul></div>`;
}

// ---------- Agenda de resultados ----------
// Datas em config/carteiras.json (agenda_resultados). A CVM só atualiza os arquivos abertos aos
// domingos: o resultado divulgado na semana entra na base no domingo seguinte.
const AGENDA = D.config?.agenda_resultados ?? { datas: [] };
const rotuloTrimestre = dtRefer => `${Math.ceil(Number(dtRefer.slice(5, 7)) / 3)}T${dtRefer.slice(2, 4)}`;
const fimDoTrimestre = rotulo => { // "3T26" -> "2026-09-30"
  const m = /^(\d)T(\d\d)$/.exec(rotulo ?? '');
  return m ? `20${m[2]}-${['03-31', '06-30', '09-30', '12-31'][m[1] - 1]}` : null;
};
const hojeIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const entradaAgenda = e => AGENDA.datas.find(d => e.tickers.split(' ').includes(d.ticker));

function proximoResultado(e) {
  const a = entradaAgenda(e);
  if (!a || a.data < hojeIso()) return '';
  return `<span class="selo">Resultado ${esc(AGENDA.trimestre ?? '')}: ${data(a.data)}${a.quando ? ' ' + esc(a.quando) : ''}${a.confirmado ? '' : ' (a confirmar)'}</span>`;
}

// Lucro do trimestre da temporada contra o mesmo trimestre do ano anterior e o anterior
function resumoTrimestre(e) {
  const fim = fimDoTrimestre(AGENDA.trimestre);
  const tri = D.trimestres?.[e.cnpj] ?? [];
  const i = tri.findIndex(t => t[0] === fim);
  if (i < 0) return null;
  const atual = tri[i][1];
  const anoAntes = tri.find(t => t[0] === `${Number(fim.slice(0, 4)) - 1}${fim.slice(4)}`)?.[1];
  const anterior = tri[i - 1]?.[1];
  const varia = (a, b) => ok(a) && ok(b) && b > 0 ? pctSinal(a / b - 1, 0) : '–';
  return `Lucro ${AGENDA.trimestre}: <b>${dinheiro(atual)}</b> · contra um ano antes ${varia(atual, anoAntes)} · contra o trimestre anterior ${varia(atual, anterior)}`;
}

function blocoAgenda() {
  if (!AGENDA.datas.length) return '';
  const naCart = new Map();
  for (const c of CARTEIRAS) for (const tk of c.acoes ?? []) naCart.set(tk, [...(naCart.get(tk) ?? []), c.nome]);
  const interessa = new Set([...naCart.keys(), ...(AGENDA.acompanhar ?? [])]);
  const hoje = hojeIso();
  const linhas = AGENDA.datas.filter(d => interessa.has(d.ticker)).sort((a, b) => a.data.localeCompare(b.data)).map(d => {
    const e = porTicker.get(d.ticker);
    const dias = Math.round((Date.parse(d.data) - Date.parse(hoje)) / 864e5);
    const resumo = e ? resumoTrimestre(e) : null;
    const situacao = resumo ?? (dias > 0 ? `em ${dias} dia${dias > 1 ? 's' : ''}` : dias === 0 ? '<b>hoje</b>'
      : 'divulgado; os números entram na base no domingo seguinte (a CVM atualiza os arquivos aos domingos)');
    const onde = local.qtd[d.ticker] > 0 ? 'você tem' : naCart.has(d.ticker) ? 'na lista da carteira' : 'acompanhando';
    return `<tr data-ticker="${esc(d.ticker)}"><td class="esq">${data(d.data)}${d.confirmado ? '' : ' <span class="setor">(a confirmar)</span>'}</td>
      <td class="esq"><b>${esc(d.ticker)}</b><span class="nome">${esc(onde)}</span></td><td class="esq">${esc(d.quando || '–')}</td>
      <td class="esq" style="white-space:normal">${situacao}</td></tr>`;
  }).join('');
  const proximo = AGENDA.datas.filter(d => interessa.has(d.ticker) && d.data >= hoje).sort((a, b) => a.data.localeCompare(b.data))[0];
  const titulo = `Agenda de resultados ${esc(AGENDA.trimestre ?? '')}${proximo ? ` · próximo: ${esc(proximo.ticker)} em ${data(proximo.data)}` : ''}`;
  return `<details class="grafico-bloco agenda" style="margin-bottom:12px"><summary><h3>${titulo}</h3></summary>
    <div class="tile-sub">Datas de calendários de mercado; "a confirmar" quando as fontes divergem. No dia, o preço reage na hora; os números do balanço entram na base no domingo seguinte.</div>
    <div style="overflow-x:auto"><table><thead><tr><th class="esq">Data</th><th class="esq">Empresa</th><th class="esq">Quando</th><th class="esq">Situação</th></tr></thead>
    <tbody>${linhas}</tbody></table></div></details>`;
}

// ---------- Gatilhos de compra e venda ----------
// Regras de config/carteiras.json: faixas por classe, taxa de venda do Tesouro, P/L de saída e
// sinais de tese quebrada. Só aponta; quem decide é a pessoa.
const REGRAS = D.config?.regras ?? {};
const selo = t => `<span class="selo">${t}</span>`;
function blocoGatilhos(c) {
  const partes = [];
  if (c.faixas) partes.push(gatilhosFaixas(c));
  for (const t of c.tesouro ?? []) partes.push(gatilhoTesouro(t));
  if (c.etfs?.includes('IVVB11')) partes.push(gatilhoDolar(c));
  const corpo = partes.filter(Boolean).join('');
  return corpo ? `<div class="grafico-bloco" style="margin-bottom:12px"><h3>Gatilhos de compra e venda</h3>
    <div class="tile-sub">Regras que vocês definiram (config/carteiras.json). Elas apontam o momento; a decisão é de vocês.</div>${corpo}</div>` : '';
}

// Valor de cada classe na parte investida (o CDB até a reserva fica de fora)
function pesosClasses(c) {
  const reserva = local.reserva?.[c.id] ?? 0;
  const v = { tesouro: 0, global: 0, acoes: 0, cdb: 0 };
  for (const t of c.tesouro ?? []) v.tesouro += (local.qtd[`TD:${chaveTesouro(t)}`] ?? 0) * (infoTesouro(t).pu ?? 0);
  for (const tk of c.etfs ?? []) v.global += (local.qtd[tk] ?? 0) * (precoAtual(tk) ?? 0);
  if (c.acoes) for (const l of linhasAcoes(c)) v.acoes += l.saldo;
  if (c.cdb) for (const cdb of local.cdbs) if (cdb.valor && cdb.data) v.cdb += calcularCdb(cdb).bruto;
  const valores = { tesouro: v.tesouro, global: v.global, acoes: v.acoes, municao: Math.max(0, v.cdb - reserva) };
  return { reserva, valores, investido: Object.values(valores).reduce((s, x) => s + x, 0) };
}

function gatilhosFaixas(c) {
  const { reserva, valores, investido } = pesosClasses(c);
  const campo = `<label class="tile-sub" style="display:flex;gap:8px;align-items:center;margin:8px 0">Reserva de emergência (fica fora das faixas):
    <input class="campo" type="number" min="0" step="100" data-reserva="${esc(c.id)}" value="${esc(reserva || '')}" placeholder="ex.: 10000" style="width:120px"></label>`;
  if (!investido) return campo;
  const nomes = { tesouro: 'Tesouro longo', global: 'Global (IVVB11 e WRLD11)', acoes: 'Ações Brasil', municao: 'Munição (CDB além da reserva)' };
  const notaMunicao = c.faixas.municao?.[0] === 0 ? '<p class="tile-sub" style="margin:6px 0 0">A munição pode ficar perto de zero depois de uma compra: os aportes mensais repõem o caixa para a próxima queda.</p>' : '';
  const linhas = Object.entries(nomes).map(([k, nome]) => {
    const [lo, hi] = c.faixas[k] ?? [];
    const f = valores[k] / investido;
    // Munição funciona ao contrário: acima da faixa é caixa sobrando para usar nas classes abaixo
    // Munição funciona ao contrário; o IVVB11 só vira "realizar" com movimento expressivo (gatilho do dólar)
    const st = !ok(lo) ? '' : k === 'municao'
      ? (f > hi ? selo('↑ Caixa sobrando: usar nas classes abaixo da faixa') : f < lo ? selo('↓ Pouca munição: recompor antes de comprar') : selo('Dentro da faixa'))
      : f < lo ? selo('↓ Abaixo: direcionar aportes e dividendos para cá')
      : f > hi ? selo(k === 'global' ? '↑ Acima: parar de aportar (vender só com movimento expressivo)' : '↑ Acima: realizar parte ou parar de aportar')
      : selo('Dentro da faixa');
    return `<tr style="cursor:default"><td class="esq">${nome}</td><td>${dinheiro(valores[k])}</td><td><b>${pct(f, 0)}</b></td>
      <td>${ok(lo) ? `${pct(lo, 0)}–${pct(hi, 0)}` : '–'}</td><td class="esq">${st}</td></tr>`;
  }).join('');
  return `<h3 style="margin-top:12px">Peso de cada classe</h3>${campo}
    ${reserva ? '' : '<p class="tile-sub" style="margin:0 0 6px">Sem a reserva informada, todo o CDB conta como munição.</p>'}
    <div style="overflow-x:auto"><table><thead><tr><th class="esq">Classe</th><th>Valor</th><th>Peso</th><th>Faixa</th><th class="esq">Situação</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>${notaMunicao}`;
}

// Quanto o título ganha (além do IPCA) se a taxa cair até o gatilho
function gatilhoTesouro(t) {
  const i = infoTesouro(t), g = REGRAS.tesouro_venda;
  if (!i.ult || !g) return '';
  const anos = (Date.parse(t.vencimento) - Date.parse(i.ult[0])) / 864e5 / 365.25;
  const ganho = alvo => ((1 + i.taxa / 100) / (1 + alvo / 100)) ** anos - 1;
  const st = i.taxa <= g.total ? selo(`↑ Gatilho de venda forte (taxa ≤ ${num(g.total, 1)}%)`)
    : i.taxa <= g.parcial ? selo(`↑ Gatilho de venda parcial (taxa ≤ ${num(g.parcial, 1)}%)`) : selo('Segurar');
  return `<h3 style="margin-top:12px">${esc(t.titulo)} ${t.vencimento.slice(0, 4)}</h3>
    <p class="tile-sub" style="margin:0">${st} Taxa hoje IPCA + ${num(i.taxa, 2)}%. Venda parcial a ${num(g.parcial, 1)}%
      (preço +${pct(ganho(g.parcial), 0)} além do IPCA) e forte a ${num(g.total, 1)}% (+${pct(ganho(g.total), 0)}).
      Só vale vender se houver ativo barato para onde levar o dinheiro; o ganho paga IR.</p>`;
}

// Vender IVVB11 para comprar Brasil só com movimento expressivo: dólar muito acima da mediana de
// 12 meses ou peso do IVVB11 bem acima da faixa. Abaixo disso, o caixa novo resolve sem pagar IR.
function gatilhoDolar(c) {
  const d = D.macro.dolar, r = D.macro.dolar_12m, g = REGRAS.rebalancear_ivvb ?? { dolar_acima: 0.15, peso_acima_da_faixa: 0.05 };
  if (!d || !r) return '';
  const acima = d.valor / r.mediana - 1;
  const { valores, investido } = pesosClasses(c);
  const peso = investido ? valores.global / investido : null, topo = c.faixas?.global?.[1];
  const dolarExpressivo = acima >= g.dolar_acima;
  const pesoExpressivo = ok(peso) && ok(topo) && peso >= topo + g.peso_acima_da_faixa;
  const st = dolarExpressivo || pesoExpressivo ? selo('↑ Movimento expressivo: rebalancear')
    : acima > 0.05 ? selo('Dólar alto, mas abaixo do gatilho') : selo('Dólar no normal');
  return `<h3 style="margin-top:12px">IVVB11 e dólar</h3>
    <p class="tile-sub" style="margin:0">${st} Dólar a R$ ${num(d.valor, 2)}, ${pctSinal(acima, 0)} contra a mediana de 12 meses
      (R$ ${num(r.mediana, 2)}; faixa R$ ${num(r.min, 2)}–${num(r.max, 2)}).
      Gatilho: dólar ${pct(g.dolar_acima, 0)} acima da mediana (R$ ${num(r.mediana * (1 + g.dolar_acima), 2)})${ok(topo) ? ` ou IVVB11 acima de ${pct(topo + g.peso_acima_da_faixa, 0)} da parte investida${ok(peso) ? ` (hoje ${pct(peso, 0)})` : ''}` : ''}.
      ${dolarExpressivo || pesoExpressivo ? 'Vender o excesso do IVVB11 e comprar o que caiu é "vender na alta e comprar na queda" num movimento só (ETF paga 15% de IR sobre o lucro).' : 'Até lá, aportes novos resolvem sem pagar IR.'}</p>`;
}

// Gatilho de uma ação da carteira: preços "normal" (P/L mediano) e "caro" (percentil 75) pela régua
// mais exigente entre desde 2020 e últimos 2 anos (reguaPl),
// supondo o lucro de hoje, o que fazer pela regra e o que pode estar quebrando a tese.
function gatilhoAcao(tk, e, p) {
  const pisos = REGRAS.roe_minimo ?? {}, ehTrade = (REGRAS.trade ?? []).includes(tk);
  if (!e || !ok(e.pl) || e.pl <= 0 || !ok(p)) return { st: 'Sem lucro positivo: sem faixa de P/L', tese: [], ehTrade };
  // P/L muito acima do próprio "caro" quase sempre é lucro que despencou (prejuízo pontual), não preço alto
  if (ok(e.pl_p75) && e.pl > 2 * e.pl_p75) return { st: 'P/L distorcido: o lucro de 12 meses despencou', ehTrade,
    tese: [`P/L ${num(e.pl)} contra ${num(e.pl_p75)} no caro histórico; a regra de preço não serve até o lucro normalizar`] };
  const plU = e.pl_uso;
  const alvo = x => ok(x) ? p * x / plU : null;
  const piso = pisos[e.setor] ?? pisos.padrao;
  const tese = [];
  if (ok(piso) && ok(e.roe) && e.roe < piso) tese.push(`ROE ${pct(e.roe, 0)} abaixo do piso de ${pct(piso, 0)}`);
  if (ok(e.dy_3a) && ok(e.dy) && e.dy < 0.5 * e.dy_3a) tese.push('dividendo caiu à metade do normal');
  if (e.payout > 1) tese.push(`pagou mais do que lucrou (payout ${pct(e.payout, 0)}): conte com dividendo menor`);
  if (e.lucro_suspeito) tese.push('lucro com sinal de não recorrente');
  // Proteções calculadas para todas as empresas (src/calcular.js, campo conferir): resultado novo fora
  // da base, lucro do trimestre despencando, dividendo extraordinário e queda forte de preço
  const motivos = (e.conferir ?? '').split(' | ').filter(Boolean);
  const pendente = resultadoForaDaBase(e);
  if (pendente) tese.push(pendente);
  if (motivos.includes('lucro do último trimestre caiu')) tese.push(`lucro do último trimestre ${pctSinal(e.lucro_tri_var, 0)} contra um ano antes: os 12 meses ainda não mostram toda a piora`);
  if (motivos.includes('dividendo extraordinário')) tese.push(`dividendo de 12 meses (${pct(e.dy, 0)}) bem acima do normal (${pct(e.dy_mediana, 0)}): inclui pagamento extraordinário, não conte com ele`);
  if (motivos.includes('efeito fiscal no lucro')) tese.push(`lucro do último trimestre inflado por imposto baixo (alíquota ${pct(e.aliquota_tri, 0)} contra ${pct(e.aliquota_media, 0)} normal): o recorrente é menor`);
  if (motivos.includes('ganho não recorrente no lucro')) tese.push(`lucro de 12 meses tem ${dinheiro(e.ganho_nao_recorrente)} de ganho não recorrente: pelo recorrente o P/L é ${num(e.pl_recorrente)}, não ${num(e.pl)}`);
  if (motivos.includes('imprensa cita não recorrente')) tese.push('a imprensa cita ganho não recorrente no último resultado: confira se o lucro de 12 meses está inflado');
  if (motivos.includes('queda forte do preço')) tese.push(`caiu ${pct(-e.queda_3m, 0)} em 3 meses (Ibovespa ${pctSinal(e.queda_3m_ibov, 0)}): o mercado pode estar antecipando lucro menor`);
  const conferirAntes = !!pendente || motivos.some(m => m !== 'dividendo extraordinário');
  const quebrada = tese.some(t => t.startsWith('ROE') || t.startsWith('dividendo caiu'));
  let st;
  const r = e.regua;
  if (plU >= r.p75) st = ehTrade ? '↑ Cara: realizar o restante' : (e.dy < (e.dy_mediana ?? 0) ? '↑ Cara e com dividendo abaixo do normal: reduzir' : '↑ Cara: parar de aportar');
  else if (plU >= r.mediana) st = ehTrade ? '↑ No normal: realizar metade' : 'No normal: segurar';
  else if (plU <= r.p25) st = quebrada ? 'Barata, mas com tese em dúvida: conferir antes'
    : pendente ? '↓ Em promoção, mas falta o resultado novo: conferir antes'
    : conferirAntes ? '↓ Em promoção, mas com sinal de piora: conferir antes' : '↓ Em promoção com lucro intacto';
  else st = 'Abaixo do normal: segurar';
  return { normal: alvo(r.mediana), caro: alvo(r.p75), st, tese, ehTrade, pendente: !!pendente, conferir: conferirAntes };
}
// Ganho não recorrente que o balanço não separa (lista curada em config/lucro-recorrente.json): os itens,
// o lucro recorrente e o P/L por ele, com link para a fonte de cada número
function avisoNaoRecorrente(e) {
  if (!ok(e.ganho_nao_recorrente)) return '';
  let itens = [];
  try { itens = JSON.parse(e.ganho_nao_recorrente_itens ?? '[]'); } catch { /* campo malformado: só o total */ }
  return `<div class="aviso">${ICONE_ALERTA}<div><strong>Lucro inflado por ganho não recorrente:</strong> dos ${dinheiro(e.lucro_12m)} de lucro em 12 meses,
    cerca de ${dinheiro(e.ganho_nao_recorrente)} (depois de IR) não se repetem. Pelo lucro recorrente de ~${dinheiro(e.lucro_normalizado)}, o P/L é
    <b>${num(e.pl_recorrente)}</b>, não ${num(e.pl)}: é ele que vale contra o histórico, nas notas e na oportunidade.
    ${itens.length ? `<ul style="margin:6px 0 0 18px;padding:0">${itens.map(i => `<li>${esc(i.tri)}: ${esc(i.descricao)}, ${dinheiro(i.valor)}${i.estimativa ? ' (estimado)' : ''}${i.fonte ? ` · <a href="${esc(i.fonte)}" target="_blank" rel="noopener">fonte</a>` : ''}</li>`).join('')}</ul>` : ''}</div></div>`;
}
// Alertas da ficha sem repetir o do ganho não recorrente, que já tem aviso próprio com os itens
const alertasFicha = e => !ok(e.ganho_nao_recorrente) ? e.alertas
  : (e.alertas ?? '').split(' | ').filter(a => !a.includes('inclui ganhos não recorrentes')).join(' | ');
// Texto de aviso quando o resultado da temporada já saiu (pela agenda) e ainda não está na base
function resultadoForaDaBase(e) {
  // Pela entrega à CVM (vale para todas as empresas); a agenda manual cobre se a consulta falhar
  if (e?.resultado_pendente) {
    const [tri, dt] = e.resultado_pendente.split('|');
    return `resultado do ${tri} entregue à CVM em ${data(dt).slice(0, 5)} e só entra na base no domingo: lucro, P/L e preço normal ainda são do trimestre anterior`;
  }
  const a = e && entradaAgenda(e), hoje = hojeIso();
  if (!a || resumoTrimestre(e)) return null;
  const saiu = a.data < hoje || (a.data === hoje && /antes/.test(a.quando ?? ''));
  return saiu ? `resultado do ${AGENDA.trimestre} saiu em ${data(a.data).slice(0, 5)} e só entra na base no domingo: lucro, P/L e preço normal ainda são do trimestre anterior` : null;
}
// Preço-alvo com a distância do preço de hoje
const celulaAlvo = (alvo, p) => ok(alvo) ? `R$ ${num(alvo, 2)}<span class="nome" style="display:block">${Math.abs(alvo / p - 1) < 0.005 ? 'no preço' : pctSinal(alvo / p - 1, 0)}</span>` : '–';

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
// Aviso ao lado do ticker: lucro fora do normal (as notas já usam o lucro normalizado) ou motivo para conferir
function avisoRanking(e) {
  const motivos = [e.lucro_suspeito && 'Lucro de 12 meses fora do normal: as notas usam um lucro normalizado', e.conferir && `Conferir antes: ${e.conferir}`].filter(Boolean);
  return motivos.length ? ` <span class="aviso-ranking" title="${esc(motivos.join('. '))}">${ICONE_ALERTA.replace('icone-alerta', 'icone-alerta icone-mini')}</span>` : '';
}
const COLUNAS = [
  { k: 'ticker', r: 'Empresa', esq: true, f: (v, e) => `<b>${esc(e.ticker)}</b>${avisoRanking(e)}<span class="nome">${esc(e.nome)}</span>`, cls: 'empresa', texto: true },
  { k: 'setor', r: 'Setor', esq: true, f: v => esc(v), texto: true },
  { k: 'nota_geral', r: 'Nota', f: medidor, maior: 1, dica: 'Média das quatro notas' },
  { k: 'nota_qualidade', r: 'Qualid.', f: medidor, maior: 1, dica: 'ROE, ROIC, margem contra o setor, anos com lucro' },
  { k: 'nota_preco', r: 'Preço', f: medidor, maior: 1, dica: 'Lucro/preço, EBIT/EV, P/VP e desconto contra o próprio histórico' },
  { k: 'nota_saude', r: 'Saúde', f: medidor, maior: 1, nf: true, dica: 'Dívida líquida/EBITDA, liquidez corrente, dívida/PL' },
  { k: 'nota_crescimento', r: 'Cresc.', f: medidor, maior: 1, dica: 'Crescimento anual de receita e lucro em 5 anos' },
  { k: 'pl', r: 'P/L', f: v => num(v), maior: 0 },
  { k: 'pvp', r: 'P/VP', f: v => num(v, 2), maior: 0 },
  { k: 'ev_ebitda', r: 'EV/EBITDA', f: v => num(v), maior: 0, nf: true },
  { k: 'dy', r: 'Div. 12m', f: v => pct(v), maior: 1, dica: 'Dividendos e JCP por ação com data com nos últimos 12 meses, sobre o preço (dados da B3)' },
  { k: 'roe', r: 'ROE', f: v => pct(v), maior: 1 },
  { k: 'roic', r: 'ROIC', f: v => pct(v), maior: 1, nf: true },
  { k: 'margem_liq', r: 'Marg. líq.', f: v => pct(v), maior: 1, nf: true },
  { k: 'div_liq_ebitda', r: 'Dív./EBITDA', f: v => v >= 99 ? '<span title="EBITDA negativo">n/a</span>' : num(v), maior: 0, nf: true },
  { k: 'cagr_lucro_5a', r: 'Lucro 5a', f: v => pct(v), maior: 1, dica: 'Crescimento anual do lucro em 5 anos' },
  { k: 'pl_pct_regua', r: 'P/L × hist.', f: v => ok(v) ? `${num(v, 0)}%` : '–', maior: 0, dica: 'Em quantos % dos meses o P/L foi MENOR que hoje (baixo = barato contra o próprio histórico). Vale o maior entre desde 2020 e os últimos 2 anos: só é barata se for barata contra os dois' },
  { k: 'liquidez', r: 'Liquidez/dia', f: v => dinheiro(v), maior: 1 },
  { k: 'selos', r: 'Selos', esq: true, f: (v, e) => selos(e), semOrdem: true },
];
const estadoRanking = { soFinanceiras: false, busca: '', setor: '', liquidez: 1e6, grandes: true, perenes: false, oport: false, graham: false, bazin: false, magica: false, foraRanking: false, ordens: [{ k: 'nota_geral', desc: true, invertido: false }] };

function montarRanking(el) {
  const setores = [...new Set(D.empresas.map(e => e.setor))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  el.innerHTML = `
    <h2>Ranking</h2>
    <p class="intro">Ranking geral, com todas as empresas juntas. As notas de 0 a 100 comparam cada empresa com as do mesmo tipo:
      bancos e seguradoras têm régua própria (sem EBITDA, dívida líquida nem nota de saúde), e a nota geral deles é a média
      das outras três. Clique numa linha para abrir a ficha.</p>
    <p class="tile-sub" style="margin:-8px 0 12px">Ordenar: clique em um ou mais títulos. O 1º clique inclui o critério, o 2º inverte, o 3º tira. Com dois ou mais, a lista sobe quem vai bem em todos ao mesmo tempo (coluna Combinado).</p>
    <div class="filtros">
      <input type="search" id="r-busca" placeholder="Buscar ticker ou nome" aria-label="Buscar">
      <select id="r-setor" aria-label="Setor"><option value="">Todos os setores</option>${setores.map(s => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="r-liq" aria-label="Liquidez mínima">
        <option value="0">Qualquer liquidez</option><option value="1000000" selected>Liquidez ≥ R$ 1 mi/dia</option>
        <option value="10000000">≥ R$ 10 mi/dia</option><option value="50000000">≥ R$ 50 mi/dia</option>
      </select>
      <label title="Valor de mercado mínimo da visão de foco (bancos e seguradoras têm corte maior)"><input type="checkbox" id="r-grandes" checked> Só empresas grandes</label>
      <label title="Bancos, seguros, energia, saneamento e telecom"><input type="checkbox" id="r-perenes"> Só setores perenes</label>
      <label title="Só bancos, seguradoras e holdings financeiras, com as colunas que fazem sentido para eles"><input type="checkbox" id="r-fin"> Só bancos e seguradoras</label>
      <label><input type="checkbox" id="r-oport"> Só oportunidades</label>
      <label><input type="checkbox" id="r-graham"> Graham</label>
      <label><input type="checkbox" id="r-bazin"> Bazin</label>
      <label><input type="checkbox" id="r-magica"> Fórmula Mágica</label>
      <label title="Empresas com pouca liquidez ou balanço atrasado não recebem nota"><input type="checkbox" id="r-fora"> Incluir sem nota</label>
      <span class="contagem" id="r-contagem"></span>
    </div>
    <div class="filtros" id="r-ordem"></div>
    <div class="tabela-caixa"><table id="r-tabela"><thead></thead><tbody></tbody></table></div>`;
  const s = estadoRanking;
  $('#r-busca').addEventListener('input', ev => { s.busca = ev.target.value.trim().toUpperCase(); desenharRanking(); });
  $('#r-setor').addEventListener('change', ev => { s.setor = ev.target.value; desenharRanking(); });
  $('#r-liq').addEventListener('change', ev => { s.liquidez = Number(ev.target.value); desenharRanking(); });
  for (const [id, k] of [['r-grandes', 'grandes'], ['r-perenes', 'perenes'], ['r-fin', 'soFinanceiras'], ['r-oport', 'oport'], ['r-graham', 'graham'], ['r-bazin', 'bazin'], ['r-magica', 'magica'], ['r-fora', 'foraRanking']]) {
    // Volta à aba com as caixas como estavam
    $(`#${id}`).checked = !!s[k];
    $(`#${id}`).addEventListener('change', ev => { s[k] = ev.target.checked; desenharRanking(); });
  }
  $('#r-tabela tbody').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-ticker]'); if (tr) irPara(`empresa/${tr.dataset.ticker}`); });
  $('#r-ordem').addEventListener('click', ev => { if (ev.target.closest('#r-limpar')) { s.ordens = [{ k: 'nota_geral', desc: true, invertido: false }]; desenharRanking(); } });
  $('#r-tabela tbody').addEventListener('keydown', ev => { const tr = ev.target.closest('tr[data-ticker]'); if (tr && ev.key === 'Enter') irPara(`empresa/${tr.dataset.ticker}`); });
  $('#r-tabela thead').addEventListener('click', ev => {
    const th = ev.target.closest('th[data-k]');
    if (!th) return;
    const col = COLUNAS.find(c => c.k === th.dataset.k);
    if (col.semOrdem) return;
    s.ordens = alternarCriterio(s.ordens, col.k, col.texto ? false : col.maior !== 0);
    desenharRanking();
  });
  desenharRanking();
}
function desenharRanking() {
  const s = estadoRanking, fin = s.soFinanceiras;
  const cols = COLUNAS.filter(c => !(fin && c.nf));
  const linhas = D.empresas.filter(e => (!fin || e.financeira)
    && (s.foraRanking || e.elegivel)
    && (e.liquidez ?? 0) >= s.liquidez
    && (!s.grandes || grande(e)) && (!s.perenes || perene(e))
    && (!s.setor || e.setor === s.setor)
    && (!s.busca || e.tickers.includes(s.busca) || e.nome.toUpperCase().includes(s.busca))
    && (!s.oport || e.oportunidade) && (!s.graham || e.selo_graham) && (!s.bazin || e.selo_bazin) && (!s.magica || e.selo_magica));
  // Critérios de colunas escondidas neste grupo (ex.: EV/EBITDA em bancos) não contam
  const criterios = s.ordens.filter(o => cols.some(c => c.k === o.k));
  const { linhas: ordenadas, combinado } = ordenarPorCriterios(linhas, criterios, (e, k) => e[k], k => COLUNAS.find(c => c.k === k)?.texto);
  const rotulo = k => COLUNAS.find(c => c.k === k)?.r ?? k;
  $('#r-ordem').innerHTML = criterios.length
    ? `<span class="contagem" style="margin:0">Ordenando por ${esc(descreverCriterios(criterios, rotulo))}${combinado ? ' (posição combinada)' : ''}</span>
       <button class="botao" id="r-limpar">Limpar ordenação</button>` : '<span class="contagem" style="margin:0">Sem ordenação: clique nos títulos.</span>';
  const thCombinado = combinado ? '<th title="Média da posição (0 a 100) da empresa em cada critério escolhido">Combinado</th>' : '';
  $('#r-tabela thead').innerHTML = `<tr>${cols.map((c, i) => `<th data-k="${c.k}" class="${c.esq ? 'esq' : ''}" ${c.dica ? `title="${esc(c.dica)}"` : ''}
    ${criterios[0]?.k === c.k ? `aria-sort="${criterios[0].desc ? 'descending' : 'ascending'}"` : ''}>${c.r}${marcaCriterio(criterios, c.k)}</th>${i === 0 ? thCombinado : ''}`).join('')}</tr>`;
  $('#r-tabela tbody').innerHTML = ordenadas.map(e => `<tr data-ticker="${esc(e.ticker)}" tabindex="0">${cols.map((c, i) =>
    `<td class="${c.cls ?? ''} ${c.esq ? 'esq' : ''}">${c.f(e[c.k], e)}</td>${i === 0 && combinado ? `<td>${medidor(combinado.get(e))}</td>` : ''}`).join('')}</tr>`).join('')
    || `<tr><td colspan="${cols.length + (combinado ? 1 : 0)}" class="vazio">Nenhuma empresa com esses filtros.</td></tr>`;
  $('#r-contagem').textContent = `${linhas.length} empresas`;
}

// ---------- Ficha da empresa ----------
// Página própria de cada ação, no formato das plataformas de análise: cabeçalho com preço e números-chave,
// menu de seções e, numa página só, cotação, indicadores (com explicação), dividendos, dados contábeis,
// comparação com o setor e simulador. Cotação diária e proventos vêm de ativos/TICKER.json, lido na hora.
// ---------- Termômetro do trimestre ----------
// Dados públicos do setor que saem antes do balanço (src/termometro.js): Susep para seguradoras,
// Anatel para operadoras, ONS para elétricas. Mostram a direção do próximo resultado, não o número.
const TERMO = D.termometro;
const ehEletrica = e => /energia el[ée]trica/i.test(e?.setor ?? '');
function chaveTermometro(e, tk) {
  if (!TERMO || !e) return null;
  for (const t of [tk, ...e.tickers.split(' ')]) {
    const k = t && TERMO.porCodigo?.[t.slice(0, 4)];
    if (k && TERMO.sinais[k]) return k;
  }
  return ehEletrica(e) && TERMO.sinais[TERMO.energia] ? TERMO.energia : null;
}
const valorTermo = i => i.formato === 'dinheiro' ? dinheiro(i.valor) : i.formato === 'pct' ? pct(i.valor)
  : i.formato === 'milhoes' ? `${num(i.valor / 1e6, 1)} mi` : i.formato === 'mwmed' ? `${num(i.valor / 1000, 1)} mil MWmed` : num(i.valor);
const comparacaoTermo = i => i.variacao != null ? `${pctSinal(i.variacao)} contra um ano antes`
  : i.pp != null ? `${i.pp >= 0 ? '+' : '−'}${num(Math.abs(i.pp) * 100, 1)} p.p. contra um ano antes (era ${pct(i.antes)})` : '';
const setaTermo = d => d > 0 ? '<span class="termo-seta melhora">▲ melhora</span>' : d < 0 ? '<span class="termo-seta piora">▼ piora</span>'
  : '<span class="termo-seta">● estável</span>';
// Resumo do sinal: melhora, piora, misto (uma de cada) ou estável
function resumoTermo(sinal) {
  const sobe = sinal.itens.some(i => i.dir > 0), desce = sinal.itens.some(i => i.dir < 0);
  return sobe && desce ? 'misto' : sobe ? 'melhora' : desce ? 'piora' : 'estável';
}
const etiquetaTermo = r => ({ melhora: 'etiqueta-compra', piora: 'etiqueta-venda', misto: 'etiqueta-conferir' }[r] ?? '');
// Transmissoras listadas (prefixo do código): receita anual permitida fixa, corrigida pela inflação
const TRANSMISSORAS = new Set(['ALUP', 'TAEE', 'ISAE', 'TRPL']);
const NOTA_ELETRICA = 'O consumo pesa no resultado de distribuidoras e geradoras. Transmissoras (Alupar, Taesa, ISA) recebem uma receita fixa por contrato e quase não sentem.';

// Quadro do último resultado trimestral, no Resumo da página do ativo. Os números vêm do próprio ITR
// entregue à CVM, lido no dia da entrega (src/itrdia.js); no domingo o arquivo aberto da CVM confirma.
function blocoUltimoResultado(e) {
  const tri = D.trimestres?.[e.cnpj] ?? [];
  const u = tri.at(-1);
  if (!u || !ok(u[1])) return '';
  const acha = ref => tri.find(t => t[0] === ref);
  const anoAntes = acha(`${Number(u[0].slice(0, 4)) - 1}${u[0].slice(4)}`), anterior = tri.at(-2);
  const varia = (a, b) => (ok(a) && ok(b) && b > 0 ? a / b - 1 : null);
  const linhaVar = (rot, atual, base, baseRot) => {
    const v = varia(atual, base);
    return v == null ? '' : `<span class="${classeSinal(v)}">${pctSinal(v)}</span> contra ${baseRot}`;
  };
  const lucroA = linhaVar('lucro', u[1], anoAntes?.[1], anoAntes ? rotuloTrimestre(anoAntes[0]) : ''),
    lucroT = linhaVar('lucro', u[1], anterior?.[1], anterior ? rotuloTrimestre(anterior[0]) : '');
  const receitaA = linhaVar('receita', u[2], anoAntes?.[2], anoAntes ? rotuloTrimestre(anoAntes[0]) : '');
  const margem = ok(u[2]) && u[2] > 0 ? u[1] / u[2] : null, margemA = anoAntes && ok(anoAntes[2]) && anoAntes[2] > 0 ? anoAntes[1] / anoAntes[2] : null;
  const recente = u[3] && (Date.parse(hojeIso()) - Date.parse(u[3])) / 864e5 <= 10;
  return `<div class="grafico-bloco ultimo-resultado${recente ? ' recente' : ''}" style="margin-bottom:12px">
    <div class="mapa-topo"><div><h3>Resultado do ${rotuloTrimestre(u[0])}${recente ? ' <span class="selo">novo</span>' : ''}</h3>
      <div class="tile-sub">${u[4] === 'enet'
        ? `Lido do ITR entregue à CVM em ${data(u[3] ?? '')}: lucro <b>contábil e preliminar</b>; o recorrente divulgado pela empresa pode ser diferente`
        : `Balanço entregue à CVM em ${data(u[3] ?? '')}: lucro contábil, trimestre isolado`}</div></div></div>
    ${(e.conferir ?? '').includes('efeito fiscal no lucro') ? `<p class="tile-sub aviso-fiscal">${ICONE_ALERTA.replace('icone-alerta', 'icone-alerta icone-mini')}
      Imposto do trimestre muito abaixo do normal (alíquota de ${pct(e.aliquota_tri, 0)} contra ${pct(e.aliquota_media, 0)} em média): parte do lucro é efeito fiscal que não se repete.
      O P/L e o lucro de 12 meses ficam melhores do que o resultado recorrente.</p>` : ''}
    <div class="ativo-numeros ativo-numeros-p" style="margin:8px 0 0">
      <div><span>Lucro do trimestre</span><b>${dinheiro(u[1])}</b><small>${[lucroA, lucroT].filter(Boolean).join(' · ') || '–'}</small></div>
      ${ok(u[2]) && u[2] > 0 ? `<div><span>Receita do trimestre</span><b>${dinheiro(u[2])}</b><small>${receitaA || '–'}</small></div>` : ''}
      ${ok(margem) ? `<div><span>Margem líquida</span><b>${pct(margem)}</b><small>${ok(margemA) ? `era ${pct(margemA)} um ano antes` : '–'}</small></div>` : ''}
      <div><span>Lucro em 12 meses</span><b>${dinheiro(e.lucro_12m)}</b><small>ROE ${pct(e.roe)} · P/L ${num(e.pl)}</small></div>
    </div></div>`;
}

// Seção da página do ativo (vazia quando a empresa não tem dado do setor)
function secaoTermometro(e, tk) {
  const k = chaveTermometro(e, tk);
  if (!k) return '';
  const s = TERMO.sinais[k];
  return `<section class="ativo-secao" id="s-termometro"><h3 class="secao">Termômetro do trimestre</h3>
    <p class="tile-sub" style="margin:0 0 8px">Dados públicos do setor que saem antes do balanço: <b>${esc(s.fonte)}</b>, ${esc(s.nome)}, ${esc(s.periodo)}.
      Mostram a direção do próximo resultado, não o número exato. ${k === TERMO.energia ? esc(NOTA_ELETRICA) : ''}</p>
    <div class="blocos">${s.itens.map(i => `<div class="bloco"><h3>${esc(i.rotulo)}</h3><div class="tile-valor">${valorTermo(i)}</div>
      <div class="tile-sub">${comparacaoTermo(i)}</div><div class="termo-linha">${setaTermo(i.dir)}<span class="tile-sub">${esc(i.texto)}</span></div></div>`).join('')}</div>
    <div class="graficos"><div class="grafico-bloco"><h3 id="g-termo-1-t"></h3><div class="tile-sub" id="g-termo-1-s"></div><div class="grafico" id="g-termo-1"></div></div>
      <div class="grafico-bloco"><h3 id="g-termo-2-t"></h3><div class="tile-sub" id="g-termo-2-s"></div><div class="grafico" id="g-termo-2"></div></div></div>
  </section>`;
}
function desenharTermometro(e, tk) {
  const k = chaveTermometro(e, tk);
  if (!k || !$('#g-termo-1')) return;
  const g = TERMO.graficos[k];
  const titulo = (n, t, sub) => { $(`#g-termo-${n}-t`).textContent = t; $(`#g-termo-${n}-s`).textContent = sub; };
  const pares = arr => g.meses.map((m, i) => [m, arr[i]]);
  if (k.startsWith('susep:')) {
    titulo(1, 'Prêmio ganho por mês', 'Receita de seguros do grupo, em reais');
    // Rótulo curto (ago/26): 25 colunas não cabem com o ano inteiro
    graficoColunas($('#g-termo-1'), { pontos: g.meses.map((m, i) => [mesAno(m).replace(/\/20(\d\d)$/, '/$1'), g.premio[i]]), fmt: dinheiro });
    titulo(2, 'Sinistralidade por mês', 'Sinistros ÷ prêmio ganho; quanto menor, melhor');
    graficoLinhas($('#g-termo-2'), { series: [{ nome: 'Sinistralidade', cor: 'var(--serie-2)', pontos: pares(g.sinistralidade) }], fmt: v => pct(v), fmtEixo: v => pct(v, 0) });
  } else if (k.startsWith('anatel:')) {
    titulo(1, 'Linhas pós-pago', 'Clientes de conta, sem chips de máquinas (M2M)');
    graficoLinhas($('#g-termo-1'), { series: [{ nome: 'Pós-pago', cor: 'var(--serie-1)', pontos: pares(g.pos) }], fmt: v => `${num(v / 1e6, 2)} mi`, fmtEixo: v => `${num(v / 1e6, 0)} mi` });
    titulo(2, 'Participação no pós-pago', 'Fatia das linhas pós-pago do país');
    graficoLinhas($('#g-termo-2'), { series: [{ nome: 'Participação', cor: 'var(--serie-3)', pontos: pares(g.share) }], fmt: v => pct(v), fmtEixo: v => pct(v, 0) });
  } else {
    titulo(1, 'Consumo de energia no Brasil', 'Carga média mensal do sistema interligado (MW médios)');
    graficoLinhas($('#g-termo-1'), { series: [{ nome: 'Brasil', cor: 'var(--serie-1)', pontos: pares(g.sin) }], fmt: v => `${num(v, 0)} MWmed` });
    titulo(2, 'Consumo no Sudeste/Centro-Oeste', 'Região da CPFL e da maior parte das distribuidoras listadas');
    graficoLinhas($('#g-termo-2'), { series: [{ nome: 'Sudeste/Centro-Oeste', cor: 'var(--serie-3)', pontos: pares(g.se) }], fmt: v => `${num(v, 0)} MWmed` });
  }
}

// Bloco do Início: o sinal de cada ação da carteira que tem dado do setor (elétricas dividem o da ONS)
function blocoTermometroInicio(c) {
  if (!TERMO || !c) return '';
  const itens = [];
  for (const tk of c.acoes ?? []) {
    const e = porTicker.get(tk), k = chaveTermometro(e, tk);
    if (!k) continue;
    const s = TERMO.sinais[k];
    // Transmissora tem receita fixa por contrato: o consumo de energia quase não mexe no resultado
    const transmissora = k === TERMO.energia && TRANSMISSORAS.has(tk.slice(0, 4));
    const r = transmissora ? 'pouco efeito' : resumoTermo(s);
    // Todos os indicadores, menos o pré-pago (contexto do setor inteiro); valores sem o "contra um ano antes"
    const detalhe = transmissora ? 'transmissora: receita fixa por contrato, o consumo pesa pouco'
      : s.itens.filter(i => i.rotulo !== 'Linhas pré-pago')
        .map(i => `${i.rotulo.replace('Consumo de energia: ', 'consumo ')} ${comparacaoTermo(i).replace(' contra um ano antes', '')}`).join(' · ');
    itens.push(`<button class="atencao-item" data-ir="empresa/${esc(tk)}"><span class="atencao-txt"><b>${esc(tk)} · ${esc(s.fonte)} (${esc(s.periodo)})</b>
      <span>${esc(detalhe)}</span></span><span class="etiqueta ${etiquetaTermo(r)}">${r[0].toUpperCase() + r.slice(1)}</span></button>`);
  }
  if (!itens.length) return '';
  return `<div class="grafico-bloco" style="margin-top:12px"><h3>Termômetro do trimestre</h3>
    <div class="tile-sub">Dados do setor que saem antes do balanço (Susep, Anatel, ONS), contra o mesmo período do ano anterior</div>
    <div class="atencao">${itens.join('')}</div></div>`;
}

const SECOES_ATIVO = [['resumo', 'Resumo'], ['cotacao', 'Cotação'], ['indicadores', 'Indicadores'], ['dividendos', 'Dividendos'],
  ['contabil', 'Contábil'], ['setor', 'Setor'], ['simulador', 'Simulador']];
let voltarPara = 'inicio';
let observadorSecoes = null;
const cacheAtivos = new Map();
let aberturaAtivo = 0;
function carregarAtivo(tk) {
  // Falha não fica guardada: a próxima abertura tenta de novo
  if (!cacheAtivos.has(tk)) cacheAtivos.set(tk, fetch(`ativos/${encodeURIComponent(tk)}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(d => { if (!d) cacheAtivos.delete(tk); return d; }));
  return cacheAtivos.get(tk);
}

// O que cada indicador mede, em linguagem simples (aparece ao clicar no nome)
const EXPLICA = {
  'P/L': 'Preço ÷ lucro por ação. Quantos anos de lucro atual pagariam o preço da ação. Menor = mais barato, mas compare com o histórico e o setor.',
  'P/VP': 'Preço ÷ patrimônio por ação. Abaixo de 1, a bolsa paga menos que o valor contábil da empresa.',
  'EV/EBIT': 'Valor da firma (valor de mercado + dívida líquida) ÷ lucro operacional. Considera a dívida, por isso compara melhor empresas endividadas.',
  'EV/EBITDA': 'Valor da firma ÷ geração de caixa operacional (EBITDA). Muito usado para comparar empresas do mesmo setor.',
  'Dividendos 12m': 'Dividendos e JCP por ação com data com nos últimos 12 meses ÷ preço de hoje (dividend yield), pelos proventos declarados na B3.',
  'Valor de mercado': 'Preço × total de ações: quanto a bolsa diz que a empresa vale.',
  'Valor da firma (EV)': 'Valor de mercado + dívida líquida: o custo de "comprar a empresa inteira" com as dívidas.',
  'ROE': 'Lucro ÷ patrimônio líquido. Quanto a empresa lucra sobre o dinheiro dos acionistas; acima de 15% costuma ser bom.',
  'ROIC': 'Lucro operacional ÷ capital investido (próprio e de terceiros). Mede a qualidade do negócio sem o efeito da dívida.',
  'Margem bruta': 'Quanto sobra da receita depois do custo direto dos produtos ou serviços.',
  'Margem EBIT': 'Lucro operacional ÷ receita. Mostra a eficiência da operação antes de juros e impostos.',
  'Margem líquida': 'Lucro final ÷ receita: quanto de cada R$ 100 vendidos vira lucro.',
  'Dívida líquida': 'Dívida bruta menos o caixa. Negativa quando a empresa tem mais caixa que dívida.',
  'Dív. líq. / EBITDA': 'Em quantos anos a geração de caixa pagaria a dívida líquida. Acima de 3 pede atenção.',
  'Dív. líq. / PL': 'Dívida líquida ÷ patrimônio: quanto a empresa usa de dinheiro de terceiros contra o dos sócios.',
  'Liquidez corrente': 'Ativo circulante ÷ passivo circulante. Acima de 1, o que entra no curto prazo cobre o que vence no curto prazo.',
  'Receita, 5 anos': 'Crescimento médio anual da receita nos últimos 5 anos (CAGR).',
  'Lucro, 5 anos': 'Crescimento médio anual do lucro nos últimos 5 anos (CAGR).',
  'Anos com lucro': 'Em quantos exercícios a empresa teve lucro. Constância importa mais que um ano excepcional.',
  'Anos com dividendo': 'Em quantos dos últimos anos a empresa pagou proventos.',
  'Graham': 'Preço justo de Benjamin Graham: √(22,5 × lucro por ação × patrimônio por ação). Serve para empresas lucrativas e estáveis.',
  'Bazin (preço-teto)': 'Método de Décio Bazin: o preço máximo para receber 6% ao ano, pelo dividendo médio de 3 anos.',
  'Lucro / preço': 'Inverso do P/L (earnings yield): quanto a empresa lucra por real investido na ação.',
  'Contra Tesouro IPCA+': 'Lucro/preço menos a taxa real do Tesouro IPCA+. Positivo = a ação "rende" mais que o título sem risco, em lucro.',
  'Payout 12m': 'Parte do lucro paga como proventos. Acima de 100%, pagou mais do que lucrou.',
};

function montarAtivo(el, ticker) {
  const e = porTicker.get(ticker);
  if (!e) { el.innerHTML = `<p class="vazio">Ativo ${esc(ticker)} não encontrado.</p>`; return; }
  const fin = !!e.financeira;
  const outros = e.tickers.split(' ').filter(t => t !== ticker);
  const p = precoAtual(ticker) ?? e.preco;
  // Margens de Graham e Bazin são relativas ao preço: valem para qualquer classe na escala do código aberto
  const v12 = variacao(ticker, 365) ?? e.variacao_12m;
  const linha = (rotulo, valor, dica) => {
    const txt = EXPLICA[rotulo] ?? dica;
    return `<dt${txt ? ` class="com-explica" data-explica="${esc(txt)}" tabindex="0" role="button"` : ''}>${rotulo}</dt><dd>${valor}</dd>`;
  };
  const sinal = v => `<span class="${classeSinal(v)}">${pctSinal(v)}</span>`;
  const g = naCarteira.has(e.cnpj) ? gatilhoAcao(ticker, e, p) : null;
  const tetoBazin = ok(e.bazin_margem) ? p * (1 + e.bazin_margem) : null;
  const justoGraham = ok(e.graham_margem) ? p * (1 + e.graham_margem) : null;
  const pares = D.empresas.filter(x => x.setor === e.setor && x.vm > 0).sort((a, b) => b.vm - a.vm);
  const vizinhos = [...new Set([...pares.slice(0, 8), e])];
  const mediana = k => { const v = pares.map(x => x[k]).filter(ok).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const anos = (D.anuais[e.cnpj] ?? []).filter(a => a[0] >= 2015);
  const hist = D.historico[e.cnpj] ?? [];
  const numeros = itens => itens.map(([r, v]) => `<div><span>${r}</span><b>${v}</b></div>`).join('');
  const linhaTabela = (rotulo, f, dica) => `<tr style="cursor:default"><td class="esq"${dica ? ` title="${esc(dica)}"` : ''}>${rotulo}</td>${[...anos].reverse().map(a => `<td>${f(a)}</td>`).join('')}</tr>`;

  el.innerHTML = `
    <div class="ativo-cabecalho">
      <div class="ativo-id">
        <button class="botao botao-voltar" id="a-voltar" aria-label="Voltar">←</button>
        <div><div class="ativo-linha1"><h2 id="ativo-titulo">${esc(ticker)}</h2>${selos(e)}</div>
          <div class="nome">${esc(e.nome)}</div>
          <div class="setor">${esc(e.setor)}${outros.length ? ` · outros códigos: ${outros.map(t => `<a href="#empresa/${esc(t)}">${esc(t)}</a>`).join(', ')}` : ''}</div></div>
      </div>
      <div class="ativo-preco"><b>R$ ${num(p, 2)}</b><span>${sinal(variacao(ticker, 1) ?? e.var_dia)} no dia · ${sinal(v12)} em 12 meses</span></div>
    </div>
    <div class="ativo-numeros">${numeros([['Valor de mercado', dinheiro(e.vm)], ['P/L', num(e.pl)], ['P/VP', num(e.pvp, 2)], ['Dividendos 12m', pct(e.dy)],
      ['ROE', pct(e.roe)], ['Nota geral', ok(e.nota_geral) ? `${e.nota_geral}<small>/100</small>` : '–'], ['Liquidez/dia', dinheiro(e.liquidez)]])}</div>
    <nav class="ativo-secoes" aria-label="Seções do ativo">${SECOES_ATIVO.flatMap(x => (x[0] === 'setor' && chaveTermometro(e, ticker) ? [['termometro', 'Termômetro'], x]
      : x[0] === 'cotacao' && fatosDe(e, ticker).length ? [['noticias', 'Notícias'], x] : [x])).map(([k, r]) => `<a href="#" data-secao="${k}">${r}</a>`).join('')}
      <a class="botao botao-principal" href="#comparar/${encodeURIComponent(ticker)}">Comparar</a></nav>

    <section class="ativo-secao" id="s-resumo"><h3 class="secao">Resumo</h3>
      ${blocoUltimoResultado(e)}
      ${e.oportunidade ? `<div class="aviso aviso-info"><div><strong>Por que é oportunidade:</strong> ${esc(e.motivo)}.</div></div>` : ''}
      ${avisoNaoRecorrente(e)}
      ${!e.elegivel ? `<div class="aviso">${ICONE_ALERTA}<div><strong>Fora do ranking:</strong> ${(e.liquidez ?? 0) < 1e6 ? 'negocia menos de R$ 1 mi por dia' : 'balanço atrasado ou sem lucro informado'}, por isso não recebe nota.</div></div>` : ''}
      ${alertasFicha(e) ? `<div class="aviso">${ICONE_ALERTA}<div><strong>Atenção</strong>${listaAlertas(alertasFicha(e))}</div></div>` : ''}
      <div class="blocos">
        <div class="bloco"><h3>Notas (0 a 100)</h3><div class="notas-ficha">
          ${[['Geral', e.nota_geral], ['Qualidade', e.nota_qualidade], ['Preço', e.nota_preco], ...(fin ? [] : [['Saúde', e.nota_saude]]), ['Crescimento', e.nota_crescimento]]
            .map(([r, v]) => `<div class="medidor"><span>${r}</span>${ok(v) ? `<i style="--v:${v}%"></i><span>${v}</span>` : '<span class="vazio">–</span>'}</div>`).join('')}
          ${e.magica_posicao ? `<div class="tile-sub">Fórmula Mágica: ${e.magica_posicao}ª posição</div>` : ''}</div></div>
        <div class="bloco"><h3>Preço contra o próprio histórico</h3><dl class="lista">
          ${linha('P/L hoje', num(e.pl), EXPLICA['P/L'])}${ok(e.pl_recorrente) ? linha('P/L recorrente', `<b>${num(e.pl_recorrente)}</b>`, 'P/L pelo lucro de 12 meses sem os ganhos não recorrentes (venda de ativo, crédito fiscal). É ele que vale contra o histórico, nas notas e na oportunidade.') : ''}${linha('Mediana desde 2020', num(e.pl_mediana), 'O P/L típico da própria empresa desde 2020. Inclui 2020–2022, com juro real perto de zero, quando qualquer lucro valia mais.')}
          ${linha('Mediana dos últimos 2 anos', num(e.pl_mediana_2a), 'O P/L típico nos últimos 24 meses, com juros no patamar de hoje (Tesouro IPCA+ perto de 7–8%). É a referência mais justa quando o juro está alto.')}
          ${linha('Faixa barata–cara', ok(e.regua.p25) ? `${num(e.regua.p25)} a ${num(e.regua.p75)}` : '–', 'Percentis 25 e 75 do P/L mês a mês (os menores entre desde 2020 e últimos 2 anos): abaixo do primeiro está barata; acima do segundo, cara.')}
          ${linha('Mais barato que em', ok(e.regua.pct) ? `${num(100 - e.regua.pct, 0)}% dos meses` : '–', 'Em quantos meses o P/L esteve mais alto que hoje, pela régua mais exigente (desde 2020 ou últimos 2 anos).')}
          ${g && ok(g.normal) ? linha('Preço normal / caro', `R$ ${num(g.normal, 2)} / R$ ${num(g.caro, 2)}`, 'Preço em que o P/L volta à mediana e ao percentil 75 (a régua mais exigente), com o lucro de hoje.') : ''}
        </dl>${g ? `<div class="selos" style="margin-top:8px"><span class="selo">${g.st}</span></div>` : ''}</div>
        <div class="bloco"><h3>Preço justo pelos métodos clássicos</h3><dl class="lista">
          ${linha('Graham', ok(justoGraham) ? `R$ ${num(justoGraham, 2)} ${sinal(e.graham_margem)}` : '–')}
          ${linha('Bazin (preço-teto)', ok(tetoBazin) ? `R$ ${num(tetoBazin, 2)} ${sinal(e.bazin_margem)}` : '–')}
          ${linha('Lucro / preço', pct(e.earnings_yield))}
          ${linha('Contra Tesouro IPCA+', `<span class="${classeSinal(e.premio_vs_tesouro)}">${ok(e.premio_vs_tesouro) ? (e.premio_vs_tesouro > 0 ? '+' : '') + num(e.premio_vs_tesouro * 100, 1) + ' p.p.' : '–'}</span>`)}
        </dl><div class="tile-sub" style="margin-top:6px">Percentual: distância do preço de hoje. Clique no nome de um indicador para ver o que ele mede.</div></div>
        <div class="bloco"><h3>Sobre a empresa</h3><dl class="lista">
          ${linha('Setor', esc(e.setor))}${e.segmento ? linha('Listagem', esc(e.segmento), 'Nível de governança na B3. Novo Mercado é o mais exigente: só ações ON e tag along de 100%.') : ''}
          ${e.controle ? linha('Controle', esc(e.controle.toLowerCase()), 'Quem controla a empresa. Estatais podem sofrer interferência do governo.') : ''}
          ${linha('CNPJ', esc(e.cnpj))}${linha('Balanço mais recente', data(e.dt_balanco))}
          ${proximoResultado(e) ? linha('Próximo resultado', proximoResultado(e).replace(/<[^>]+>/g, '').replace(/^Resultado [^:]*: /, '')) : ''}
        </dl><div id="a-eventos" class="tile-sub" style="margin-top:6px"></div></div>
      </div>
    </section>
    ${secaoNoticias(e, ticker)}

    <section class="ativo-secao" id="s-cotacao"><h3 class="secao">Cotação</h3>
      <div class="grafico-bloco"><div class="mapa-topo"><div><h3>Cotação de ${esc(ticker)}</h3><div class="tile-sub" id="a-preco-sub">Carregando…</div></div>
        <span class="segmentado" role="group" aria-label="Período">${[['1m', '1M'], ['6m', '6M'], ['1a', '1A'], ['5a', '5A'], ['max', 'Máx']].map(([k, r]) =>
          `<button data-periodo="${k}" aria-pressed="${k === '1a'}">${r}</button>`).join('')}</span></div>
        <div class="grafico" id="g-preco"></div>
        <div class="tile-sub">Fechamento diário ajustado por desdobramentos, grupamentos e bonificações (não por dividendos).</div></div>
      <div class="graficos" style="margin-top:12px"><div class="grafico-bloco"><h3>P/L mês a mês</h3><div class="tile-sub">Linha cinza: mediana desde 2020; tracejada: mediana dos últimos 2 anos (juro alto como hoje). Meses sem lucro ficam em branco.</div><div class="grafico" id="g-pl"></div></div>
        <div class="grafico-bloco"><h3>P/VP mês a mês</h3><div class="tile-sub">Preço sobre patrimônio líquido</div><div class="grafico" id="g-pvp"></div></div></div>
    </section>

    <section class="ativo-secao" id="s-indicadores"><h3 class="secao">Indicadores</h3>
      <div class="blocos">
        <div class="bloco"><h3>Valuation</h3><dl class="lista">
          ${linha('P/L', num(e.pl))}${linha('P/VP', num(e.pvp, 2))}
          ${fin ? '' : linha('EV/EBIT', num(e.ev_ebit)) + linha('EV/EBITDA', num(e.ev_ebitda))}
          ${linha('Dividendos 12m', pct(e.dy))}${linha('Valor de mercado', dinheiro(e.vm))}${fin ? '' : linha('Valor da firma (EV)', dinheiro(e.ev))}
        </dl></div>
        <div class="bloco"><h3>Rentabilidade</h3><dl class="lista">
          ${linha('ROE', pct(e.roe))}${fin ? '' : linha('ROIC', pct(e.roic))}
          ${fin ? '' : linha('Margem bruta', pct(e.margem_bruta)) + linha('Margem EBIT', pct(e.margem_ebit))}
          ${linha('Margem líquida', pct(e.margem_liq))}
        </dl></div>
        ${fin ? '' : `<div class="bloco"><h3>Endividamento</h3><dl class="lista">
          ${linha('Dívida líquida', dinheiro(e.divida_liq))}
          ${linha('Dív. líq. / EBITDA', e.div_liq_ebitda >= 99 ? 'EBITDA negativo' : num(e.div_liq_ebitda))}
          ${linha('Dív. líq. / PL', num(e.div_liq_pl, 2))}${linha('Liquidez corrente', num(e.liq_corrente, 2))}
        </dl></div>`}
        <div class="bloco"><h3>Crescimento e constância</h3><dl class="lista">
          ${fin ? '' : linha('Receita, 5 anos', pctSinal(e.cagr_receita_5a) + ' a.a.')}
          ${linha('Lucro, 5 anos', pctSinal(e.cagr_lucro_5a) + ' a.a.')}
          ${linha('Anos com lucro', `${e.anos_lucro} de ${e.anos_lucro_base}`)}
          ${linha('Anos com dividendo', `${e.anos_dividendo} dos últimos ${Math.min(5, e.anos_lucro_base)}`)}
        </dl></div>
      </div>
      ${fin ? '' : `<div class="graficos"><div class="grafico-bloco"><h3>EV/EBITDA mês a mês</h3><div class="tile-sub">Valor da firma sobre a geração de caixa operacional</div><div class="grafico" id="g-evebitda"></div></div>
        <div class="grafico-bloco"><h3>Dívida líquida por ano</h3><div class="tile-sub">Negativa = mais caixa que dívida</div><div class="grafico" id="g-divida"></div></div></div>`}
    </section>

    <section class="ativo-secao" id="s-dividendos"><h3 class="secao">Dividendos</h3>
      <div class="ativo-numeros ativo-numeros-p" id="a-div-numeros">${numeros([['Dividendos 12m', pct(e.dy)], ['Média de 3 anos', pct(e.dy_3a)], ['Payout 12m', pct(e.payout)],
        ['Pago em 12 meses', dinheiro(e.dividendos_12m)], ['Preço-teto Bazin', ok(tetoBazin) ? `R$ ${num(tetoBazin, 2)}` : '–']])}</div>
      ${e.payout > 1 ? `<div class="aviso">${ICONE_ALERTA}<div>Nos últimos 12 meses pagou mais do que lucrou (payout ${pct(e.payout, 0)}). Conte com dividendo menor à frente.</div></div>` : ''}
      ${(e.conferir ?? '').includes('dividendo extraordinário') ? `<div class="aviso">${ICONE_ALERTA}<div><strong>Dividendo fora do normal:</strong> os ${pct(e.dy)} dos últimos 12 meses são ${num(e.dy / e.dy_mediana, 0)} vezes a mediana desde 2020 (${pct(e.dy_mediana)}). Inclui pagamento extraordinário ou o preço caiu muito: não use esse percentual como expectativa.</div></div>` : ''}
      <div class="graficos"><div class="grafico-bloco"><h3>Proventos por ação, por ano</h3><div class="tile-sub">Dividendos, JCP e rendimentos pela data com, ajustados por desdobramento</div><div class="grafico" id="g-prov-ano"></div></div>
        <div class="grafico-bloco"><h3>Dividend yield por ano</h3><div class="tile-sub">Soma de cada provento ÷ o preço da ação na data com</div><div class="grafico" id="g-dy-ano"></div></div></div>
      <div class="graficos"><div class="grafico-bloco"><h3>Em que meses costuma pagar</h3><div class="tile-sub">Pela data com, nos últimos 5 anos: quanto mais escuro, mais vezes</div><div id="a-meses"></div></div>
        <div class="grafico-bloco"><h3>Dividend yield mês a mês</h3><div class="tile-sub">Dividendos de 12 meses sobre o preço de cada mês</div><div class="grafico" id="g-dy"></div></div></div>
      <div class="grafico-bloco"><h3>Histórico de proventos</h3><div class="tile-sub">Valores por ação como a empresa declarou. Data com: último dia para ter a ação e receber.</div>
        <div id="a-proventos"><p class="vazio">Carregando…</p></div></div>
    </section>

    <section class="ativo-secao" id="s-contabil"><h3 class="secao">Dados contábeis</h3>
      <div class="graficos"><div class="grafico-bloco"><h3>Lucro líquido por ano</h3><div class="tile-sub">Atribuído aos controladores</div><div class="grafico" id="g-lucro"></div></div>
        <div class="grafico-bloco"><h3>Lucro por trimestre</h3><div class="tile-sub">Cada trimestre isolado, últimos 8${proximoResultado(e) ? ' · ' + proximoResultado(e).replace(/<[^>]+>/g, '') : ''}</div><div class="grafico" id="g-tri"></div></div>
        <div class="grafico-bloco"><h3>${fin ? 'Receitas de intermediação' : 'Receita líquida'} por ano</h3><div class="tile-sub">&nbsp;</div><div class="grafico" id="g-receita"></div></div>
        <div class="grafico-bloco"><h3>Dividendos e JCP pagos por ano</h3><div class="tile-sub">Total pago aos acionistas da empresa, pelo fluxo de caixa da controladora</div><div class="grafico" id="g-div"></div></div></div>
      ${anos.length ? `<div class="tabela-caixa" style="max-height:none"><table class="tabela-contabil"><thead><tr><th class="esq">Em reais</th>${[...anos].reverse().map(a => `<th>${a[0]}</th>`).join('')}</tr></thead><tbody>
        <tr class="grupo"><td class="esq" colspan="${anos.length + 1}">Resultado</td></tr>
        ${linhaTabela(fin ? 'Receitas de intermediação' : 'Receita líquida', a => dinheiro(a[1]))}
        ${fin ? '' : linhaTabela('EBIT (lucro operacional)', a => dinheiro(a[6]))}
        ${linhaTabela('Lucro líquido', a => `<span class="${a[2] < 0 ? 'negativo' : ''}">${dinheiro(a[2])}</span>`)}
        ${linhaTabela('Margem líquida', a => (a[1] > 0 && ok(a[2]) ? pct(a[2] / a[1]) : '–'))}
        ${linhaTabela('ROE', a => (a[5] > 0 && ok(a[2]) ? pct(a[2] / a[5]) : '–'))}
        <tr class="grupo"><td class="esq" colspan="${anos.length + 1}">Balanço</td></tr>
        ${linhaTabela('Ativo total', a => dinheiro(a[7]))}
        ${linhaTabela('Patrimônio líquido', a => dinheiro(a[5]))}
        ${fin ? '' : linhaTabela('Caixa', a => dinheiro(a[8])) + linhaTabela('Dívida bruta', a => dinheiro(a[9])) + linhaTabela('Dívida líquida', a => dinheiro(a[4]))}
        <tr class="grupo"><td class="esq" colspan="${anos.length + 1}">Fluxo de caixa</td></tr>
        ${linhaTabela('Caixa das operações', a => dinheiro(a[10]), 'Dinheiro que a operação gerou no ano')}
        ${fin ? '' : linhaTabela('Investimentos (capex)', a => dinheiro(ok(a[11]) ? -Math.abs(a[11]) : null), 'Compra de imobilizado e intangível')}
        ${fin ? '' : linhaTabela('Caixa livre', a => (ok(a[10]) && ok(a[11]) ? `<span class="${a[10] - Math.abs(a[11]) < 0 ? 'negativo' : ''}">${dinheiro(a[10] - Math.abs(a[11]))}</span>` : '–'), 'Caixa das operações menos investimentos: o que sobra para dividendos e dívida')}
        ${linhaTabela('Proventos pagos', a => dinheiro(ok(a[3]) ? Math.abs(a[3]) : null))}
        ${linhaTabela('Payout', a => (ok(a[3]) && a[2] > 0 ? pct(Math.abs(a[3]) / a[2], 0) : '–'))}
      </tbody></table></div>` : ''}
      ${e.acoes_fre ? `<p class="tile-sub">${esc(e.acoes_fre)}. O valor de mercado e os múltiplos já usam a quantidade nova.</p>` : ''}
    </section>

    ${secaoTermometro(e, ticker)}

    <section class="ativo-secao" id="s-setor"><h3 class="secao">Comparado ao setor</h3>
      <p class="tile-sub" style="margin:0 0 8px">${esc(e.setor)}: as ${vizinhos.length} maiores por valor de mercado. A última linha é a mediana das ${pares.length} empresas do setor.</p>
      <div class="tabela-caixa" style="max-height:none"><table><thead><tr><th class="esq">Empresa</th><th>Valor de mercado</th><th>Nota</th><th>P/L</th><th>P/VP</th><th>Div. 12m</th><th>ROE</th><th>Marg. líq.</th>${fin ? '' : '<th>Dív./EBITDA</th>'}</tr></thead>
        <tbody>${vizinhos.map(x => `<tr data-ticker="${esc(x.ticker)}" class="${x === e ? 'linha-atual' : ''}"><td class="esq empresa"><b>${esc(x.ticker)}</b><span class="nome">${esc(x.nome)}</span></td>
          <td>${dinheiro(x.vm)}</td><td>${medidor(x.nota_geral)}</td><td>${num(x.pl)}</td><td>${num(x.pvp, 2)}</td><td>${pct(x.dy)}</td><td>${pct(x.roe)}</td><td>${pct(x.margem_liq)}</td>
          ${fin ? '' : `<td>${x.div_liq_ebitda >= 99 ? 'n/a' : num(x.div_liq_ebitda)}</td>`}</tr>`).join('')}
          <tr class="linha-mediana" style="cursor:default"><td class="esq"><b>Mediana do setor</b></td><td>${dinheiro(mediana('vm'))}</td><td>${medidor(mediana('nota_geral'))}</td><td>${num(mediana('pl'))}</td>
          <td>${num(mediana('pvp'), 2)}</td><td>${pct(mediana('dy'))}</td><td>${pct(mediana('roe'))}</td><td>${pct(mediana('margem_liq'))}</td>${fin ? '' : `<td>${num(mediana('div_liq_ebitda'))}</td>`}</tr></tbody></table></div>
    </section>

    <section class="ativo-secao" id="s-simulador"><h3 class="secao">Simulador de rentabilidade</h3>
      <div class="grafico-bloco"><p class="tile-sub" style="margin:0 0 10px">Quanto teria hoje quem tivesse investido em ${esc(ticker)} no passado, com aporte todo mês, contra o mesmo dinheiro no CDI.
        Usa o fechamento diário ajustado e os proventos pela data com. Não considera imposto nem taxas.</p>
        <div class="filtros simulador-campos">
          <label>Período <select id="sim-anos">${[1, 3, 5, 10].map(a => `<option value="${a}" ${a === 5 ? 'selected' : ''}>${a} ano${a > 1 ? 's' : ''}</option>`).join('')}</select></label>
          <label>Aporte inicial <input class="campo" id="sim-inicial" type="number" min="0" step="100" value="1000" style="width:110px"></label>
          <label>Aporte mensal <input class="campo" id="sim-mensal" type="number" min="0" step="50" value="300" style="width:100px"></label>
          <label><input type="checkbox" id="sim-reinveste" checked> Reinvestir os proventos</label>
        </div>
        <div id="sim-resultado"><p class="vazio">Carregando…</p></div></div>
    </section>`;

  window.scrollTo(0, 0);
  $('#a-voltar').addEventListener('click', () => irPara(voltarPara));
  for (const a of el.querySelectorAll('[data-secao]')) a.addEventListener('click', ev => {
    ev.preventDefault();
    const alvo = $(`#s-${a.dataset.secao}`);
    // Desconta o que fica grudado no topo: a barra de busca (só no computador) e o menu de seções
    const grudado = (innerWidth > 900 ? $('.topo').offsetHeight : 0) + $('.ativo-secoes', el).offsetHeight + 12;
    window.scrollTo({ top: alvo.getBoundingClientRect().top + scrollY - grudado, behavior: 'smooth' });
  });
  for (const tr of el.querySelectorAll('#s-setor tr[data-ticker]')) tr.addEventListener('click', () => irPara(`empresa/${tr.dataset.ticker}`));
  // Clique no nome do indicador abre a explicação logo abaixo
  for (const dt of el.querySelectorAll('dt.com-explica')) {
    const abrir = () => {
      const prox = dt.nextElementSibling?.nextElementSibling;
      if (prox?.classList.contains('explica')) { prox.remove(); return; }
      dt.nextElementSibling.insertAdjacentHTML('afterend', `<p class="explica">${esc(dt.dataset.explica)}</p>`);
    };
    dt.addEventListener('click', abrir);
    dt.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrir(); } });
  }
  // Seção visível destacada no menu de seções
  const links = new Map([...el.querySelectorAll('[data-secao]')].map(a => [`s-${a.dataset.secao}`, a]));
  observadorSecoes?.disconnect();
  observadorSecoes = new IntersectionObserver(itens => {
    for (const it of itens) if (it.isIntersecting) for (const [id, a] of links) a.toggleAttribute('aria-current', id === it.target.id);
  }, { rootMargin: '-30% 0px -60% 0px' });
  for (const s of el.querySelectorAll('.ativo-secao')) observadorSecoes.observe(s);

  graficoLinhas($('#g-pl'), { series: [{ nome: 'P/L', cor: 'var(--serie-1)', pontos: hist.map(x => [x[0], x[1]]) }], fmt: v => num(v), ref: [
    ok(e.pl_mediana) ? { y: e.pl_mediana, rotulo: `mediana desde 2020: ${num(e.pl_mediana)}` } : null,
    ok(e.pl_mediana_2a) ? { y: e.pl_mediana_2a, rotulo: `últimos 2 anos: ${num(e.pl_mediana_2a)}`, tracejado: true, direita: true } : null] });
  graficoLinhas($('#g-pvp'), { series: [{ nome: 'P/VP', cor: 'var(--serie-1)', pontos: hist.map(x => [x[0], x[2]]) }], fmt: v => num(v, 2), ref: ok(e.pvp_mediana) ? { y: e.pvp_mediana, rotulo: `mediana ${num(e.pvp_mediana, 2)}` } : null });
  graficoLinhas($('#g-dy'), { series: [{ nome: 'Dividend yield', cor: 'var(--serie-3)', pontos: hist.map(x => [x[0], x[4]]) }], fmt: v => pct(v), fmtEixo: v => pct(v, 0), eixoZero: true });
  if (!fin) {
    graficoLinhas($('#g-evebitda'), { series: [{ nome: 'EV/EBITDA', cor: 'var(--serie-1)', pontos: hist.map(x => [x[0], x[3]]) }], fmt: v => num(v) });
    graficoColunas($('#g-divida'), { pontos: anos.map(a => [String(a[0]), a[4]]), fmt: dinheiro });
  }
  graficoColunas($('#g-lucro'), { pontos: anos.map(a => [String(a[0]), a[2]]), fmt: dinheiro });
  graficoColunas($('#g-receita'), { pontos: anos.map(a => [String(a[0]), a[1]]), fmt: dinheiro });
  graficoColunas($('#g-div'), { pontos: anos.map(a => [String(a[0]), a[3] == null ? null : Math.abs(a[3])]), fmt: dinheiro });
  graficoColunas($('#g-tri'), { pontos: (D.trimestres?.[e.cnpj] ?? []).slice(-8).map(t => [rotuloTrimestre(t[0]), t[1]]), fmt: dinheiro });
  desenharTermometro(e, ticker);

  // Cada abertura ganha um número: resposta que chega depois de outra abertura é descartada
  const minhaVez = ++aberturaAtivo;
  carregarAtivo(ticker).then(dados => {
    if (minhaVez !== aberturaAtivo || abaAtual !== 'ativo') return;
    if (!dados) {
      for (const id of ['#a-preco-sub', '#a-proventos', '#sim-resultado']) $(id).innerHTML = '<span class="vazio">Histórico diário indisponível (abra pelo site publicado ou pelo servidor local).</span>';
      return;
    }
    desenharCotacao(dados, '1a');
    // Variação da ação no pregão de cada notícia
    for (const s of el.querySelectorAll('.fato-var[data-dia]')) {
      const v = variacaoNoDia(dados.precos, s.dataset.dia);
      if (ok(v)) s.outerHTML = `<span class="fato-var ${classeSinal(v)}" title="Variação no pregão do dia (ou no seguinte, se a notícia saiu em dia sem pregão)">${pctSinal(v)} no pregão</span>`;
    }
    for (const b of el.querySelectorAll('[data-periodo]')) b.addEventListener('click', () => {
      for (const x of el.querySelectorAll('[data-periodo]')) x.setAttribute('aria-pressed', x === b);
      desenharCotacao(dados, b.dataset.periodo);
    });
    desenharProventos(dados, e);
    const sim = () => simular(dados);
    for (const id of ['#sim-anos', '#sim-inicial', '#sim-mensal', '#sim-reinveste']) $(id).addEventListener('change', sim);
    sim();
  });
}

// Cotação do período, com a variação e a variação somando os proventos
function desenharCotacao(dados, periodo) {
  const ult = dados.precos.at(-1)[0];
  const dias = { '1m': 31, '6m': 183, '1a': 366, '5a': 1827, max: 1e5 }[periodo];
  const desde = new Date(Date.parse(ult) - dias * 864e5).toISOString().slice(0, 10);
  const pts = dados.precos.filter(x => x[0] >= desde);
  const v = pts.at(-1)[1] / pts[0][1] - 1;
  const prov = dados.proventos.filter(x => x[0] > pts[0][0]).reduce((s, x) => s + x[4], 0);
  $('#a-preco-sub').innerHTML = `${data(pts[0][0])} a ${data(ult)}: <b class="${classeSinal(v)}">${pctSinal(v)}</b> no preço${prov > 0
    ? ` · <b class="${classeSinal(v + prov / pts[0][1])}">${pctSinal(v + prov / pts[0][1])}</b> somando R$ ${num(prov, 2)} de proventos por ação` : ''}`;
  graficoDiario($('#g-preco'), { pontos: pts, fmt: x => `R$ ${num(x, 2)}`, cor: v >= 0 ? 'var(--serie-3)' : 'var(--negativo-col)' });
}

function desenharProventos(dados, e) {
  const prov = dados.proventos;
  if (!prov.length) { $('#a-proventos').innerHTML = '<p class="vazio">A B3 não registra proventos para este código.</p>'; return; }
  // Por ano: soma ajustada por ação e yield de cada pagamento sobre o preço da data com
  // Restituição de capital não é rendimento: aparece na tabela, mas fica fora das somas e do yield
  const rendimentos = prov.filter(x => x[2] !== 'Restituição de capital');
  const porAno = new Map();
  for (const x of rendimentos) {
    const a = x[0].slice(0, 4), s = porAno.get(a) ?? { valor: 0, dy: 0 };
    s.valor += x[4];
    if (x[5] > 0) s.dy += x[3] / x[5];
    porAno.set(a, s);
  }
  const anos = [...porAno].sort((a, b) => a[0].localeCompare(b[0])).filter(([a]) => a >= '2012');
  graficoColunas($('#g-prov-ano'), { pontos: anos.map(([a, s]) => [a, s.valor]), fmt: v => `R$ ${num(v, 2)}` });
  graficoColunas($('#g-dy-ano'), { pontos: anos.map(([a, s]) => [a, s.dy]), fmt: v => pct(v), fmtEixo: v => pct(v, 0) });
  // Meses de pagamento nos últimos 5 anos
  const ano0 = `${Number(hojeIso().slice(0, 4)) - 4}-01-01`;
  const meses = Array(12).fill(0), vistos = new Set();
  for (const x of prov) if (x[0] >= ano0 && !vistos.has(x[0].slice(0, 7))) { vistos.add(x[0].slice(0, 7)); meses[Number(x[0].slice(5, 7)) - 1]++; }
  const mx = Math.max(1, ...meses);
  $('#a-meses').innerHTML = `<div class="meses-grade">${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].map((m, i) =>
    `<div class="mes ${meses[i] ? 'com' : ''}" style="--f:${meses[i] / mx}" title="${meses[i]} ${meses[i] === 1 ? 'ano' : 'anos'} com data com em ${m}"><b>${m}</b><span>${meses[i] ? `${meses[i]}×` : '–'}</span></div>`).join('')}</div>`;
  // Números do topo da seção: último provento e soma de 12 meses
  const ultimo = prov[0];
  const umAno = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const soma12 = rendimentos.filter(x => x[0] >= umAno).reduce((s, x) => s + x[4], 0);
  $('#a-div-numeros').insertAdjacentHTML('afterbegin', `<div><span>Último provento</span><b>R$ ${num(ultimo[3], 4)}</b></div>
    <div><span>Data com do último</span><b>${data(ultimo[0])}</b></div><div><span>Por ação em 12 meses</span><b>R$ ${num(soma12, 2)}</b></div>`);
  // Tabela: 15 mais recentes, com botão para ver todos
  const linhas = (lista) => lista.map(x => `<tr style="cursor:default"><td class="esq">${esc(x[2])}</td><td>${data(x[0])}</td><td>${x[1] ? data(x[1]) : '<span class="vazio">–</span>'}</td>
    <td>R$ ${num(x[3], 4)}</td><td>${x[5] > 0 ? pct(x[3] / x[5], 2) : '–'}</td></tr>`).join('');
  const tabela = lista => `<div class="tabela-caixa" style="max-height:none"><table><thead><tr><th class="esq">Tipo</th><th>Data com</th><th>Pagamento</th><th>Valor por ação</th><th title="Valor ÷ preço da ação na data com">Yield</th></tr></thead>
    <tbody>${linhas(lista)}</tbody></table></div>`;
  $('#a-proventos').innerHTML = tabela(prov.slice(0, 15)) + (prov.length > 15 ? `<button class="botao" id="a-prov-todos" style="margin-top:8px">Ver todos (${prov.length})</button>` : '');
  $('#a-prov-todos')?.addEventListener('click', () => { $('#a-proventos').innerHTML = tabela(prov); });
  // Desdobramentos e afins desde 2010
  const ev = dados.eventos.filter(x => x[0] >= '2010');
  if (ev.length) $('#a-eventos').innerHTML = `<b>Desdobramentos e bonificações:</b> ${ev.map(x => `${x[1].toLowerCase().replace('bonificacao', 'bonificação')} em ${data(x[0])} (${x[1] === 'GRUPAMENTO' ? `${num(1 / x[2], 0)} para 1` : `${num(x[2], x[2] % 1 ? 1 : 0)}%`})`).join('; ')}.`;
}

// Investimento passado com aportes mensais, contra o mesmo fluxo no CDI
function simular(dados) {
  const anos = Number($('#sim-anos').value), inicial = Math.max(0, Number($('#sim-inicial').value) || 0);
  const mensal = Math.max(0, Number($('#sim-mensal').value) || 0), reinveste = $('#sim-reinveste').checked;
  const precos = dados.precos, ult = precos.at(-1)[0];
  const desde = new Date(Date.parse(ult) - anos * 365.25 * 864e5).toISOString().slice(0, 10);
  const pts = precos.filter(x => x[0] >= desde);
  if (!inicial && !mensal) { $('#sim-resultado').innerHTML = '<p class="vazio">Informe um aporte inicial ou mensal.</p>'; return; }
  if (pts.length < 20) { $('#sim-resultado').innerHTML = '<p class="vazio">Histórico curto demais para esse período.</p>'; return; }
  if (pts[0][0] > new Date(Date.parse(desde) + 40 * 864e5).toISOString().slice(0, 10)) {
    $('#sim-resultado').innerHTML = `<p class="vazio">A ação só tem cotação desde ${data(pts[0][0])}.</p>`; return;
  }
  // Percorre todos os dias úteis (os do CDI e os de pregão): o CDI rende mesmo quando a ação não negocia,
  // e o provento com data com num dia sem negócio entra no primeiro pregão seguinte
  const precoDe = new Map(pts);
  const cdi = new Map((D.cdi_diario ?? []).map(x => [x[0], x[1]]));
  const dias = [...new Set([...pts.map(x => x[0]), ...[...cdi.keys()].filter(d => d >= pts[0][0] && d <= pts.at(-1)[0])])].sort();
  const provs = dados.proventos.filter(x => x[0] >= pts[0][0]).map(x => [x[0], x[4]]).sort((a, b) => a[0].localeCompare(b[0]));
  let acoes = inicial / pts[0][1], investido = inicial, recebido = 0, caixa = 0, saldoCdi = inicial, mes = pts[0][0].slice(0, 7);
  let pendente = 0, ip = 0, ultimoPreco = pts[0][1];
  const serie = new Map();
  for (const d of dias) {
    if (d !== dias[0]) saldoCdi *= 1 + (cdi.get(d) ?? 0) / 100;
    // Direito ao provento: ações que a pessoa tinha na data com
    while (ip < provs.length && provs[ip][0] <= d) { pendente += acoes * provs[ip][1]; ip++; }
    const preco = precoDe.get(d);
    if (preco != null) {
      ultimoPreco = preco;
      if (d.slice(0, 7) !== mes) { mes = d.slice(0, 7); acoes += mensal / preco; investido += mensal; saldoCdi += mensal; }
      if (pendente) { recebido += pendente; if (reinveste) acoes += pendente / preco; else caixa += pendente; pendente = 0; }
    }
    serie.set(d.slice(0, 7), [acoes * ultimoPreco + caixa + pendente, saldoCdi, investido]);
  }
  recebido += pendente; caixa += pendente;
  const final = acoes * pts.at(-1)[1] + caixa;
  const ganho = final / investido - 1, ganhoCdi = saldoCdi / investido - 1;
  const meses = [...serie.keys()];
  $('#sim-resultado').innerHTML = `<div class="ativo-numeros ativo-numeros-p">
      <div><span>Total investido</span><b>${dinheiro(investido)}</b></div>
      <div><span>Saldo hoje</span><b>${dinheiro(final)}</b></div>
      <div><span>Resultado</span><b class="${classeSinal(ganho)}">${pctSinal(ganho)}</b></div>
      <div><span>Proventos recebidos</span><b>${dinheiro(recebido)}</b></div>
      <div><span>Mesmo dinheiro no CDI</span><b>${dinheiro(saldoCdi)}</b></div>
      <div><span>Contra o CDI</span><b class="${classeSinal(final - saldoCdi)}">${final >= saldoCdi ? '+' : '−'}${dinheiro(Math.abs(final - saldoCdi))}</b></div></div>
    <p class="tile-sub" style="margin:0 0 6px">De ${data(pts[0][0])} a ${data(pts.at(-1)[0])}. ${reinveste ? 'Proventos reinvestidos em ações na data com.' : 'Proventos guardados em caixa, sem render.'}
      O CDI rendeu ${pctSinal(ganhoCdi)} sobre o mesmo dinheiro.</p>
    <div class="grafico" id="g-sim"></div>`;
  graficoLinhas($('#g-sim'), { series: [
    { nome: `${dados.t}`, cor: 'var(--serie-1)', pontos: meses.map(m => [m, serie.get(m)[0]]) },
    { nome: 'CDI', cor: 'var(--serie-4)', pontos: meses.map(m => [m, serie.get(m)[1]]) },
    { nome: 'Investido', cor: 'var(--texto-3)', pontos: meses.map(m => [m, serie.get(m)[2]]) }], fmt: dinheiro, eixoZero: true });
}

// Linha diária com área: eixo de datas, dica ao passar o mouse
function graficoDiario(el, { pontos, fmt, cor = 'var(--serie-1)', altura = 260 }) {
  el.innerHTML = '';
  if (pontos.length < 2) { el.innerHTML = '<p class="vazio">Sem histórico suficiente.</p>'; return; }
  const vals = pontos.map(p => p[1]);
  const idGrad = `grad${Math.random().toString(36).slice(2)}`;
  const longo = Date.parse(pontos.at(-1)[0]) - Date.parse(pontos[0][0]) > 400 * 864e5;
  const rotX = d => longo ? mesAno(d.slice(0, 7)) : `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  montarGrafico(el, w => {
    const esc_ = escalaBonita(Math.min(...vals), Math.max(...vals));
    const passo = esc_.marcas[1] - esc_.marcas[0];
    const rotY = v => num(v, casas(passo));
    const m = { e: Math.max(...esc_.marcas.map(v => rotY(v).length)) * 6.5 + 10, d: 12, t: 8, b: 24 };
    const pw = w - m.e - m.d, ph = altura - m.t - m.b;
    const X = i => m.e + i * pw / (pontos.length - 1);
    const Y = v => m.t + ph - (v - esc_.ini) / (esc_.fim - esc_.ini) * ph;
    const linhaD = pontos.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    const nRot = Math.max(2, Math.floor(pw / 90));
    let svg = `<svg width="${w}" height="${altura}" role="img" aria-label="Cotação">
      <defs><linearGradient id="${idGrad}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${cor}" stop-opacity=".22"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>`;
    for (const v of esc_.marcas) svg += `<line x1="${m.e}" x2="${w - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grade)"/><text x="${m.e - 6}" y="${Y(v) + 4}" text-anchor="end">${rotY(v)}</text>`;
    for (let k = 0; k < nRot; k++) {
      const i = Math.round(k * (pontos.length - 1) / (nRot - 1));
      svg += `<text x="${X(i)}" y="${altura - 6}" text-anchor="${k === 0 ? 'start' : k === nRot - 1 ? 'end' : 'middle'}">${rotX(pontos[i][0])}</text>`;
    }
    svg += `<path d="${linhaD}L${X(pontos.length - 1)},${m.t + ph}L${X(0)},${m.t + ph}Z" fill="url(#${idGrad})"/>
      <path d="${linhaD}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/>
      <line class="cruz" y1="${m.t}" y2="${m.t + ph}" stroke="var(--texto-3)" visibility="hidden"/><circle class="ponto" r="4" fill="${cor}" stroke="var(--superficie)" stroke-width="2" visibility="hidden"/>
      <rect class="alvo" x="${m.e}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
    el.innerHTML = svg;
    const alvo = $('.alvo', el), cruz = $('.cruz', el), ponto = $('.ponto', el);
    const mover = ev => {
      const r = alvo.getBoundingClientRect(), cx = (ev.touches?.[0] ?? ev).clientX, cy = (ev.touches?.[0] ?? ev).clientY;
      const i = Math.max(0, Math.min(pontos.length - 1, Math.round((cx - r.left) / r.width * (pontos.length - 1))));
      for (const a of ['x1', 'x2']) cruz.setAttribute(a, X(i));
      cruz.setAttribute('visibility', 'visible');
      ponto.setAttribute('cx', X(i)); ponto.setAttribute('cy', Y(pontos[i][1])); ponto.setAttribute('visibility', 'visible');
      mostrarDica(`<div class="dica-titulo">${data(pontos[i][0])}</div><b>${esc(fmt(pontos[i][1]))}</b>`, cx, cy);
    };
    const sair = () => { cruz.setAttribute('visibility', 'hidden'); ponto.setAttribute('visibility', 'hidden'); esconderDica(); };
    alvo.addEventListener('mousemove', mover);
    alvo.addEventListener('touchmove', mover, { passive: true });
    alvo.addEventListener('mouseleave', sair);
    alvo.addEventListener('touchend', sair);
  });
}

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
  ['P/L × mediana dos últimos 2 anos', e => ok(e.pl) && ok(e.pl_mediana_2a) ? pctSinal(e.pl / e.pl_mediana_2a - 1, 0) : '–'],
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
// O que cada ETF acompanha; a cor segue o ETF (não a posição), para não mudar quando se esconde uma linha
const ETF_INFO = {
  IVVB11: { desc: 'S&P 500 (as 500 maiores dos EUA), em reais', cor: 'var(--serie-1)' },
  WRLD11: { desc: 'Ações do mundo todo, em reais', cor: 'var(--serie-2)' },
  BOVA11: { desc: 'Ibovespa, referência da bolsa brasileira', cor: 'var(--serie-3)' },
  AUVP11: { desc: 'Ações brasileiras escolhidas por fundamentos (índice Teva AUVP)', cor: 'var(--serie-5)' },
  AUPO11: { desc: 'Renda fixa: títulos públicos (índice Teva ITBR Liquidez). Cotação pelo Yahoo, fonte não oficial', cor: 'var(--serie-6)' },
  CDI: { desc: 'CDI acumulado', cor: 'var(--serie-4)' },
};
const etfsNoGrafico = new Set([...Object.keys(ETF_INFO)]);
const indexador = titulo => /IPCA|Renda\+|Educa\+/.test(titulo) ? 'IPCA + ' : /IGPM/.test(titulo) ? 'IGP-M + ' : /Selic/.test(titulo) ? 'Selic + ' : '';
function montarEtfs(el) {
  const linhaRet = (r, c) => `${pctSinal(r)}${ok(c) ? `<span class="setor"> · CDI ${pct(c)}</span>` : ''}`;
  const premios = D.empresas.filter(e => e.elegivel && ok(e.premio_vs_tesouro) && e.nota_qualidade >= 60 && !e.lucro_suspeito && (e.financeira || e.nota_saude >= 50))
    .sort((a, b) => b.premio_vs_tesouro - a.premio_vs_tesouro).slice(0, 10);
  const tes = D.tesouro;
  el.innerHTML = `
    <h2>ETFs e renda fixa</h2>
    <p class="intro">Os ETFs de fora do Brasil (IVVB11 e WRLD11) estão em reais, então o retorno inclui a variação do dólar
      (${pctSinal(etf.IVVB11?.dolar_12m)} em 12 meses). Tudo comparado com o CDI do mesmo período.</p>
    <div class="tabela-caixa" style="max-height:none"><table>
      <thead><tr><th class="esq">ETF</th><th>Preço</th><th>1 mês</th><th>12 meses</th><th>3 anos (a.a.)</th><th>5 anos (a.a.)</th>
        <th title="Quanto o preço está abaixo da máxima das últimas 52 semanas">Do pico 52s</th><th title="Pior queda do pico ao fundo desde o início">Maior queda</th>
        <th title="Volatilidade anualizada dos últimos 12 meses">Volatilidade</th><th>Liquidez/dia</th></tr></thead>
      <tbody>${D.etfs.map(e => `<tr style="cursor:default"><td class="esq" style="white-space:normal;min-width:280px"><b>${e.ticker}</b><span class="nome" style="display:block">${esc(ETF_INFO[e.ticker]?.desc ?? e.nome)} · desde ${data(e.desde)}</span></td>
        <td>R$ ${num(e.preco, 2)}</td><td class="${classeSinal(e.ret_1m)}">${pctSinal(e.ret_1m)}</td>
        <td>${linhaRet(e.ret_12m, e.cdi_12m)}</td><td>${linhaRet(e.ret_3a_aa, e.cdi_3a_aa)}</td><td>${linhaRet(e.ret_5a_aa, e.cdi_5a_aa)}</td>
        <td>${pct(e.distancia_maxima_52s)}</td><td>${pct(e.maior_queda)}</td><td>${pct(e.volatilidade_anual)}</td><td>${dinheiro(e.liquidez)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="grafico-bloco" style="margin-top:12px">
      <h3>R$ 100 investidos no início do período</h3>
      <div class="filtros periodos"><span class="segmentado" role="group" aria-label="Período">
        ${[[0.5, '6 meses'], [1, '1 ano'], [3, '3 anos'], [5, '5 anos'], [10, 'Desde 2016']].map(([a, r]) => `<button data-anos="${a}" aria-pressed="${a === periodoEtf}">${r}</button>`).join('')}
      </span>
      <span class="chips" role="group" aria-label="Linhas do gráfico">${Object.keys(ETF_INFO).map(tk => `<button class="chip" data-serie="${tk}" aria-pressed="${etfsNoGrafico.has(tk)}"><i style="background:${ETF_INFO[tk].cor}"></i>${tk}</button>`).join('')}</span>
      <span class="contagem" id="etf-nota"></span></div>
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
    const meses = a * 12 + m - Math.round(periodoEtf * 12);
    const inicio = periodoEtf === 10 ? '2016-01' : `${Math.floor((meses - 1) / 12)}-${String((meses - 1) % 12 + 1).padStart(2, '0')}`;
    const fora = [];
    const series = Object.keys(ETF_INFO).filter(tk => etfsNoGrafico.has(tk)).map(tk => {
      const s = (D.series[tk] ?? []).filter(p => p[0] >= inicio);
      if (!s.length || s[0][0] > inicio) { fora.push(tk); return null; }
      return { nome: tk, cor: ETF_INFO[tk].cor, pontos: s.map(p => [p[0], 100 * p[1] / s[0][1]]) };
    }).filter(Boolean);
    $('#etf-nota').textContent = fora.length ? `${fora.join(', ')} ainda não existia no início do período` : '';
    graficoLinhas($('#g-etf'), { series, fmt: v => `R$ ${num(v, 0)}`, fmtEixo: v => num(v, 0), ref: { y: 100, rotulo: '' }, altura: 280 });
  };
  for (const b of el.querySelectorAll('[data-serie]')) b.addEventListener('click', () => {
    const tk = b.dataset.serie;
    if (etfsNoGrafico.has(tk)) etfsNoGrafico.delete(tk); else etfsNoGrafico.add(tk);
    b.setAttribute('aria-pressed', etfsNoGrafico.has(tk));
    desenhar();
  });
  for (const b of el.querySelectorAll('[data-anos]')) b.addEventListener('click', () => {
    periodoEtf = Number(b.dataset.anos);
    el.querySelectorAll('[data-anos]').forEach(x => x.setAttribute('aria-pressed', x === b));
    desenhar();
  });
  desenhar();
}

// ---------- Simulador de carteira ----------
// Carteira imaginária com pesos-alvo. Ações e ETFs andam pelo fechamento diário ajustado e pelos proventos
// (ativos/TICKER.json; o provento entra no primeiro pregão depois da data com). A renda fixa rende na curva,
// sem a oscilação de preço do Tesouro: % do CDI, IPCA + taxa (IPCA do mês espalhado pelos dias úteis) e
// prefixado. Percorre os dias úteis do Banco Central e os pregões, e compara com o mesmo dinheiro, nas mesmas
// datas, no CDI e no Ibovespa (BOVA11), e com o total aportado corrigido pela inflação. A rentabilidade é a
// da cota (tira o efeito dos aportes), a mesma conta dos fundos. Sem imposto, taxas nem corretagem.
const CHAVE_SIM = 'comparador.simulador.v1';
const RF_SIM = {
  cdi: { nome: 'Renda fixa pós (CDI)', antes: '', depois: '% do CDI', padrao: 100 },
  ipca: { nome: 'Renda fixa IPCA+', antes: 'IPCA +', depois: '% a.a.', padrao: 6 },
  pre: { nome: 'Prefixado', antes: '', depois: '% a.a.', padrao: 11 },
};
const PERIODOS_SIM = [[1, '1 ano'], [3, '3 anos'], [5, '5 anos'], [10, '10 anos'], [0, 'Desde 2016']];
const REBAL_SIM = {
  aporte: 'Aportes vão para o que está abaixo do peso',
  nunca: 'Nunca: aportes divididos pelos pesos',
  anual: 'Todo ano: vende o que passou do peso e compra o resto',
};
const ativosSim = [...new Set([...D.etfs.map(e => e.ticker), ...listaTickers])];
const nomeSim = tk => (etf[tk] ? `ETF · ${ETF_INFO[tk]?.desc ?? etf[tk].nome ?? ''}` : porTicker.get(tk)?.nome ?? '');
const rotuloItemSim = i => (i.tipo === 'ativo' ? i.tk : `${RF_SIM[i.tipo].antes} ${num(i.taxa, i.tipo === 'cdi' ? 0 : 2)}${RF_SIM[i.tipo].depois}`.trim());
const SIM_PADRAO = {
  itens: [{ tipo: 'ipca', taxa: 6, peso: 35 }, { tipo: 'ativo', tk: 'IVVB11', peso: 25 }, { tipo: 'ativo', tk: 'BOVA11', peso: 30 }, { tipo: 'cdi', taxa: 100, peso: 10 }],
  anos: 5, inicial: 10000, mensal: 1000, rebal: 'aporte', reinveste: true, corrige: true,
};
// O que vem do armazenamento passa pelo mesmo filtro: só códigos conhecidos e números válidos
function limparSim(s) {
  const itens = (Array.isArray(s?.itens) ? s.itens : []).slice(0, 40).map(i => {
    const peso = numeroValido(i?.peso) ?? 0;
    if (i?.tipo === 'ativo') return ativosSim.includes(i.tk) ? { tipo: 'ativo', tk: i.tk, peso } : null;
    return RF_SIM[i?.tipo] ? { tipo: i.tipo, taxa: numeroValido(i.taxa) ?? RF_SIM[i.tipo].padrao, peso } : null;
  }).filter(Boolean);
  return {
    itens, anos: PERIODOS_SIM.some(p => p[0] === s?.anos) ? s.anos : 5,
    inicial: numeroValido(s?.inicial) ?? 10000, mensal: numeroValido(s?.mensal) ?? 1000,
    rebal: REBAL_SIM[s?.rebal] ? s.rebal : 'aporte', reinveste: s?.reinveste !== false, corrige: s?.corrige !== false,
  };
}
let simCfg = (() => {
  try { const s = limparSim(JSON.parse(localStorage.getItem(CHAVE_SIM))); if (s.itens.length) return s; } catch { /* sem armazenamento */ }
  return limparSim(SIM_PADRAO);
})();
const salvarSim = () => { try { localStorage.setItem(CHAVE_SIM, JSON.stringify(simCfg)); } catch { /* segue sem salvar */ } };
let simVez = 0, simTimer = null;
const agendarSim = () => { salvarSim(); clearTimeout(simTimer); simTimer = setTimeout(rodarSim, 300); };

function montarSimulador(el) {
  el.innerHTML = `
    <h2>Simulador de carteira</h2>
    <p class="intro">Monte uma carteira imaginária e veja como ela teria se saído no passado, com aporte todo mês, contra o CDI,
      o Ibovespa e a inflação. Ações e ETFs andam pelo fechamento diário e pelos proventos; a renda fixa rende na curva, sem a
      oscilação de preço que o Tesouro tem no caminho. Não desconta imposto, taxas nem corretagem.</p>
    <div class="grafico-bloco">
      <h3>Composição</h3>
      <div id="simc-itens"></div>
      <div class="filtros simc-adicionar">
        <input class="campo" id="simc-busca" list="simc-lista" placeholder="Adicionar ação ou ETF (ex.: ITSA4)" autocomplete="off" aria-label="Adicionar ação ou ETF">
        <datalist id="simc-lista">${ativosSim.map(tk => `<option value="${tk}">${esc(nomeSim(tk))}</option>`).join('')}</datalist>
        ${Object.entries(RF_SIM).map(([k, r]) => `<button class="botao" data-rf="${k}">+ ${r.nome}</button>`).join('')}
      </div>
      <div class="filtros">
        <button class="botao" id="simc-minha">Usar a minha carteira</button>
        <button class="botao" id="simc-iguais">Pesos iguais</button>
        <button class="botao" id="simc-limpar">Começar do zero</button>
        <span class="contagem" id="simc-aviso"></span>
      </div>
      <div class="filtros simulador-campos">
        <span class="segmentado" role="group" aria-label="Período">${PERIODOS_SIM.map(([a, r]) => `<button data-anos="${a}" aria-pressed="${a === simCfg.anos}">${r}</button>`).join('')}</span>
        <label>Aporte inicial <input class="campo" id="simc-inicial" type="number" min="0" step="1000" inputmode="decimal" value="${simCfg.inicial}" style="width:120px"></label>
        <label>Aporte mensal <input class="campo" id="simc-mensal" type="number" min="0" step="100" inputmode="decimal" value="${simCfg.mensal}" style="width:110px"></label>
      </div>
      <div class="filtros simulador-campos" style="margin-bottom:0">
        <label class="simc-rebal">Rebalancear <select id="simc-rebal">${Object.entries(REBAL_SIM).map(([k, r]) => `<option value="${k}" ${k === simCfg.rebal ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="simc-reinveste" ${simCfg.reinveste ? 'checked' : ''}> Reinvestir os proventos</label>
        <label><input type="checkbox" id="simc-corrige" ${simCfg.corrige ? 'checked' : ''}> Aporte mensal sobe com a inflação</label>
      </div>
    </div>
    <div id="simc-resultado"></div>`;

  const itensEl = $('#simc-itens', el);
  itensEl.addEventListener('input', ev => {
    const t = ev.target, k = Number(t.dataset.peso ?? t.dataset.taxa);
    if (!simCfg.itens[k]) return;
    const v = Math.max(0, Number(t.value) || 0);
    if (t.dataset.peso != null) { simCfg.itens[k].peso = v; atualizarSomaSim(); } else simCfg.itens[k].taxa = v;
    agendarSim();
  });
  itensEl.addEventListener('click', ev => {
    const b = ev.target.closest('[data-tirar]');
    if (!b) return;
    simCfg.itens.splice(Number(b.dataset.tirar), 1);
    desenharItensSim(); agendarSim();
  });
  const busca = $('#simc-busca', el);
  const adicionar = () => {
    const tk = busca.value.trim().toUpperCase();
    if (!ativosSim.includes(tk)) return;
    if (!simCfg.itens.some(i => i.tk === tk)) simCfg.itens.push({ tipo: 'ativo', tk, peso: 10 });
    busca.value = '';
    desenharItensSim(); agendarSim();
  };
  busca.addEventListener('change', adicionar);
  busca.addEventListener('keydown', ev => { if (ev.key === 'Enter') adicionar(); });
  for (const b of el.querySelectorAll('[data-rf]')) b.addEventListener('click', () => {
    simCfg.itens.push({ tipo: b.dataset.rf, taxa: RF_SIM[b.dataset.rf].padrao, peso: 10 });
    desenharItensSim(); agendarSim();
  });
  $('#simc-minha', el).addEventListener('click', () => {
    const itens = carteiraParaSim();
    if (!itens.length) { $('#simc-aviso').textContent = 'Preencha as quantidades na aba Carteira para usar a sua carteira aqui.'; return; }
    simCfg.itens = itens;
    $('#simc-aviso').textContent = 'Pesos de hoje da sua carteira. O Tesouro entra como IPCA + a taxa de hoje, na curva; o CDB, pelo % do CDI médio.';
    desenharItensSim(); agendarSim();
  });
  $('#simc-iguais', el).addEventListener('click', () => {
    const n = simCfg.itens.length;
    for (const i of simCfg.itens) i.peso = Math.round(1000 / n) / 10;
    desenharItensSim(); agendarSim();
  });
  $('#simc-limpar', el).addEventListener('click', () => { simCfg.itens = []; $('#simc-aviso').textContent = ''; desenharItensSim(); agendarSim(); });
  for (const b of el.querySelectorAll('[data-anos]')) b.addEventListener('click', () => {
    simCfg.anos = Number(b.dataset.anos);
    el.querySelectorAll('[data-anos]').forEach(x => x.setAttribute('aria-pressed', x === b));
    agendarSim();
  });
  for (const id of ['inicial', 'mensal']) $(`#simc-${id}`, el).addEventListener('input', ev => { simCfg[id] = Math.max(0, Number(ev.target.value) || 0); agendarSim(); });
  $('#simc-rebal', el).addEventListener('change', ev => { simCfg.rebal = ev.target.value; agendarSim(); });
  for (const id of ['reinveste', 'corrige']) $(`#simc-${id}`, el).addEventListener('change', ev => { simCfg[id] = ev.target.checked; agendarSim(); });
  desenharItensSim();
  rodarSim();
}

function desenharItensSim() {
  const el = $('#simc-itens');
  if (!simCfg.itens.length) { el.innerHTML = '<p class="vazio">Adicione ações, ETFs ou renda fixa abaixo.</p>'; return; }
  el.innerHTML = `<div class="tabela-caixa" style="max-height:none"><table class="simc-tabela">
    <thead><tr><th class="esq">Ativo</th><th>Peso (%)</th><th></th></tr></thead><tbody>
    ${simCfg.itens.map((i, k) => `<tr style="cursor:default"><td class="esq">${i.tipo === 'ativo'
      ? `<b>${esc(i.tk)}</b><span class="nome" style="display:block;white-space:normal">${esc(nomeSim(i.tk))}</span>`
      : `<b>${RF_SIM[i.tipo].nome}</b><span class="simc-taxa">${RF_SIM[i.tipo].antes}
          <input class="campo" type="number" min="0" step="${i.tipo === 'cdi' ? 5 : 0.25}" inputmode="decimal" data-taxa="${k}" value="${i.taxa}" aria-label="Taxa">
          ${RF_SIM[i.tipo].depois}</span>`}</td>
      <td><input class="campo" type="number" min="0" max="100" step="any" inputmode="decimal" data-peso="${k}" value="${i.peso}" aria-label="Peso de ${esc(rotuloItemSim(i))}" style="width:84px"></td>
      <td><button class="simc-tirar" data-tirar="${k}" aria-label="Tirar ${esc(rotuloItemSim(i))}" title="Tirar">×</button></td></tr>`).join('')}
    </tbody><tfoot><tr><td class="esq">Soma</td><td id="simc-soma"></td><td></td></tr></tfoot></table></div>
    <p class="tile-sub" id="simc-soma-aviso" style="margin:6px 0 0"></p>`;
  atualizarSomaSim();
}
function atualizarSomaSim() {
  const el = $('#simc-soma');
  if (!el) return;
  const soma = simCfg.itens.reduce((s, i) => s + i.peso, 0), fora = Math.abs(soma - 100) > 0.05;
  el.textContent = `${num(soma, soma % 1 ? 1 : 0)}%`;
  el.className = fora ? 'negativo' : '';
  $('#simc-soma-aviso').textContent = fora && soma > 0 ? 'Os pesos não somam 100%: a simulação usa a proporção entre eles.' : '';
}

// Pesos de hoje da carteira preenchida na aba Carteira (o CDB só na parte acima da reserva)
function carteiraParaSim() {
  const c = CARTEIRAS[0];
  if (!c) return [];
  const itens = [];
  for (const tk of [...(c.acoes ?? []), ...(c.etfs ?? [])]) {
    const v = (local.qtd[tk] ?? 0) * (precoAtual(tk) ?? 0);
    if (v > 0 && ativosSim.includes(tk)) itens.push({ tipo: 'ativo', tk, v });
  }
  for (const t of c.tesouro ?? []) {
    const i = infoTesouro(t), v = (local.qtd[`TD:${chaveTesouro(t)}`] ?? 0) * (i.pu ?? 0);
    if (v > 0 && ok(i.taxa)) itens.push({ tipo: 'ipca', taxa: Math.round(i.taxa * 100) / 100, v });
  }
  if (c.cdb) {
    const municao = pesosClasses(c).valores.municao;
    const cdbs = local.cdbs.filter(x => x.valor && x.data);
    const base = cdbs.reduce((s, x) => s + x.valor, 0);
    if (municao > 0) itens.push({ tipo: 'cdi', taxa: base ? Math.round(cdbs.reduce((s, x) => s + x.valor * x.pct, 0) / base) : 100, v: municao });
  }
  const total = itens.reduce((s, i) => s + i.v, 0);
  const res = itens.sort((a, b) => b.v - a.v).map(({ v, ...i }) => ({ ...i, peso: Math.round(1000 * v / total) / 10 }));
  // A sobra do arredondamento vai para o maior, para a soma fechar em 100%
  if (res.length) res[0].peso = Math.round(10 * (res[0].peso + 100 - res.reduce((s, i) => s + i.peso, 0))) / 10;
  return res;
}

async function rodarSim() {
  const vez = ++simVez, out = $('#simc-resultado');
  const itens = simCfg.itens.filter(i => i.peso > 0);
  const soma = itens.reduce((s, i) => s + i.peso, 0);
  if (!soma) { out.innerHTML = '<p class="vazio" style="margin-top:12px">Dê peso a pelo menos um ativo.</p>'; return; }
  if (!simCfg.inicial && !simCfg.mensal) { out.innerHTML = '<p class="vazio" style="margin-top:12px">Informe um aporte inicial ou mensal.</p>'; return; }
  if (!out.children.length) out.innerHTML = '<p class="vazio" style="margin-top:12px">Calculando…</p>';
  const tks = [...new Set([...itens.filter(i => i.tipo === 'ativo').map(i => i.tk), 'BOVA11'])];
  const arqs = await Promise.all(tks.map(carregarAtivo));
  if (vez !== simVez) return;
  const dados = Object.fromEntries(tks.map((tk, k) => [tk, arqs[k]?.precos?.length ? arqs[k] : null]));
  const faltam = itens.filter(i => i.tipo === 'ativo' && !dados[i.tk]).map(i => i.tk);
  if (faltam.length) { out.innerHTML = `<p class="vazio" style="margin-top:12px">Não consegui carregar a cotação de ${esc(faltam.join(', '))}.</p>`; return; }
  desenharResultadoSim(simularCarteira(itens.map(i => ({ ...i, w: i.peso / soma })), dados));
}

const isoMais = (iso, anos = 0, dias = 0) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + anos);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
// Maior queda de uma série [data, índice]: tamanho, pico, fundo e quando voltou ao pico
function maiorQuedaSerie(pts) {
  let pico = pts[0], q = { queda: 0, pico: pts[0][0], fundo: pts[0][0], volta: null };
  for (const p of pts) {
    if (p[1] >= pico[1]) {
      if (q.queda < 0 && !q.volta && q.pico === pico[0]) q.volta = p[0];
      pico = p;
    } else if (p[1] / pico[1] - 1 < q.queda) q = { queda: p[1] / pico[1] - 1, pico: pico[0], fundo: p[0], volta: null };
  }
  return q;
}
const volAnual = vals => {
  const r = [];
  for (let k = 1; k < vals.length; k++) if (vals[k - 1] > 0) r.push(Math.log(vals[k] / vals[k - 1]));
  if (r.length < 10) return null;
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1) * 252);
};
function correlacao(a, b) {
  const n = a.length;
  if (n < 6) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let c = 0, va = 0, vb = 0;
  for (let k = 0; k < n; k++) { c += (a[k] - ma) * (b[k] - mb); va += (a[k] - ma) ** 2; vb += (b[k] - mb) ** 2; }
  return va && vb ? c / Math.sqrt(va * vb) : null;
}

function simularCarteira(itens, dados) {
  const cfg = simCfg;
  const cdiDia = new Map(D.cdi_diario ?? []);
  const bova = dados.BOVA11;
  const fim = [...itens.filter(i => i.tipo === 'ativo').map(i => dados[i.tk].precos.at(-1)[0]), bova?.precos.at(-1)[0], D.cdi_diario.at(-1)[0]].filter(Boolean).sort().at(-1);
  let inicio = cfg.anos ? isoMais(fim, -cfg.anos) : D.cdi_diario[0][0];
  // Ativo que começou a negociar depois do início empurra o começo da simulação
  const avisos = [];
  for (const i of itens) if (i.tipo === 'ativo') {
    const p0 = dados[i.tk].precos[0][0];
    if (p0 > inicio) {
      if (p0 > isoMais(inicio, 0, 40)) avisos.push(`${i.tk} só tem cotação desde ${data(p0)}`);
      inicio = p0;
    }
  }
  if (bova && bova.precos[0][0] > inicio) inicio = bova.precos[0][0];
  const dias = [...new Set([...D.cdi_diario.map(x => x[0]), ...Object.values(dados).filter(Boolean).flatMap(d => d.precos.map(p => p[0]))])]
    .filter(d => d >= inicio && d <= fim).sort();

  // IPCA do mês espalhado pelos dias úteis dele; mês ainda sem IPCA usa a média dos últimos 12
  const uteis = new Map();
  for (const [d] of D.cdi_diario) uteis.set(d.slice(0, 7), (uteis.get(d.slice(0, 7)) ?? 0) + 1);
  const mesFinalCdi = D.cdi_diario.at(-1)[0].slice(0, 7);
  const ipcaMap = new Map(D.ipca_mensal ?? []);
  const ult12 = (D.ipca_mensal ?? []).slice(-12);
  const ipcaMedio = ult12.length ? ult12.reduce((p, x) => p * (1 + x[1] / 100), 1) ** (1 / 12) - 1 : 0.004;
  const estimados = new Set();
  const fatorIpca = (d, taxaAa) => {
    const m = d.slice(0, 7), n = m >= mesFinalCdi ? Math.max(21, uteis.get(m) ?? 0) : uteis.get(m) ?? 21;
    if (!ipcaMap.has(m)) estimados.add(m);
    return ((1 + (ipcaMap.has(m) ? ipcaMap.get(m) / 100 : ipcaMedio)) * (1 + taxaAa) ** (1 / 12)) ** (1 / n);
  };

  const novo = (i, d) => ({
    ...i, precos: d?.precos ?? null, ip: 0, preco: 1, iprov: 0,
    provs: d ? d.proventos.filter(p => p[0] >= inicio).map(p => [p[0], p[4]]).sort((a, b) => a[0].localeCompare(b[0])) : [],
    un: 0, pend: 0, solo: 0, soloPend: 0, netInv: 0, caixaProv: 0, recebido: 0, serie: [], meses: new Map(),
  });
  const A = itens.map(i => novo(i, i.tipo === 'ativo' ? dados[i.tk] : null));
  const ibov = bova ? novo({ tipo: 'ativo', tk: 'BOVA11', w: 0 }, bova) : null;
  let caixa = 0, investido = 0, invCorr = 0, saldoCdi = 0, unIbov = 0, idxCdi = 1, idxIpca = 1, twr = 1, vAnt = 0, mes = null;
  let proxRebal = isoMais(dias[0], 1);
  const diario = [], porMes = new Map(), recebidos = [];
  const valorAtivos = () => A.reduce((s, a) => s + a.un * a.preco, 0);
  const valor = () => valorAtivos() + A.reduce((s, a) => s + a.pend, 0) + caixa;
  const comprar = (a, v) => { a.un += v / a.preco; a.netInv += v; };

  dias.forEach((d, k) => {
    // 1) Renda fixa e índices rendem nos dias úteis
    if (k > 0 && cdiDia.has(d)) {
      const c = cdiDia.get(d) / 100, fi = fatorIpca(d, 0);
      idxCdi *= 1 + c; saldoCdi *= 1 + c; idxIpca *= fi; invCorr *= fi;
      for (const a of A) if (a.tipo !== 'ativo') a.preco *= a.tipo === 'cdi' ? 1 + c * a.taxa / 100 : a.tipo === 'pre' ? (1 + a.taxa / 100) ** (1 / 252) : fatorIpca(d, a.taxa / 100);
    }
    // 2) Preço do dia (o último conhecido quando não negociou) e proventos: direito pelas ações da véspera,
    //    pago no primeiro pregão depois da data com
    for (const a of ibov ? [...A, ibov] : A) {
      if (!a.precos) continue;
      while (a.ip + 1 < a.precos.length && a.precos[a.ip + 1][0] <= d) a.ip++;
      a.preco = a.precos[a.ip][1];
      while (a.iprov < a.provs.length && a.provs[a.iprov][0] < d) { const v = a.provs[a.iprov++][1]; a.pend += a.un * v; a.soloPend += a.solo * v; }
      if (a.precos[a.ip][0] === d && (a.pend || a.soloPend)) {
        if (a !== ibov) {
          a.recebido += a.pend; recebidos.push([d, a.pend]);
          if (cfg.reinveste) a.un += a.pend / a.preco; else { caixa += a.pend; a.caixaProv += a.pend; }
        }
        a.solo += a.soloPend / a.preco; a.pend = 0; a.soloPend = 0;
      }
    }
    // 3) Rentabilidade do dia, antes dos aportes
    const v0 = valor();
    if (vAnt > 0) twr *= v0 / vAnt;
    // 4) Aportes: o inicial no primeiro dia, o mensal no primeiro dia útil de cada mês
    const aporte = k === 0 ? cfg.inicial : d.slice(0, 7) !== mes ? cfg.mensal * (cfg.corrige ? idxIpca : 1) : 0;
    mes = d.slice(0, 7);
    if (k === 0) for (const a of ibov ? [...A, ibov] : A) a.solo = 1 / a.preco;
    if (aporte > 0) {
      investido += aporte; invCorr += aporte; saldoCdi += aporte;
      if (ibov) unIbov += aporte / ibov.preco;
      const total = valorAtivos();
      if (cfg.rebal === 'aporte' && total > 0) {
        const falta = A.map(a => Math.max(0, a.w * (total + aporte) - a.un * a.preco));
        const sf = falta.reduce((s, x) => s + x, 0);
        A.forEach((a, j) => comprar(a, sf <= aporte ? falta[j] + (aporte - sf) * a.w : aporte * falta[j] / sf));
      } else A.forEach(a => comprar(a, aporte * a.w));
    }
    // 5) Rebalanceamento anual: vende o que passou do peso e compra o que ficou para trás
    if (cfg.rebal === 'anual' && k > 0 && d >= proxRebal) {
      const total = valorAtivos();
      for (const a of A) { const alvo = a.w * total; a.netInv += alvo - a.un * a.preco; a.un = alvo / a.preco; }
      proxRebal = isoMais(proxRebal, 1);
    }
    vAnt = valor();
    diario.push([d, twr, idxCdi, ibov ? ibov.solo * ibov.preco + ibov.soloPend : null, idxIpca]);
    for (const a of A) { const s = a.solo * a.preco + a.soloPend; a.serie.push(s); a.meses.set(mes, s); }
    porMes.set(mes, [vAnt, saldoCdi, ibov ? unIbov * ibov.preco : null, invCorr]);
  });

  const ini = dias[0], ult = dias.at(-1), ultimo = diario.at(-1);
  const anos = (Date.parse(ult) - Date.parse(ini)) / (365.25 * 864e5);
  const aa = x => (anos >= 0.95 ? x ** (1 / anos) - 1 : null);
  const totalAtivos = valorAtivos();
  // Ano a ano pela cota: o último dia de cada ano contra o último do ano anterior (ou o primeiro dia)
  const anosCal = [];
  let base = diario[0];
  for (let k = 0; k < diario.length; k++) {
    const p = diario[k], prox = diario[k + 1];
    if (!prox || prox[0].slice(0, 4) !== p[0].slice(0, 4)) {
      anosCal.push({ ano: p[0].slice(0, 4), parcial: (base === diario[0] && base[0].slice(5) > '01-10') || (!prox && p[0].slice(5) < '12-20'),
        r: [1, 2, 3, 4].map(j => (ok(p[j]) && ok(base[j]) ? p[j] / base[j] - 1 : null)) });
      base = p;
    }
  }
  const umAno = isoMais(ult, -1);
  const variaveis = A.filter(a => a.tipo === 'ativo');
  const mesesSerie = [...porMes.keys()];
  const retMensal = a => mesesSerie.slice(1).map((m, j) => a.meses.get(m) / a.meses.get(mesesSerie[j]) - 1);
  return {
    ini, fim: ult, anos, avisos, estimados: [...estimados].sort(), investido, final: vAnt, invCorr,
    twr: ultimo[1] - 1, twrAa: aa(ultimo[1]), cdi: ultimo[2] - 1, cdiAa: aa(ultimo[2]),
    ibov: ok(ultimo[3]) ? ultimo[3] - 1 : null, ibovAa: ok(ultimo[3]) ? aa(ultimo[3]) : null,
    ipca: ultimo[4] - 1, ipcaAa: aa(ultimo[4]),
    vol: volAnual(diario.map(p => p[1])), queda: maiorQuedaSerie(diario.map(p => [p[0], p[1]])),
    recebido: recebidos.reduce((s, x) => s + x[1], 0), renda12: recebidos.filter(x => x[0] > umAno).reduce((s, x) => s + x[1], 0),
    diario, porMes, anosCal,
    ativos: A.map(a => {
      const fimV = a.un * a.preco, s = a.serie, tot = s.at(-1) / s[0];
      return { rotulo: rotuloItemSim(a), tk: a.tk, tipo: a.tipo, w: a.w, peso: totalAtivos ? fimV / totalAtivos : null, ret: tot - 1, aa: aa(tot),
        vol: a.tipo === 'ativo' ? volAnual(s) : null, queda: a.tipo === 'ativo' ? maiorQuedaSerie(dias.map((d, k) => [d, s[k]])).queda : null,
        ganho: fimV + a.pend + a.caixaProv - a.netInv, recebido: a.recebido };
    }),
    correl: variaveis.length >= 2 ? { nomes: variaveis.map(a => a.tk), m: variaveis.map(a => variaveis.map(b => (a === b ? 1 : correlacao(retMensal(a), retMensal(b))))) } : null,
  };
}

function desenharResultadoSim(r) {
  const out = $('#simc-resultado');
  if (r.diario.length < 20) { out.innerHTML = '<p class="vazio" style="margin-top:12px">Período curto demais para simular.</p>'; return; }
  const ganho = r.final - r.investido, q = r.queda;
  const mesesAte = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 864e5));
  const pctCdi = r.cdi > 0 ? r.twr / r.cdi : null;
  const real = ok(r.twrAa) && ok(r.ipcaAa) ? (1 + r.twrAa) / (1 + r.ipcaAa) - 1 : (1 + r.twr) / (1 + r.ipca) - 1;
  const sharpe = ok(r.twrAa) && ok(r.cdiAa) && r.vol > 0.005 ? (r.twrAa - r.cdiAa) / r.vol : null;
  const inteiro = Math.abs(r.anos - Math.round(r.anos)) < 0.05;
  const periodo = r.anos >= 0.95 ? `${num(r.anos, inteiro ? 0 : 1)} ${inteiro && Math.round(r.anos) === 1 ? 'ano' : 'anos'}` : `${mesesAte(r.ini, r.fim)} meses`;
  // O sinal vai no próprio <b>: span dentro do quadro ganha o estilo de rótulo
  const tile = (rot, val, sub = '', dica = '', cls = '') => `<div${dica ? ` title="${esc(dica)}"` : ''}><span>${rot}</span><b class="${cls}">${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const anual = x => (ok(x) ? `${pctSinal(x)} ao ano` : '');
  out.innerHTML = `
    ${r.avisos.length ? `<ul class="alertas" style="margin-top:12px"><li>${ICONE_ALERTA}<span>${esc(r.avisos.join('; '))}: a simulação começa aí, não no início do período escolhido.</span></li></ul>` : ''}
    <div class="ativo-numeros ativo-numeros-p" style="margin-top:12px">
      ${tile('Total aportado', dinheiro(r.investido), r.invCorr > r.investido * 1.001 ? `${dinheiro(r.invCorr)} corrigido pela inflação` : '')}
      ${tile('Saldo final', dinheiro(r.final), `${ganho >= 0 ? 'ganho de' : 'perda de'} ${dinheiro(Math.abs(ganho))}`)}
      ${tile('Rentabilidade', pctSinal(r.twr), anual(r.twrAa), 'Rentabilidade da cota: tira o efeito dos aportes, como nos fundos. É a que se compara com o CDI e o Ibovespa.', classeSinal(r.twr))}
      ${tile('CDI no período', pctSinal(r.cdi), pctCdi != null ? `a carteira fez ${num(pctCdi * 100, 0)}% do CDI` : '')}
      ${tile('Ibovespa (BOVA11)', pctSinal(r.ibov), anual(r.ibovAa), '', classeSinal(r.ibov))}
      ${tile('Acima da inflação', pctSinal(real), `${r.anos >= 0.95 ? 'ao ano; ' : ''}IPCA de ${pct(r.ipca)} no período`, '', classeSinal(real))}
      ${tile('Volatilidade', pct(r.vol), 'ao ano', 'Quanto a cota oscila de um dia para o outro, em base anual. Renda fixa fica perto de 0%; o Ibovespa costuma ficar entre 20% e 25%.')}
      ${tile('Maior queda', pct(q.queda), q.queda < -0.001 ? `${mesAno(q.pico.slice(0, 7))} a ${mesAno(q.fundo.slice(0, 7))}` : 'nenhuma relevante', '', classeSinal(q.queda))}
      ${tile('Índice de Sharpe', ok(sharpe) ? num(sharpe, 2) : '–', 'retorno acima do CDI por risco', 'Quanto a carteira rendeu acima do CDI para cada ponto de volatilidade. Acima de 0,5 é bom; negativo quer dizer que perdeu do CDI.')}
      ${tile('Proventos recebidos', dinheiro(r.recebido), r.renda12 ? `${dinheiro(r.renda12 / 12)}/mês nos últimos 12 meses` : '')}
    </div>
    <p class="tile-sub" style="margin:0 0 12px;font-size:.9rem">${resumoSim(r, periodo, mesesAte)}</p>
    <div class="grafico-bloco"><h3>Saldo da carteira</h3>
      <div class="tile-sub">O mesmo dinheiro, aportado nas mesmas datas, no CDI e no Ibovespa. A linha cinza é o total aportado corrigido pela
        inflação: abaixo dela, o dinheiro perdeu poder de compra.</div>
      <div class="grafico" id="g-simc"></div></div>
    <div class="duas-colunas">
      <div class="grafico-bloco"><h3>Queda desde o pico</h3>
        <div class="tile-sub">Quanto a cota estava abaixo do melhor momento anterior: o tamanho e a duração das fases ruins que seria preciso aguentar.</div>
        <div class="grafico" id="g-simc-queda"></div></div>
      <div class="grafico-bloco"><h3>Ano a ano</h3>
        <div class="tile-sub">Rentabilidade da cota em cada ano.${r.anosCal.some(a => a.parcial) ? ' * ano incompleto no período.' : ''}</div>
        <div class="tabela-caixa" style="max-height:none"><table><thead><tr><th class="esq">Ano</th><th>Carteira</th><th>CDI</th><th>Ibovespa</th><th>IPCA</th></tr></thead><tbody>
        ${r.anosCal.map(a => `<tr style="cursor:default"><td class="esq">${a.ano}${a.parcial ? '*' : ''}</td>
          <td class="${classeSinal(a.r[0])}"><b>${pctSinal(a.r[0])}</b></td><td>${pctSinal(a.r[1])}</td><td class="${classeSinal(a.r[2])}">${pctSinal(a.r[2])}</td><td>${pctSinal(a.r[3])}</td></tr>`).join('')}
        </tbody></table></div></div>
    </div>
    <div class="grafico-bloco" style="margin-top:12px"><h3>Cada ativo no período</h3>
      <div class="tile-sub">Retorno de cada um sozinho, com os proventos reinvestidos. "Resultado" é quanto cada um somou ao saldo final, em reais.
        O peso hoje mostra para onde a carteira derivou${simCfg.rebal === 'anual' ? ' desde o último rebalanceamento' : ''}.</div>
      <div class="tabela-caixa" style="max-height:none"><table>
        <thead><tr><th class="esq">Ativo</th><th>Peso alvo</th><th>Peso hoje</th><th>Retorno</th><th>Ao ano</th><th>Volatilidade</th><th>Maior queda</th><th>Proventos</th><th>Resultado</th></tr></thead>
        <tbody>${[...r.ativos].sort((a, b) => b.w - a.w).map(a => `<tr${a.tipo === 'ativo' && porTicker.has(a.tk) ? ` data-ticker="${esc(a.tk)}"` : ' style="cursor:default"'}>
          <td class="esq"><b>${esc(a.rotulo)}</b>${a.tipo === 'ativo' ? `<span class="nome" style="display:block">${esc(nomeSim(a.tk))}</span>` : ''}</td>
          <td>${pct(a.w)}</td><td>${pct(a.peso)}</td><td class="${classeSinal(a.ret)}">${pctSinal(a.ret)}</td><td class="${classeSinal(a.aa)}">${pctSinal(a.aa)}</td>
          <td>${a.vol != null ? pct(a.vol) : '–'}</td><td>${a.queda != null ? pct(a.queda) : '–'}</td><td>${a.recebido ? dinheiro(a.recebido) : '–'}</td>
          <td class="${classeSinal(a.ganho)}">${a.ganho >= 0 ? '+' : '−'}${dinheiro(Math.abs(a.ganho))}</td></tr>`).join('')}</tbody></table></div></div>
    ${r.correl ? `<div class="grafico-bloco" style="margin-top:12px"><h3>Quanto os ativos andam juntos</h3>
      <div class="tile-sub">Correlação dos retornos mensais no período. Perto de 1: sobem e caem juntos, um não protege o outro.
        Perto de 0 ou negativa: quando um cai, o outro tende a segurar, e a carteira oscila menos.</div>
      <div class="tabela-caixa" style="max-height:none"><table class="simc-correl"><thead><tr><th></th>${r.correl.nomes.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead>
        <tbody>${r.correl.m.map((linha, i) => `<tr style="cursor:default"><th class="esq">${esc(r.correl.nomes[i])}</th>${linha.map((c, j) =>
          `<td${i !== j && ok(c) ? ` class="${c >= 0 ? 'cor-pos' : 'cor-neg'}" style="--c:${Math.round(Math.abs(c) * 55)}%"` : ''}>${i === j ? '–' : ok(c) ? num(c, 2) : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>` : ''}
    <p class="tile-sub" style="margin-top:12px">${notasSim(r)}</p>`;

  for (const tr of out.querySelectorAll('tr[data-ticker]')) tr.addEventListener('click', () => irPara(`empresa/${tr.dataset.ticker}`));
  const meses = [...r.porMes.keys()];
  graficoLinhas($('#g-simc'), { series: [
    { nome: 'Carteira', cor: 'var(--serie-1)', pontos: meses.map(m => [m, r.porMes.get(m)[0]]) },
    { nome: 'CDI', cor: 'var(--serie-4)', pontos: meses.map(m => [m, r.porMes.get(m)[1]]) },
    ...(ok(r.ibov) ? [{ nome: 'Ibovespa', cor: 'var(--serie-3)', pontos: meses.map(m => [m, r.porMes.get(m)[2]]) }] : []),
    { nome: 'Aportado + inflação', cor: 'var(--texto-3)', pontos: meses.map(m => [m, r.porMes.get(m)[3]]) }], fmt: dinheiro, eixoZero: true, altura: 280 });
  let pico = 0;
  graficoDiario($('#g-simc-queda'), { pontos: r.diario.map(p => { pico = Math.max(pico, p[1]); return [p[0], 100 * (p[1] / pico - 1)]; }),
    fmt: v => `${num(v, 1)}%`, cor: 'var(--negativo-col)', altura: 220 });
}

function resumoSim(r, periodo, mesesAte) {
  const q = r.queda;
  let t = `Em ${periodo} (${data(r.ini)} a ${data(r.fim)}), a carteira rendeu <b class="${classeSinal(r.twr)}">${pctSinal(r.twr)}</b>${ok(r.twrAa) ? ` (${pct(r.twrAa)} ao ano)` : ''}
    e ${r.twr >= r.cdi ? 'ganhou' : 'perdeu'} do CDI, que fez ${pctSinal(r.cdi)}${ok(r.ibov) ? `; o Ibovespa fez ${pctSinal(r.ibov)}` : ''}.`;
  if (q.queda < -0.02) {
    t += ` A pior fase foi uma queda de <b class="negativo">${pct(q.queda)}</b> entre ${mesAno(q.pico.slice(0, 7))} e ${mesAno(q.fundo.slice(0, 7))}; `;
    t += q.volta ? `voltou ao pico em ${mesAno(q.volta.slice(0, 7))}, ${mesesAte(q.pico, q.volta)} meses depois do topo.` : 'até o fim do período não voltou ao pico.';
  }
  return t;
}

function notasSim(r) {
  const n = ['Sem imposto de renda, taxas nem corretagem.', 'Ações e ETFs pelo fechamento ajustado por desdobramentos e bonificações; proventos pela data com, pagos no pregão seguinte.',
    'Renda fixa na curva: um Tesouro vendido antes do vencimento pode render mais ou menos que isso.'];
  if (!simCfg.reinveste) n.push('Proventos guardados em caixa, sem render.');
  if (r.estimados.length) n.push(`IPCA de ${r.estimados.map(m => mesAno(m)).join(' e ')} ainda não divulgado: usa a média dos últimos 12 meses.`);
  n.push('Passado não garante o futuro: serve para entender risco e comportamento, não para prever retorno.');
  return n.join(' ');
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
      <h3>Simulador de carteira</h3>
      <p>Refaz o caminho dia a dia: ações e ETFs pelo fechamento ajustado e pelos proventos (pagos no pregão seguinte à data com),
        renda fixa na curva pelo CDI, pelo IPCA do mês mais a taxa escolhida ou por uma taxa prefixada. O aporte mensal entra no
        primeiro dia útil de cada mês. A rentabilidade é a da cota, como nos fundos: tira o efeito dos aportes, para poder comparar
        com o CDI e o Ibovespa. Volatilidade, maior queda e Sharpe saem da cota diária; a correlação, dos retornos mensais. Não
        desconta imposto, taxas nem corretagem, e a configuração fica salva só neste aparelho.</p>
      <h3>Notícias e movimentos</h3>
      <p>A cada atualização, o site busca as notícias das ações da carteira, das que mais se mexeram no dia e do mercado
        (Ibovespa e dólar) no Google Notícias, com a busca dos próprios portais como reserva. Busca também política que mexe com
        o mercado (discurso do presidente, anúncio da Fazenda, ajuste fiscal, votação no Congresso), só com títulos que falam de
        economia; aí o "mesmo tema" é o mesmo assunto, e o que saiu depois do fechamento aparece marcado na página inicial. Guarda só o título, o veículo, a data e o link.
        As notícias são agrupadas por dia e tema (resultado, recomendação, fiscal e política, juros, exterior…).</p>
      <ul>
        <li><b>Confirmado</b> só quando dois ou mais veículos reconhecidos (InfoMoney, Valor, Estadão, Money Times, Exame, Folha, O Globo,
          Reuters, Bloomberg e outros) publicam o mesmo tema no mesmo dia. Uma fonte sozinha aparece marcada como não confirmada.</li>
        <li><b>Oficial · CVM:</b> fatos relevantes e comunicados ao mercado que a própria empresa entrega à CVM (sistema ENET) valem como
          confirmados sozinhos, com link para o documento. Comunicados de rotina (convite de teleconferência, versão em inglês,
          negociação de administradores) ficam de fora.</li>
        <li><b>Provável motivo</b> de uma queda ou alta forte é o fato confirmado da empresa no dia ou no dia útil anterior. Sem ele, o site
          mostra o motivo confirmado do mercado, quando o Ibovespa andou na mesma direção.</li>
        <li>É uma leitura do que a imprensa publicou, não uma prova de causa: o mercado reage antes da notícia e às vezes por motivos que ninguém escreveu.</li>
      </ul>
      <h3>Indicadores</h3>
      <ul>
        <li><b>Últimos 12 meses:</b> lucro, receita, EBITDA e dividendos somam os quatro trimestres mais recentes.</li>
        <li><b>Sem olhar o futuro:</b> em cada data do histórico só vale o balanço que já tinha sido entregue à CVM.</li>
        <li><b>Valor de mercado</b> soma as ações ON e PN, cada uma pelo seu preço.</li>
        <li><b>EBITDA</b> não inclui o lucro de coligadas (equivalência patrimonial).</li>
        <li><b>Dividendos</b> são os proventos por ação (dividendos + JCP) com data com nos últimos 12 meses, declarados na B3, sobre o preço. Empresa sem registro na B3 usa o fluxo de caixa da controladora.</li>
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
        desde 2020 <b>e</b> também nos últimos 2 anos. A nota de oportunidade é metade qualidade e saúde, metade o tamanho do desconto.</p>
      <h3>Por que duas réguas de histórico</h3>
      <p>Entre 2020 e 2022 o juro real ficou perto de zero, e o mercado pagava mais caro por qualquer lucro. Com o Tesouro IPCA+
        a 7–8%, comparar com a mediana desde 2020 exagera o desconto: uma ação podia parecer 40% abaixo do normal e estar só
        10–20% abaixo do que valeu nos últimos 2 anos, com juro parecido com o de hoje. Por isso o site usa sempre a régua mais
        exigente: preço normal e caro pela mediana e pelo percentil 75 menores, e "barata" só se for barata contra as duas.</p>
      <h3>Lucro que não se repete</h3>
      <p>Um P/L baixo pode vir de lucro inflado por um ganho único. O site procura esses ganhos de quatro jeitos:</p>
      <ul>
        <li><b>Lucro acima do operacional</b> ou mais de 3 vezes a média dos 3 anos anteriores: as notas usam um lucro normalizado
          e o preço contra o histórico passa a usar o EV/EBIT.</li>
        <li><b>Imposto baixo no trimestre</b> (alíquota efetiva muito abaixo da média): marcado como efeito fiscal.</li>
        <li><b>Ganho que o balanço não separa</b>, como venda de participação lançada como receita ou crédito de PIS/COFINS: o
          balanço da CVM não mostra esses itens à parte, então eles ficam numa lista com fonte (config/lucro-recorrente.json).
          Quando a empresa está nela, o site mostra o <b>P/L recorrente</b> e o usa contra o histórico, nas notas e na oportunidade.
          Caso que motivou: Multiplan em 2026, com P/L de 8,6 no lucro contábil e cerca de 12 no recorrente.</li>
        <li><b>Imprensa citando "não recorrente"</b> no resultado de uma empresa que não está na lista: ela fica marcada para conferir.
          Por isso o site também busca as notícias de todas as ações que aparecem como oportunidade.</li>
      </ul>
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
  // ref: uma linha de referência ou várias ({ y, rotulo, tracejado, direita })
  const refs = [].concat(ref ?? []).filter(r => ok(r?.y));
  montarGrafico(el, w => {
    let lo = Math.min(...vals, ...refs.map(r => r.y));
    const hi = tetoRobusto(vals, [...refs.map(r => r.y), ...ultimos]);
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
    // Rótulo do primeiro mês colado no do primeiro janeiro ("out/2021" e "2022"): fica só o do ano
    if (anos.length > 1 && !anos[0][0].endsWith('-01') && X(anos[1][1]) - X(0) < 60) anos.shift();
    const passoAno = Math.ceil(anos.length / Math.max(1, Math.floor(pw / 48)));
    let svg = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(series.map(s => s.nome).join(', '))}">
      <defs><clipPath id="${idClip}"><rect x="0" y="${m.t - 4}" width="${W}" height="${ph + 8}"/></clipPath></defs>`;
    for (const v of esc_.marcas) svg += `<line x1="${m.e}" x2="${W - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grade)" stroke-width="1"/>
      <text x="${m.e - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(rotY(v))}</text>`;
    anos.filter((_, k) => k % passoAno === 0).forEach(([mm, i]) => { svg += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${mm.endsWith('-01') ? mm.slice(0, 4) : mesAno(mm)}</text>`; });
    for (const r of refs) svg += `<line x1="${m.e}" x2="${W - m.d}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="var(--texto-3)" stroke-width="1"${r.tracejado ? ' stroke-dasharray="4 3"' : ''}/>
      ${r.rotulo ? `<text x="${r.direita ? W - m.d - 4 : m.e + 4}" y="${Y(r.y) - 5}"${r.direita ? ' text-anchor="end"' : ''}>${esc(r.rotulo)}</text>` : ''}`;
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

function graficoColunas(el, { pontos, fmt, altura = 200, fmtEixo = null }) {
  const vals = pontos.map(p => p[1]).filter(ok);
  el.innerHTML = '';
  if (!vals.length) { el.innerHTML = '<p class="vazio">Sem dados.</p>'; return; }
  montarGrafico(el, w => {
    const esc_ = escalaBonita(Math.min(0, ...vals), Math.max(0, ...vals));
    const passo = esc_.marcas[1] - esc_.marcas[0];
    const rotY = v => compacto(v) ?? (fmtEixo ? fmtEixo(v) : num(v, casas(passo)));
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
