// Resultado no dia da entrega: baixa o próprio ITR que a empresa entregou ao sistema ENET da CVM e grava
// os números na tabela fundamentos, no mesmo formato dos arquivos abertos da CVM. Sem isso, entre a
// divulgação e o domingo (quando a CVM regenera os arquivos abertos) o site seguia com o trimestre
// anterior: P/L, lucro e notas da Porto e da BB Seguridade ficavam uma semana atrasados.
// Quando o arquivo aberto da CVM chegar no domingo, ele substitui estes números (mesma chave).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { abrirZip, log, BRUTOS } from './util.js';
import { transacao } from './db.js';
import { extrairCampos } from './cvm.js';
import { criarTabelaEntregas } from './entregas.js';

const URL_DOC = (seq, versao, protocolo) => `https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&numSequencia=${seq}`
  + `&numVersao=${versao}&numProtocolo=${encodeURIComponent(protocolo)}&descTipo=ITR&CodigoInstituicao=1`;
// Seções do XML do ITR -> demonstração no padrão dos arquivos abertos (cvm.js)
const SECOES = { BalancoPatrimonialAtivo: 'BPA', BalancoPatrimonialPassivo: 'BPP', DemonstracaoResultado: 'DRE',
  DemonstracaoFluxoCaixa: 'DFC', DemonstracaoValorAdicionado: 'DVA' };
const dataIso = br => (/^(\d\d)\/(\d\d)\/(\d{4})$/.exec(br ?? '') ?? []).slice(1).reverse().join('-') || null;
const numero = s => { const x = Number(String(s ?? '').trim().replace(',', '.')); return Number.isFinite(x) ? x : null; };
const tag = (txt, nome) => new RegExp(`<${nome}>([^<]*)</${nome}>`).exec(txt)?.[1] ?? null;
const cnpjFormatado = d => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

// Lê as contas de um bloco (individual ou consolidado) até o 3º nível, como os arquivos abertos.
// Balanço: posição no fim do trimestre. Resultado, fluxo de caixa e DVA: acumulado do ano (como na CVM).
function lerContas(bloco, mult, dtIni) {
  const contas = {};
  for (const [secao, dem] of Object.entries(SECOES)) {
    const s = new RegExp(`<${secao}>([\\s\\S]*?)</${secao}>`).exec(bloco)?.[1];
    if (!s) continue;
    const mapa = new Map();
    for (const m of s.matchAll(/<Conta>([\s\S]*?)<\/Conta>/g)) {
      const c = m[1], cod = tag(c, 'CodigoConta');
      if (!cod || cod.split('.').length > 3) continue;
      const bruto = dem === 'BPA' || dem === 'BPP' ? tag(c, 'TrimestreAtual')
        : tag(c, 'AcumuladoExercicioAtual') ?? tag(c, 'AcumuladoAtualExercicio') ?? tag(c, 'TrimestreAtual');
      const vl = numero(bruto);
      if (vl == null) continue;
      mapa.set(cod, { ds: tag(c, 'DescricaoConta') ?? '', vl: vl * mult, dtIni: dem === 'BPA' || dem === 'BPP' ? null : dtIni });
    }
    contas[dem] = mapa;
  }
  return contas;
}

// Transforma o XML do ITR na linha de fundamentos (mesmos campos de cvm.js)
export function lerItrXml(xml) {
  const cnpj = tag(xml, 'CnpjEmpresa'), dtRefer = dataIso(tag(xml, 'DataReferencia'));
  if (!cnpj || !dtRefer) throw new Error('ITR sem CNPJ ou data de referência');
  const mult = tag(xml, 'EscalaMoeda') === '2' ? 1000 : 1;   // 2 = valores em milhares
  const dtIni = dataIso(tag(xml, 'DtInicioExercicioSocialCurso'));
  const ind = lerContas(/<DfIndividuais>([\s\S]*?)<\/DfIndividuais>/.exec(xml)?.[1] ?? '', mult, dtIni);
  const con = lerContas(/<DfConsolidadas>([\s\S]*?)<\/DfConsolidadas>/.exec(xml)?.[1] ?? '', mult, dtIni);
  // Consolidado só vale se tiver números (mesma regra de cvm.js)
  const temValores = esc => !!(esc.DRE?.get('3.01')?.vl || esc.BPA?.get('1')?.vl);
  const temCon = temValores(con);
  const c = temCon ? con : ind;
  if (!c.BPA && !c.DRE) throw new Error('ITR sem balanço nem resultado');
  const f = extrairCampos(c, temCon ? ind : null);
  // Quantidade de ações: integralizadas menos tesouraria (o XML escreve "CaptalIntegralizado")
  const cap = /<Capt?a?l?Integralizado>([\s\S]*?)<\/Capt?a?l?Integralizado>/.exec(xml)?.[1] ?? /<CaptalIntegralizado>([\s\S]*?)<\/CaptalIntegralizado>/.exec(xml)?.[1] ?? '';
  const tes = /<Tesouraria>([\s\S]*?)<\/Tesouraria>/.exec(xml)?.[1] ?? '';
  const q = (bloco, nome) => numero(tag(bloco, nome)) ?? 0;
  const on = q(cap, 'Ordinarias'), pn = q(cap, 'Preferenciais');
  return {
    cnpj: cnpjFormatado(cnpj), dt_refer: dtRefer, versao: numero(tag(xml, 'VersaoDocumento')) ?? 1, consolidado: temCon ? 1 : 0, f,
    acoes: on + pn > 0 ? { on: on - q(tes, 'Ordinarias'), pn: pn - q(tes, 'Preferenciais'), brutoOn: on, brutoPn: pn } : null,
  };
}

// ITRs entregues nos últimos 60 dias por empresas acompanhadas e ainda sem número na base
// A CVM é lenta para quem acessa de fora do país (no GitHub, ~45 s por documento): cada execução lê
// por no máximo limiteMs e deixa o resto para a próxima (as do pregão rodam de hora em hora).
export async function atualizarItrDoDia(db, { limiteMs = 8 * 60000 } = {}) {
  criarTabelaEntregas(db);
  const pendentes = db.prepare(`SELECT n.cd_cvm, n.dt_refer, n.dt_entrega, n.seq, n.versao, n.protocolo, e.cnpj, e.nome
    FROM entregas n JOIN empresas e ON CAST(e.cd_cvm AS INTEGER) = CAST(n.cd_cvm AS INTEGER)
    WHERE n.tipo = 'ITR' AND n.seq IS NOT NULL AND n.dt_entrega >= date('now', '-60 day')
      AND e.cnpj IN (SELECT DISTINCT cnpj FROM tickers WHERE tipo = 'acao')
      -- Falta na base, ou entrou antes de existirem as colunas de imposto (sem ebt e sem origem marcada)
      AND NOT EXISTS (SELECT 1 FROM fundamentos f WHERE f.cnpj = e.cnpj AND f.dt_refer = n.dt_refer AND (f.ebt IS NOT NULL OR f.fonte = 'enet'))
    ORDER BY n.dt_entrega DESC LIMIT 60`).all();
  if (!pendentes.length) { log('ITR do dia: nada novo para ler'); return; }
  const ins = db.prepare(`INSERT OR REPLACE INTO fundamentos (cnpj, dt_refer, tipo, dt_ini, dt_receb, versao,
    consolidado, receita, lucro_bruto, ebit, equivalencia, da, lucro_liq, lucro_contr, fco, fci, fcf, capex, dividendos_pagos,
    ativo_total, ativo_circ, caixa, passivo_circ, divida_cp, divida_lp, pl, pl_contr, acoes_on, acoes_pn,
    acoes_on_bruto, acoes_pn_bruto, ebt, ir, fonte)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'enet')`);
  const pasta = join(BRUTOS, 'enet');
  mkdirSync(pasta, { recursive: true });
  let lidos = 0, adiados = 0;
  const inicio = Date.now();
  const falhas = [];
  for (const p of pendentes) {
    if (Date.now() - inicio > limiteMs) { adiados++; continue; }
    try {
      // O ENET recusa conexões em sequência às vezes: até 3 tentativas, com pausa crescente
      let buf;
      for (let t = 1; t <= 3; t++) {
        try {
          const r = await fetch(URL_DOC(p.seq, p.versao, p.protocolo), { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(120000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          buf = Buffer.from(await r.arrayBuffer());
          if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('a CVM não devolveu o zip do documento');
          break;
        } catch (e) {
          if (t === 3) throw e;
          await new Promise(res => setTimeout(res, 4000 * t));
        }
      }
      await new Promise(res => setTimeout(res, 500));
      const arq = join(pasta, `${p.seq}.zip`);
      writeFileSync(arq, buf);
      const zip = abrirZip(arq);
      const nome = zip.nomes.find(n => /ITR.*\.xml$/i.test(n) && !/^Formulario/i.test(n));
      if (!nome) throw new Error('zip sem o XML do ITR');
      const doc = lerItrXml(Buffer.from(zip.texto(nome), 'latin1').toString('utf8'));
      if (doc.cnpj !== p.cnpj || doc.dt_refer !== p.dt_refer) throw new Error(`documento de ${doc.cnpj} ${doc.dt_refer}, esperado ${p.cnpj} ${p.dt_refer}`);
      const f = doc.f;
      transacao(db, () => ins.run(doc.cnpj, doc.dt_refer, 'ITR', f.dt_ini, p.dt_entrega, doc.versao, doc.consolidado,
        f.receita, f.lucro_bruto, f.ebit, f.equivalencia, f.da, f.lucro_liq, f.lucro_contr, f.fco, f.fci, f.fcf, f.capex,
        f.dividendos_pagos, f.ativo_total, f.ativo_circ, f.caixa, f.passivo_circ, f.divida_cp, f.divida_lp,
        f.pl, f.pl_contr, doc.acoes?.on ?? null, doc.acoes?.pn ?? null, doc.acoes?.brutoOn ?? null, doc.acoes?.brutoPn ?? null, f.ebt, f.ir));
      lidos++;
    } catch (e) { falhas.push(`${p.nome}: ${e.message}`); }
  }
  log(`ITR do dia: ${lidos} de ${pendentes.length} lidos direto da CVM${adiados ? ` (${adiados} ficam para a próxima execução)` : ''}${falhas.length ? `; falhas: ${falhas.slice(0, 5).join(' | ')}` : ''}`);
  if (falhas.length && !lidos && !adiados) throw new Error(`nenhum ITR lido (${falhas[0]})`);
}
