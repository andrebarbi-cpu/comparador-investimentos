// Notícias ligadas às ações acompanhadas e ao mercado, para explicar quedas e altas.
//   Fonte principal: busca do Google Notícias por RSS (traz o nome do veículo e a data de cada notícia).
//   Reserva: busca dos próprios portais (WordPress: ?s=TICKER&feed=rss2), se o Google falhar.
// Regra de confiança: um fato só conta como "confirmado" quando dois ou mais veículos reconhecidos
// publicam o mesmo tema no mesmo dia. Uma fonte sozinha aparece marcada como não confirmada (em 10/2026,
// um título dizia "Porto Seguro pede cancelamento de registro" quando quem pediu foi a controlada Porto Serviço).
// Só título, veículo, data e link são guardados: nada do texto das notícias.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log, RAIZ } from './util.js';

const DIAS_GUARDAR = 180;
const DIAS_EXPORTAR = 45;
const AGENTE = 'Mozilla/5.0 (compatible; ComparadorInvestimentos/1.0)';

// Veículos que contam para confirmar um fato (nomes como o Google Notícias mostra, sem acento e minúsculos)
const RECONHECIDOS = ['infomoney', 'valor', 'pipeline', 'money times', 'estadao', 'e-investidor', 'exame', 'folha', 'o globo',
  'g1', 'cnn brasil', 'bloomberg', 'reuters', 'seu dinheiro', 'investnews', 'bpmoney', 'bp money', 'suno', 'investing.com',
  'brazil journal', 'neofeed', 'uol', 'poder360', 'advfn', 'veja', 'istoe dinheiro', 'forbes', 'times brasil', 'cnbc',
  'the shift', 'mover', 'agencia brasil', 'broadcast', 'genial', 'xp', 'btg'];
const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const reconhecido = fonte => { const f = ` ${semAcento(fonte ?? '').replace(/[^a-z0-9.]+/g, ' ')} `; return RECONHECIDOS.some(r => f.includes(` ${r.replace(/-/g, ' ')} `)); };

// Tema pelo título; a ordem importa (o primeiro que casar vale)
const TEMAS = [
  ['resultado', /lucr|preju[ií]z|balan[cç]o|resultado|trimestr|\b[1-4]t\d{2}\b|receita|ebitda|guidance|proje[cç][oõ]es/i],
  ['dividendos', /dividend|\bjcp\b|juros sobre (o )?capital|provento|bonifica|recompra/i],
  ['recomendação', /recomenda|pre[cç]o-alvo|rebaix|corta (a )?(nota|alvo)|eleva (o )?(alvo|pre[cç]o)|outperform|underperform|overweight|underweight|neutr[oa]\b|rating/i],
  ['operação societária', /aquisi[cç]|fus[aã]o|incorpora|\bopa\b|\bipo\b|follow-on|oferta de a[cç]|venda de (participa|ativo|fatia)|compra (de )?fatia|cancelamento de registro|reorganiza|\bcis[aã]o/i],
  ['regulação e justiça', /\bcvm\b|susep|\bans\b|aneel|anatel|\bcade\b|ag[eê]ncia reguladora|regula|\btcu\b|\bstf\b|tribunal|justi[cç]a|multa|processo|concess/i],
  ['fiscal e política', /fiscal|arcabou[cç]o|haddad|\blula\b|governo|congresso|c[aâ]mara|senado|elei[cç]|imposto|tribut|\biof\b|or[cç]amento|gastos|precat[oó]rio|ministro|presidente da rep/i],
  ['juros e inflação', /selic|copom|juros|infla[cç]|\bipca\b|banco central|\bfed\b|treasur|powell|galípolo|galipolo/i],
  ['exterior', /\beua\b|estados unidos|trump|china|tarifa|wall street|europa|guerra|s&p|nasdaq|dow jones/i],
  ['commodities', /petr[oó]leo|brent|min[eé]rio|commodit|soja|ouro/i],
  ['câmbio', /d[oó]lar|c[aâ]mbio|real se/i],
];
// Listas de várias empresas ("ações para acompanhar", "e mais 8 ações"): não explicam o movimento de uma só
const RESUMO = /a[cç][oõ]es para (acompanhar|ter|comprar|investir)|coisas para saber|o que (mexe|movimenta)|agenda do dia|destaques do dia|maiores altas|maiores quedas|abre o dia|fique de olho|e mais \d+ a[cç][oõ]es|veja os destaques|carteira recomendada/i;
// Páginas de cotação (não são notícia)
const NAO_NOTICIA = /cota[cç][aã]o e indicadores|cota[cç][aã]o,? (hist[oó]rico|gr[aá]fico)|^[A-Z]{4}\d{1,2}\s*-\s/;
export function temaDe(titulo) {
  if (RESUMO.test(titulo)) return 'resumo';
  return TEMAS.find(([, re]) => re.test(titulo))?.[0] ?? 'outros';
}
// Mercado: uma manchete costuma citar vários motivos ("payroll, queda das techs e fiscal"); vale cada um
const TEMAS_MERCADO = ['fiscal e política', 'juros e inflação', 'exterior', 'commodities', 'câmbio', 'resultado'];
export function temasMercado(titulo) {
  const achados = TEMAS_MERCADO.filter(t => TEMAS.find(([n]) => n === t)[1].test(titulo));
  return achados.length ? achados : ['outros'];
}

// Nomes pelos quais a imprensa chama cada empresa (o código nem sempre está no título)
const APELIDOS = {
  PSSA: ['porto'], TIMS: ['tim'], BBSE: ['bb seguridade'], BBAS: ['banco do brasil'], BBDC: ['bradesco'], ITSA: ['itausa'],
  CPFE: ['cpfl'], SAPR: ['sanepar'], ALUP: ['alupar'], POMO: ['marcopolo'], CXSE: ['caixa seguridade'], BPAC: ['btg'],
  VIVT: ['vivo', 'telefonica'], MDIA: ['m. dias', 'm.dias', 'dias branco'], VALE: ['vale'], AXIA: ['axia', 'eletrobras'],
  PETR: ['petrobras'], ITUB: ['itau'], SBSP: ['sabesp'], WEGE: ['weg'], ABEV: ['ambev'],
};
const GENERICAS = new Set(['banco', 'cia', 'companhia', 'grupo', 'brasil', 'brasileira', 'centrais', 'energia', 'industria', 'empresa', 'participacoes']);
function palavrasDe(tk, nome) {
  const prefixo = tk.slice(0, 4).toLowerCase();
  const partes = semAcento(nome ?? '').split(' - ').map(p => p.replace(/\b(s\.?\/?a\.?|participacoes|part\.?|holding)\b/g, ' ').replace(/[^a-z0-9. ]+/g, ' ').trim()).filter(Boolean);
  const primeiras = partes.map(p => p.split(' ')[0]).filter(w => w.length >= 4 && !GENERICAS.has(w));
  return [...new Set([prefixo, ...(APELIDOS[tk.slice(0, 4)] ?? []), ...partes.filter(p => p.length >= 5), ...primeiras])];
}
const cita = (titulo, palavras) => {
  const t = ` ${semAcento(titulo).replace(/[^a-z0-9.]+/g, ' ')} `;
  return palavras.some(p => t.includes(` ${p} `) || (p.length === 4 && new RegExp(` ${p}\\d{1,2} `).test(t)));
};
const veiculo = fonte => (fonte ?? '').split(' - ')[0].trim();

// Dia em Brasília (UTC-3) de uma data qualquer
const diaBr = ms => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);
const limpar = s => (s ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&#8220;|&#8221;|&quot;/g, '"')
  .replace(/&#8211;|&#8212;/g, '-').replace(/&#8216;|&#8217;|&#039;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tag = (x, t) => limpar((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);

async function lerRss(url) {
  const r = await fetch(url, { headers: { 'user-agent': AGENTE }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const x = m[1];
    let titulo = tag(x, 'title'), fonte = tag(x, 'source');
    // O Google Notícias põe " - Veículo" no fim do título
    if (fonte && titulo.endsWith(` - ${fonte}`)) titulo = titulo.slice(0, -(fonte.length + 3)).trim();
    const ms = Date.parse(tag(x, 'pubDate'));
    return { titulo, fonte, link: tag(x, 'link'), ms };
  }).filter(n => n.titulo && Number.isFinite(n.ms));
}

const googleNoticias = termo => `https://news.google.com/rss/search?q=${encodeURIComponent(`${termo} when:7d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
// Reserva: busca dos portais (o nome do veículo vem daqui, porque o feed do portal não traz <source>)
const PORTAIS = [['InfoMoney', 'https://www.infomoney.com.br'], ['Money Times', 'https://www.moneytimes.com.br'],
  ['BP Money', 'https://www.bpmoney.com.br'], ['InvestNews', 'https://investnews.com.br']];

async function buscar(termo) {
  try {
    const itens = await lerRss(googleNoticias(termo));
    if (itens.length) return { itens, via: 'google' };
  } catch (e) { log(`Notícias (Google) "${termo}": ${e.message}`); }
  const itens = [];
  for (const [nome, base] of PORTAIS) {
    try { itens.push(...(await lerRss(`${base}/?s=${encodeURIComponent(termo)}&feed=rss2`)).map(n => ({ ...n, fonte: nome }))); }
    catch { /* portal fora do ar: segue com os outros */ }
  }
  return { itens, via: 'portais' };
}

export function criarTabelaNoticias(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS noticias (
    chave TEXT, id TEXT, data TEXT, hora TEXT, fonte TEXT, titulo TEXT, link TEXT, tema TEXT,
    PRIMARY KEY (chave, id))`);
}

// Quais códigos buscar: carteira, acompanhados e as ações líquidas que mais se mexeram no último pregão
function codigosParaBuscar(db, config) {
  const carteira = (config.carteiras ?? []).flatMap(c => c.acoes ?? []);
  const acompanhar = config.agenda_resultados?.acompanhar ?? [];
  let movidas = [];
  try {
    movidas = db.prepare(`
      WITH ult AS (SELECT ticker, data, fechamento,
        LAG(fechamento) OVER (PARTITION BY ticker ORDER BY data) ant,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY data DESC) rn
        FROM cotacoes WHERE data >= date('now', '-10 day'))
      SELECT u.ticker, u.fechamento / u.ant - 1 v FROM ult u JOIN indicadores i ON i.ticker = u.ticker
      WHERE u.rn = 1 AND u.ant > 0 AND i.liquidez >= 20e6 AND u.data >= date('now', '-4 day')
        AND abs(u.fechamento / u.ant - 1) >= 0.04
      ORDER BY abs(u.fechamento / u.ant - 1) DESC LIMIT 12`).all().map(r => r.ticker);
  } catch { /* primeira execução, sem indicadores ainda */ }
  let nomes = new Map();
  try {
    for (const r of db.prepare('SELECT nome, tickers FROM indicadores').all())
      for (const t of (r.tickers ?? '').split(' ')) nomes.set(t, r.nome);
  } catch { /* sem indicadores: só o código e os apelidos */ }
  return [...new Set([...carteira, ...acompanhar, ...movidas])].map(tk => ({ tk, palavras: palavrasDe(tk, nomes.get(tk)) }));
}

export async function atualizarNoticias(db) {
  const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'carteiras.json'), 'utf8'));
  criarTabelaNoticias(db);
  const ins = db.prepare(`INSERT OR IGNORE INTO noticias (chave, id, data, hora, fonte, titulo, link, tema) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  // Mercado: as notícias do Ibovespa e do dólar trazem o motivo do dia (fiscal, juros, exterior...)
  const buscas = [['MERCADO', 'Ibovespa', null], ['MERCADO', 'dólar hoje', null],
    ...codigosParaBuscar(db, config).map(({ tk, palavras }) => [tk, `"${tk}"`, palavras])];
  let novas = 0, viaPortais = 0, falhas = 0;
  for (const [chave, termo, palavras] of buscas) {
    const { itens, via } = await buscar(termo);
    if (via === 'portais') viaPortais++;
    if (!itens.length) falhas++;
    for (const n of itens) {
      if (NAO_NOTICIA.test(n.titulo)) continue;
      // Na busca por código, o título precisa citar a empresa (o código, o nome ou o apelido):
      // o Google também devolve notícias que só mencionam o código no meio do texto
      if (palavras && !cita(n.titulo, palavras)) continue;
      const fonte = veiculo(n.fonte) || 'portal';
      const id = `${semAcento(fonte)}|${semAcento(n.titulo).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 90)}`;
      const temas = chave === 'MERCADO' ? temasMercado(n.titulo) : [temaDe(n.titulo)];
      for (const tema of temas) {
        const r = ins.run(chave, temas.length > 1 ? `${id}|${tema}` : id, diaBr(n.ms), new Date(n.ms).toISOString().slice(11, 16), fonte, n.titulo, n.link, tema);
        novas += r.changes;
      }
    }
    await new Promise(res => setTimeout(res, 350));
  }
  db.prepare(`DELETE FROM noticias WHERE data < date('now', '-${DIAS_GUARDAR} day')`).run();
  log(`Notícias: ${buscas.length} buscas, ${novas} novas${viaPortais ? `, ${viaPortais} pela reserva dos portais` : ''}${falhas ? `, ${falhas} sem resultado` : ''}`);
  if (falhas === buscas.length) throw new Error('nenhuma busca de notícias respondeu');
}

// Agrupa as notícias de cada código por dia e tema: um "fato" com a lista de veículos que o publicaram.
//   { CHAVE: [{ d, tema, titulo, link, fontes: [[veículo, link]], conf: veículos reconhecidos }] }
export function montarNoticias(db) {
  try { criarTabelaNoticias(db); } catch { return {}; }
  const saida = {};
  const linhas = db.prepare(`SELECT * FROM noticias WHERE data >= date('now', '-${DIAS_EXPORTAR} day') ORDER BY chave, data DESC, hora`).all();
  const grupos = new Map();
  for (const n of linhas) {
    const k = `${n.chave}|${n.data}|${n.tema}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(n);
  }
  for (const itens of grupos.values()) {
    const { chave, data: d, tema } = itens[0];
    const porFonte = new Map();
    for (const n of itens) if (!porFonte.has(n.fonte)) porFonte.set(n.fonte, n);
    const fontes = [...porFonte.values()].sort((a, b) => reconhecido(b.fonte) - reconhecido(a.fonte));
    const principal = fontes[0];
    (saida[chave] ??= []).push({
      d, tema, titulo: principal.titulo, link: principal.link,
      fontes: fontes.slice(0, 4).map(n => [n.fonte, n.link]), conf: fontes.filter(n => reconhecido(n.fonte)).length,
    });
  }
  // Por código: mais recente primeiro; no mesmo dia, o fato com mais veículos primeiro
  const PESO = { resumo: -1, outros: 0 };
  for (const k of Object.keys(saida)) {
    saida[k].sort((a, b) => b.d.localeCompare(a.d) || (PESO[b.tema] ?? 1) - (PESO[a.tema] ?? 1) || b.conf - a.conf);
    saida[k] = saida[k].slice(0, k === 'MERCADO' ? 40 : 20);
  }
  return saida;
}
