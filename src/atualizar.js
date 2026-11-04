// Ponto de entrada da coleta.
//   npm run carga-inicial   -> baixa todo o histórico desde ANO_INICIO (demora, roda uma vez)
//   npm run atualizar       -> rotina diária: só o que mudou desde a última execução
//   npm run intraday        -> preços durante o pregão (parciais, trocados à noite pelo oficial)
import { abrirDb } from './db.js';
import { atualizarCadastro, atualizarDemonstracoes, atualizarCapitalFre } from './cvm.js';
import { carregarAno, atualizarDiario } from './b3.js';
import { atualizarBcb, atualizarTesouro } from './macro.js';
import { calcular } from './calcular.js';
import { exportar } from './exportar.js';
import { atualizarIntraday } from './intraday.js';
import { atualizarEtfsExternos } from './externos.js';
import { atualizarProventos } from './proventos.js';
import { log, anoAtual } from './util.js';

const ANO_INICIO = 2016;
const cargaInicial = process.argv.includes('--carga-inicial');
// --intraday: só preços durante o pregão (rápido), sem CVM, Banco Central nem Tesouro
const intraday = process.argv.includes('--intraday');
const ano = anoAtual();
const db = abrirDb();
const inicio = new Date().toISOString();
const falhas = [];

// Cada etapa roda isolada: se uma fonte estiver fora do ar, as outras seguem
async function etapa(nome, fn) {
  try { await fn(); }
  catch (e) { falhas.push(`${nome}: ${e.message}`); log(`ERRO em ${nome}:`, e.message); }
}

const modo = cargaInicial ? 'carga-inicial' : intraday ? 'intraday' : 'diaria';
log({ 'carga-inicial': `Carga inicial desde ${ANO_INICIO}`, intraday: 'Preços durante o pregão', diaria: 'Atualização diária' }[modo]);

if (intraday) {
  await etapa('preços do pregão', () => atualizarIntraday(db));
} else {
  await etapa('cadastro', () => atualizarCadastro(db, ano));
  if (cargaInicial) {
    // DFP do ano anterior ao início é necessária para calcular os 12 meses do 1º trimestre
    for (let a = ANO_INICIO - 1; a <= ano; a++) await etapa(`DFP ${a}`, () => atualizarDemonstracoes(db, 'DFP', a));
    for (let a = ANO_INICIO; a <= ano; a++) await etapa(`ITR ${a}`, () => atualizarDemonstracoes(db, 'ITR', a));
    for (let a = ANO_INICIO; a <= ano; a++) await etapa(`cotações ${a}`, () => carregarAno(db, a, { forcar: a === ano }));
  } else {
    // Empresas reapresentam balanços antigos, então olhamos o ano corrente e o anterior
    for (const a of [ano - 1, ano]) {
      await etapa(`DFP ${a}`, () => atualizarDemonstracoes(db, 'DFP', a, { soSeMudou: true }));
      await etapa(`ITR ${a}`, () => atualizarDemonstracoes(db, 'ITR', a, { soSeMudou: true }));
    }
    await etapa('cotações', () => atualizarDiario(db));
  }
  await etapa('ETFs fora do arquivo da B3', () => atualizarEtfsExternos(db));
  // Aumentos de capital, bonificações e desdobramentos que ainda não chegaram ao balanço
  await etapa('Formulário de Referência', () => atualizarCapitalFre(db, ano));
  // Dividendos, JCP e desdobramentos por ação (B3); uma vez por dia
  await etapa('proventos', () => atualizarProventos(db));
  await etapa('Banco Central', () => atualizarBcb(db, ANO_INICIO));
  await etapa('Tesouro', () => atualizarTesouro(db, ANO_INICIO));
  // Pregão em andamento: junta os preços parciais do dia (fora do pregão não grava nada). Sem isso,
  // uma atualização completa rodada à tarde publicaria o site com os preços de ontem.
  // Falha aqui não deixa a execução vermelha: o preço oficial já foi atualizado acima.
  try { await atualizarIntraday(db); } catch (e) { log('Preços do pregão indisponíveis agora:', e.message); }
}
// Recalcula indicadores e notas com o que foi coletado (mesmo que alguma fonte tenha falhado)
await etapa('cálculo', () => calcular(db));
await etapa('exportação', () => exportar(db));

db.prepare('INSERT INTO execucoes (inicio, fim, modo, resultado) VALUES (?, ?, ?, ?)')
  .run(inicio, new Date().toISOString(), modo, falhas.length ? falhas.join(' | ') : 'ok');
db.close();

if (falhas.length) { log(`Terminou com ${falhas.length} falha(s)`); process.exit(1); }
log('Concluído');
