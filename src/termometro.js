// Termômetro do trimestre: dados setoriais públicos, publicados todo mês, que saem antes do balanço
// e antecipam a direção do resultado das ações acompanhadas.
//   Susep  prêmios e sinistros por grupo segurador (Porto, BB Seguros/Brasilseg, Caixa)  -> PSSA3, BBSE3, CXSE3
//   Anatel linhas móveis por operadora, pós e pré-pago (TIM, Vivo, Claro)                  -> TIMS3, VIVT3
//   ONS    carga de energia diária (Brasil e Sudeste/Centro-Oeste)                         -> elétricas
// Os arquivos da Susep (577 MB) e da Anatel (3,2 GB) são lidos aos pedaços (abrirZipRemoto) e só
// quando mudam (Last-Modified); a ONS publica um CSV pequeno por ano, atualizado todo dia.
// Tabela termometro: (fonte, chave, mês AAAA-MM, valor).
import { abrirZipRemoto, log } from './util.js';
import { transacao, marcarArquivo } from './db.js';

const URL_SUSEP = 'https://www2.susep.gov.br/redarq.asp?arq=BaseCompleta%2ezip';
const URL_ANATEL = 'https://www.anatel.gov.br/dadosabertos/paineis_de_dados/acessos/acessos_telefonia_movel.zip';
const URL_ONS = ano => `https://ons-aws-prod-opendata.s3.amazonaws.com/dataset/carga_energia_di/CARGA_ENERGIA_${ano}.csv`;
const UA = { 'user-agent': 'Mozilla/5.0' };

// Grupos econômicos da Susep (Ses_grupos_economicos.csv, coluna cogrupo). A composição muda ao longo do
// tempo (a Itaú Auto entrou na Porto em 2018), por isso o grupo de cada seguradora é lido mês a mês.
export const GRUPOS_SUSEP = {
  '00051': { chave: 'PORTO', nome: 'Grupo Porto (Porto, Azul, Itaú Auto)' },
  '01233': { chave: 'BBSEG', nome: 'BB Seguros (Brasilseg e Aliança do Brasil)' },
  '00230': { chave: 'CAIXA', nome: 'Caixa (Caixa Seguradora, Caixa Vida e Previdência, Youse)' },
};
// Grupos econômicos na base da Anatel
export const OPERADORAS = { 'TELECOM ITALIA': 'TIM', TELEFONICA: 'VIVO', 'TELECOM AMERICAS': 'CLARO' };
// Pós-pago "de pessoas", como as operadoras divulgam: sem M2M (máquinas) e pontos de serviço
const PRODUTOS_HUMANOS = new Set(['VOZ', 'DADOS', 'VOZ+DADOS']);

export function criarTabelaTermometro(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS termometro (
    fonte TEXT, chave TEXT, mes TEXT, valor REAL, PRIMARY KEY (fonte, chave, mes))`);
}

// Last-Modified com user-agent de navegador (a Anatel recusa clientes sem ele)
async function versaoRemota(db, url) {
  const r = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao consultar ${url}`);
  const modificado = r.headers.get('last-modified') ?? '';
  const salvo = db.prepare('SELECT modificado FROM arquivos WHERE url = ?').get(url)?.modificado;
  return { mudou: salvo !== modificado, modificado };
}

const numero = s => Number(String(s ?? '').replace(',', '.')) || 0;
const mesIso = aaaamm => `${aaaamm.slice(0, 4)}-${aaaamm.slice(4, 6)}`;

function gravar(db, fonte, valores) {
  const ins = db.prepare('INSERT OR REPLACE INTO termometro (fonte, chave, mes, valor) VALUES (?, ?, ?, ?)');
  transacao(db, () => { for (const [k, v] of valores) { const [chave, mes] = k.split('#'); ins.run(fonte, chave, mes, v); } });
  return valores.size;
}

// Susep: prêmio ganho, prêmio emitido e sinistro ocorrido por grupo e mês, desde dois anos atrás
async function atualizarSusep(db, desde) {
  const v = await versaoRemota(db, URL_SUSEP);
  if (!v.mudou) { log('Termômetro/Susep: sem versão nova'); return; }
  const zip = await abrirZipRemoto(URL_SUSEP);
  const grupos = await zip.texto('Ses_grupos_economicos.csv', 'utf8');
  const seguros = await zip.texto('Ses_seguros.csv', 'latin1');
  if (!grupos || !seguros) throw new Error('a base da Susep veio sem Ses_grupos_economicos.csv ou Ses_seguros.csv');
  const grupoDe = new Map();
  for (const l of grupos.split(/\r?\n/).slice(1)) {
    const c = l.split(';');
    if (c.length >= 4 && c[0] >= desde) grupoDe.set(`${c[0].trim()}|${c[1].trim()}`, c[3].trim());
  }
  const linhas = seguros.split('\n');
  const cab = linhas[0].trim().split(';');
  const col = nome => { const i = cab.indexOf(nome); if (i < 0) throw new Error(`Susep: coluna ${nome} sumiu`); return i; };
  const iPg = col('premio_ganho'), iPe = col('premio_emitido2'), iSo = col('sinistro_ocorrido');
  const soma = new Map();
  const somar = (k, x) => soma.set(k, (soma.get(k) ?? 0) + x);
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.slice(0, 6) < desde) continue;
    const c = l.split(';');
    const g = GRUPOS_SUSEP[grupoDe.get(`${c[0]}|${c[1]}`)];
    if (!g) continue;
    const mes = mesIso(c[0]);
    somar(`${g.chave}|premio_ganho#${mes}`, numero(c[iPg]));
    somar(`${g.chave}|premio_emitido#${mes}`, numero(c[iPe]));
    somar(`${g.chave}|sinistro#${mes}`, numero(c[iSo]));
  }
  if (soma.size < 30) throw new Error(`Susep: só ${soma.size} valores para os grupos acompanhados`);
  log(`Termômetro/Susep: ${gravar(db, 'susep', soma)} valores (até ${[...soma.keys()].map(k => k.split('#')[1]).sort().at(-1)})`);
  marcarArquivo(db, URL_SUSEP, v.modificado);
}

// Anatel: acessos por operadora e modalidade, nos arquivos resumidos por semestre (~4 MB cada)
async function atualizarAnatel(db, anoIni) {
  const v = await versaoRemota(db, URL_ANATEL);
  if (!v.mudou) { log('Termômetro/Anatel: sem versão nova'); return; }
  const zip = await abrirZipRemoto(URL_ANATEL);
  const arquivos = zip.nomes.filter(n => {
    const m = /^Acessos_Telefonia_Movel_(\d{4})_[12]S_Colunas\.csv$/.exec(n);
    return m && Number(m[1]) >= anoIni;
  });
  if (!arquivos.length) throw new Error('Anatel: nenhum arquivo semestral encontrado no zip');
  const soma = new Map();
  const somar = (k, x) => soma.set(k, (soma.get(k) ?? 0) + x);
  for (const nome of arquivos) {
    const linhas = (await zip.texto(nome, 'utf8')).replace(/^﻿/, '').split(/\r?\n/);
    const cab = linhas[0].split(';');
    const iG = cab.indexOf('Grupo Econômico'), iM = cab.indexOf('Modalidade de Cobrança'), iP = cab.indexOf('Tipo de Produto');
    const meses = cab.map((c, i) => [c, i]).filter(([c]) => /^\d{4}-\d{2}$/.test(c));
    if (iG < 0 || iM < 0 || iP < 0 || !meses.length) throw new Error(`Anatel: formato inesperado em ${nome}`);
    for (let i = 1; i < linhas.length; i++) {
      const c = linhas[i].split(';');
      if (c.length < cab.length) continue;
      const mod = c[iM] === 'Pós-pago' ? 'pos' : c[iM] === 'Pré-pago' ? 'pre' : null;
      if (!mod) continue;
      // Pós-pago só "de pessoas"; o pré-pago é todo de pessoas
      if (mod === 'pos' && !PRODUTOS_HUMANOS.has(c[iP])) continue;
      const op = OPERADORAS[c[iG]];
      for (const [mes, j] of meses) {
        const x = Number(c[j]) || 0;
        somar(`TOTAL|${mod}#${mes}`, x);
        if (op) somar(`${op}|${mod}#${mes}`, x);
      }
    }
  }
  log(`Termômetro/Anatel: ${gravar(db, 'anatel', soma)} valores de ${arquivos.length} semestres`);
  marcarArquivo(db, URL_ANATEL, v.modificado);
}

// ONS: carga média mensal (MWmed) do Brasil (soma dos subsistemas) e do Sudeste/Centro-Oeste
async function atualizarOns(db, anoIni) {
  const anoFim = new Date().getFullYear();
  const jaTem = new Set(db.prepare("SELECT DISTINCT substr(mes, 1, 4) a FROM termometro WHERE fonte = 'ons'").all().map(r => r.a));
  const soma = new Map(), dias = new Map();
  for (let ano = anoIni; ano <= anoFim; ano++) {
    // Anos fechados que já estão na base não mudam; o ano corrente é relido todo dia
    if (ano < anoFim && jaTem.has(String(ano))) continue;
    const r = await fetch(URL_ONS(ano), { headers: UA, signal: AbortSignal.timeout(60000) });
    if (r.status === 404 || r.status === 403) continue;
    if (!r.ok) throw new Error(`ONS ${ano}: HTTP ${r.status}`);
    const linhas = (await r.text()).split(/\r?\n/);
    const cab = linhas[0].split(';');
    const iS = cab.indexOf('id_subsistema'), iD = cab.indexOf('din_instante'), iV = cab.indexOf('val_cargaenergiamwmed');
    if (iS < 0 || iD < 0 || iV < 0) throw new Error(`ONS ${ano}: formato inesperado`);
    for (let i = 1; i < linhas.length; i++) {
      const c = linhas[i].split(';');
      if (c.length < cab.length) continue;
      const mes = c[iD].slice(0, 7), x = Number(c[iV]) || 0;
      soma.set(`SIN|carga#${mes}`, (soma.get(`SIN|carga#${mes}`) ?? 0) + x);
      if (c[iS] === 'SE') soma.set(`SE|carga#${mes}`, (soma.get(`SE|carga#${mes}`) ?? 0) + x);
      // dias por mês, contados uma vez (pelo subsistema Sudeste)
      if (c[iS] === 'SE') dias.set(mes, (dias.get(mes) ?? 0) + 1);
    }
  }
  // De soma diária para média do mês; guarda também quantos dias o mês já tem (o corrente está incompleto)
  const medias = new Map();
  for (const [k, v] of soma) { const mes = k.split('#')[1]; if (dias.get(mes)) medias.set(k, v / dias.get(mes)); }
  for (const [mes, n] of dias) medias.set(`DIAS|n#${mes}`, n);
  if (medias.size) log(`Termômetro/ONS: ${gravar(db, 'ons', medias)} valores`);
}

// Cada fonte isolada: se uma estiver fora do ar, as outras seguem (o erro sobe no fim para o aviso)
export async function atualizarTermometro(db) {
  criarTabelaTermometro(db);
  const ano = new Date().getFullYear();
  const erros = [];
  for (const [nome, fn] of [
    ['Susep', () => atualizarSusep(db, `${ano - 3}01`)],
    ['Anatel', () => atualizarAnatel(db, ano - 2)],
    ['ONS', () => atualizarOns(db, ano - 2)],
  ]) {
    try { await fn(); } catch (e) { erros.push(`${nome}: ${e.message}`); log(`Termômetro/${nome} falhou:`, e.message); }
  }
  if (erros.length) throw new Error(erros.join(' | '));
}

// ---------- Indicadores para a página ----------
// Para cada série: últimos 25 meses e um sinal do trimestre em curso contra o mesmo período do ano anterior.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = m => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const anoAntes = m => `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
const trimestre = m => `${Math.ceil(Number(m.slice(5, 7)) / 3)}T${m.slice(2, 4)}`;
// Meses do trimestre de `ref` até ele (ref 2026-08 -> 2026-07, 2026-08)
const mesesDoTrimestre = ref => {
  const mes = Number(ref.slice(5, 7)), ini = mes - ((mes - 1) % 3);
  return Array.from({ length: mes - ini + 1 }, (_, i) => `${ref.slice(0, 4)}-${String(ini + i).padStart(2, '0')}`);
};
const r4 = x => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);

export function montarTermometro(db) {
  criarTabelaTermometro(db);
  const linhas = db.prepare('SELECT fonte, chave, mes, valor FROM termometro ORDER BY mes').all();
  if (!linhas.length) return null;
  const serie = new Map();
  for (const l of linhas) {
    const k = `${l.fonte}:${l.chave}`;
    if (!serie.has(k)) serie.set(k, new Map());
    serie.get(k).set(l.mes, l.valor);
  }
  const s = k => serie.get(k) ?? new Map();
  const ultimoMes = k => [...s(k).keys()].sort().at(-1);
  const somaMeses = (k, meses) => { let t = 0; for (const m of meses) { const v = s(k).get(m); if (v == null) return null; t += v; } return t; };
  const ultimos = (k, n = 25) => [...s(k).keys()].sort().slice(-n);

  const sinais = {}, graficos = {};
  // Direção: 1 melhora, -1 piora, 0 estável (limites por indicador)
  const direcao = (x, bom, ruim) => (x == null ? 0 : x >= bom ? 1 : x <= ruim ? -1 : 0);

  // Seguradoras: prêmio ganho e sinistralidade do trimestre até o último mês publicado
  for (const g of Object.values(GRUPOS_SUSEP)) {
    const kp = `susep:${g.chave}|premio_ganho`, ks = `susep:${g.chave}|sinistro`, ke = `susep:${g.chave}|premio_emitido`;
    const ref = ultimoMes(kp);
    if (!ref) continue;
    const meses = mesesDoTrimestre(ref), antes = meses.map(anoAntes);
    const pg = somaMeses(kp, meses), pgA = somaMeses(kp, antes);
    const pe = somaMeses(ke, meses), peA = somaMeses(ke, antes);
    const sin = pg ? somaMeses(ks, meses) / pg : null, sinA = pgA ? somaMeses(ks, antes) / pgA : null;
    const cresc = pg && pgA ? pg / pgA - 1 : null, crescE = pe && peA ? pe / peA - 1 : null;
    const itens = [
      { rotulo: 'Prêmio ganho', valor: pg, formato: 'dinheiro', variacao: r4(cresc), dir: direcao(cresc, 0.02, -0.02),
        texto: 'receita de seguros reconhecida no período' },
      { rotulo: 'Prêmio emitido (vendas)', valor: pe, formato: 'dinheiro', variacao: r4(crescE), dir: direcao(crescE, 0.02, -0.02),
        texto: 'seguros vendidos no período; antecipa o prêmio ganho dos próximos meses' },
      { rotulo: 'Sinistralidade', valor: r4(sin), formato: 'pct', antes: r4(sinA), pp: r4(sin != null && sinA != null ? sin - sinA : null),
        dir: sin != null && sinA != null ? direcao(sinA - sin, 0.01, -0.01) : 0, texto: 'sinistros ÷ prêmio ganho; quanto menor, melhor' },
    ];
    sinais[`susep:${g.chave}`] = { fonte: 'Susep', nome: g.nome, ref, periodo: `${trimestre(ref)} até ${rotuloMes(ref)}`, itens };
    const ms = ultimos(kp);
    graficos[`susep:${g.chave}`] = { meses: ms, premio: ms.map(m => Math.round(s(kp).get(m) ?? 0)),
      sinistralidade: ms.map(m => r4((s(ks).get(m) ?? 0) / (s(kp).get(m) || NaN))) };
  }

  // Operadoras: linhas pós-pago (de pessoas) e participação no pós-pago contra um ano antes
  for (const op of Object.values(OPERADORAS)) {
    const kpos = `anatel:${op}|pos`, kpre = `anatel:${op}|pre`;
    const ref = ultimoMes(kpos);
    if (!ref) continue;
    const ant = anoAntes(ref);
    const pos = s(kpos).get(ref), posA = s(kpos).get(ant), pre = s(kpre).get(ref), preA = s(kpre).get(ant);
    const tot = s('anatel:TOTAL|pos'), share = tot.get(ref) ? pos / tot.get(ref) : null, shareA = tot.get(ant) ? posA / tot.get(ant) : null;
    const cPos = pos && posA ? pos / posA - 1 : null, cPre = pre && preA ? pre / preA - 1 : null;
    sinais[`anatel:${op}`] = { fonte: 'Anatel', nome: { TIM: 'TIM', VIVO: 'Vivo (Telefônica)', CLARO: 'Claro' }[op], ref,
      periodo: `${rotuloMes(ref)} contra ${rotuloMes(ant)}`, itens: [
        { rotulo: 'Linhas pós-pago', valor: pos, formato: 'milhoes', variacao: r4(cPos), dir: direcao(cPos, 0.03, 0),
          texto: 'clientes de conta, que pagam mais; sem chips de máquinas (M2M)' },
        { rotulo: 'Participação no pós-pago', valor: r4(share), formato: 'pct', antes: r4(shareA),
          pp: r4(share != null && shareA != null ? share - shareA : null), dir: direcao(share != null && shareA != null ? share - shareA : null, 0.003, -0.003),
          texto: 'fatia das linhas pós-pago do país' },
        { rotulo: 'Linhas pré-pago', valor: pre, formato: 'milhoes', variacao: r4(cPre), dir: 0,
          texto: 'o pré-pago encolhe no país inteiro com a migração para o pós; serve de contexto' },
      ] };
    const ms = ultimos(kpos);
    graficos[`anatel:${op}`] = { meses: ms, pos: ms.map(m => s(kpos).get(m) ?? null),
      share: ms.map(m => r4(tot.get(m) ? (s(kpos).get(m) ?? 0) / tot.get(m) : null)) };
  }

  // Energia: carga média do trimestre até o último mês completo, Brasil e Sudeste/Centro-Oeste
  const dias = s('ons:DIAS|n');
  const completos = [...dias.keys()].sort().filter(m => {
    const fim = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    return dias.get(m) >= fim;
  });
  const refOns = completos.at(-1);
  if (refOns) {
    const meses = mesesDoTrimestre(refOns), antes = meses.map(anoAntes);
    const media = (k, ms) => { const t = somaMeses(k, ms); return t == null ? null : t / ms.length; };
    const itens = [['SIN', 'Brasil (SIN)'], ['SE', 'Sudeste/Centro-Oeste']].map(([k, rot]) => {
      const a = media(`ons:${k}|carga`, meses), b = media(`ons:${k}|carga`, antes);
      const c = a && b ? a / b - 1 : null;
      return { rotulo: `Consumo de energia: ${rot}`, valor: a, formato: 'mwmed', variacao: r4(c), dir: direcao(c, 0.015, -0.01),
        texto: 'carga média em MW médios; mais consumo, mais energia distribuída' };
    });
    sinais['ons:SIN'] = { fonte: 'ONS', nome: 'Operador Nacional do Sistema Elétrico', ref: refOns,
      periodo: `${trimestre(refOns)} até ${rotuloMes(refOns)}`, itens };
    const ms = completos.slice(-25);
    graficos['ons:SIN'] = { meses: ms, sin: ms.map(m => Math.round(s('ons:SIN|carga').get(m) ?? 0)), se: ms.map(m => Math.round(s('ons:SE|carga').get(m) ?? 0)) };
  }

  // Quem usa cada série: pelo prefixo do código de negociação; elétricas pelo setor (na página)
  const porCodigo = { PSSA: 'susep:PORTO', BBSE: 'susep:BBSEG', CXSE: 'susep:CAIXA', TIMS: 'anatel:TIM', VIVT: 'anatel:VIVO' };
  return { sinais, graficos, porCodigo, energia: 'ons:SIN' };
}
