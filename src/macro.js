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

// Focus: o que os economistas consultados pelo Banco Central esperam para a Selic e o IPCA nos próximos
// anos. A Selic não fica no patamar de hoje para sempre; a comparação entre CDB (pós) e Tesouro (travado)
// usa o caminho esperado. baseCalculo 0 = todas as respostas dos últimos 30 dias.
export async function atualizarFocus(db) {
  const q = new URLSearchParams({
    $top: '300', $format: 'json', $orderby: 'Data desc',
    $filter: "(Indicador eq 'Selic' or Indicador eq 'IPCA') and baseCalculo eq 0",
    $select: 'Indicador,Data,DataReferencia,Mediana',
  });
  const url = `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?${q.toString().replace(/\+/g, '%20')}`;
  let resp;
  for (let i = 1; i <= 4; i++) {
    resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (resp.status < 500) break;
    await new Promise(r => setTimeout(r, 3000 * i));
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const dados = (await resp.json()).value ?? [];
  const ins = db.prepare('INSERT OR REPLACE INTO expectativas (indicador, data, ano, mediana) VALUES (?, ?, ?, ?)');
  transacao(db, () => { for (const r of dados) ins.run(r.Indicador, r.Data, Number(r.DataReferencia), r.Mediana); });
  log(`Focus: ${dados.length} expectativas (última pesquisa ${dados[0]?.Data ?? '?'})`);
}

// Página do Tesouro Direto: só responde a navegador. "resgatar" traz todos os títulos; "investir", só os que estão à venda.
async function paginaTesouro(lista) {
  const resp = await fetch(`https://www.tesourodireto.com.br/o/rentabilidade/${lista}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', accept: 'application/json' },
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return Object.values(await resp.json()).flat();
}
// "Tesouro IPCA+ 2050" -> tipo "Tesouro IPCA+", como na tabela. O vencimento vem do campo próprio: no Educa+ e
// no Renda+ o ano do nome é o do começo dos pagamentos, não o do vencimento.
const tituloDaPagina = t => {
  const m = /^(.*) (\d{4})$/.exec(t?.treasuryBondName ?? '');
  return m && t.maturityDate ? { tipo: m[1], vencimento: t.maturityDate.slice(0, 10) } : null;
};

// Quais títulos estão à venda: a lista de compra da página do Tesouro Direto. O arquivo oficial traz taxa de
// compra até para título que só pode ser resgatado (em 23/11/2026, o IPCA+ 2029, o 2035 e o 2045), e sem esta
// lista a página do comparador mostra todos do mesmo jeito. Fica em meta, com a data do último preço.
export async function atualizarOfertaTesouro(db) {
  const lista = await paginaTesouro('investir');
  const titulos = [...new Set(lista.map(tituloDaPagina).filter(Boolean).map(t => `${t.tipo}|${t.vencimento}`))].sort();
  const data = lista.map(t => t.lastMarketPricingDate?.slice(0, 10)).filter(Boolean).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  // Em dia normal são mais de 30. Com a negociação suspensa (em 24/11/2026 sobraram só os Tesouro Selic) a lista
  // encolhe: lista curta, ou bem menor que uma anterior ainda recente, não troca a que está guardada. Passados
  // 5 dias a comparação deixa de valer, para uma mudança de verdade na oferta não ficar travada para sempre.
  let anterior = null;
  try { anterior = JSON.parse(db.prepare("SELECT valor FROM meta WHERE chave = 'tesouro_oferta'").get()?.valor ?? 'null'); } catch { /* valor estragado: vale só o mínimo */ }
  const recente = anterior && Date.parse(data) - Date.parse(anterior.data) <= 5 * 86400000;
  const minimo = Math.max(10, recente ? Math.ceil(0.8 * anterior.titulos.length) : 0);
  if (titulos.length < minimo) throw new Error(`a lista de compra veio com ${titulos.length} títulos; negociação suspensa?`);
  db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES ('tesouro_oferta', ?)").run(JSON.stringify({ data, titulos }));
  return titulos.length;
}

// Reserva para quando o arquivo do Tesouro Transparente não baixa: a página do próprio Tesouro Direto.
// De 21/11/2026 em diante o Tesouro Transparente passou a recusar conexões dos servidores do GitHub.
// A página só traz o dia do último preço, sem histórico. O que entra por aqui nunca troca uma linha que já
// existe, e é trocado pelas taxas oficiais da manhã quando o arquivo volta (INSERT OR REPLACE lá embaixo).
export async function tesouroPeloSite(db) {
  const lista = await paginaTesouro('resgatar');
  // "IPCA + 7,53%", "15,33%", "SELIC + 0,1085%" -> o número; "IPCA", "SELIC" e "prefixado" (sem oferta) -> nada
  const taxaDe = s => { const m = /(\d+(?:,\d+)?)\s*%/.exec(s ?? ''); return m ? Number(m[1].replace(',', '.')) : null; };
  // Só os tipos que o arquivo oficial já trouxe: o nome precisa bater com o da tabela
  const tipos = new Set(db.prepare('SELECT DISTINCT titulo FROM tesouro').all().map(r => r.titulo));
  const titulos = lista.map(t => {
    const m = tituloDaPagina(t);
    if (!m || !tipos.has(m.tipo) || !t.lastMarketPricingDate) return null;
    return { ...m, data: t.lastMarketPricingDate.slice(0, 10),
      compra: taxaDe(t.investmentProfitabilityIndexerName), resgate: taxaDe(t.redemptionProfitabilityFeeIndexerName),
      pu: t.unitaryRedemptionValue > 0 ? t.unitaryRedemptionValue : null };
  }).filter(Boolean);
  if (!titulos.length) throw new Error('a página do Tesouro Direto veio sem títulos');
  // Negociação suspensa: a página some com os títulos parados (em 24/11/2026, às 9h45, ficaram só os Tesouro
  // Selic). Gravar esse dia pela metade deixaria a página do comparador só com eles e sem a taxa do IPCA+ que
  // serve de régua para as ações. Faltando mais de 10% dos títulos de um dia normal, nada é gravado: o site
  // segue com o último dia completo e a leitura seguinte, com a negociação reaberta, traz o dia inteiro.
  const normal = db.prepare('SELECT max(n) n FROM (SELECT count(*) n FROM tesouro GROUP BY data ORDER BY data DESC LIMIT 10)').get().n ?? 0;
  const data = titulos.map(t => t.data).sort().at(-1);
  if (titulos.length < Math.ceil(0.9 * normal)) return { n: 0, data, suspensa: true, achados: titulos.length, normal };
  // Título fora de oferta só tem a taxa de resgate. A de compra, que é a que a tabela guarda, sai dela menos
  // a diferença que os títulos do mesmo tipo em oferta mostram no dia (0,12 ponto nos IPCA+ e prefixados)
  const diferenca = tipo => {
    const d = titulos.filter(t => t.tipo === tipo && t.compra != null && t.resgate != null).map(t => t.resgate - t.compra).sort((a, b) => a - b);
    return d.length ? d[d.length >> 1] : 0;
  };
  const ins = db.prepare('INSERT OR IGNORE INTO tesouro (titulo, vencimento, data, taxa, pu) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  transacao(db, () => {
    for (const t of titulos) {
      const taxa = t.compra ?? (t.resgate != null ? Math.round((t.resgate - diferenca(t.tipo)) * 10000) / 10000 : null);
      if (taxa == null && t.pu == null) continue;
      n += Number(ins.run(t.tipo, t.vencimento, t.data, taxa, t.pu).changes);
    }
  });
  return { n, data };
}

// Taxas e, depois, a lista do que está à venda. A lista é um complemento: se ela falhar, as taxas já entraram
// e a etapa não cai; vale a lista anterior, que a exportação deixa de usar quando fica velha.
export async function atualizarTesouro(db, anoInicio) {
  await atualizarTaxasTesouro(db, anoInicio);
  try { log(`Tesouro: ${await atualizarOfertaTesouro(db)} títulos à venda`); }
  catch (e) { log(`Tesouro: lista de títulos à venda não atualizada (${e.message}); vale a anterior`); }
}

async function atualizarTaxasTesouro(db, anoInicio) {
  const url = 'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';
  let arq;
  try {
    arq = await baixar(url, 'tesouro/PrecoTaxaTesouroDireto.csv', { forcar: true });
  } catch (e) {
    // Arquivo oficial fora do ar: vale a página do Tesouro Direto. Se ela também falhar, a etapa falha.
    let reserva;
    try { reserva = await tesouroPeloSite(db); }
    catch (e2) { throw new Error(`${e.message}; a reserva (página do Tesouro Direto) também falhou: ${e2.message}`); }
    const motivo = e.message.split(': ').at(-1);
    if (reserva.suspensa) log(`Tesouro: arquivo oficial fora do ar (${motivo}); a página do Tesouro Direto está com ${reserva.achados} de ${reserva.normal} títulos (negociação suspensa?), nada gravado`);
    else log(`Tesouro: arquivo oficial fora do ar (${motivo}); pela página do Tesouro Direto, ${reserva.n} taxas novas, preços de ${br(reserva.data)}`);
    return;
  }
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
