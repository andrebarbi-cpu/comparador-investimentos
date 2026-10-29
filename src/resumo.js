// Mostra o que tem no banco: volume, períodos cobertos e lacunas.
import { abrirDb } from './db.js';

const db = abrirDb();
const q = s => db.prepare(s).all();

console.log('\nTabelas');
console.table(q(`
  SELECT 'empresas' tabela, count(*) linhas, NULL de, NULL ate FROM empresas
  UNION ALL SELECT 'tickers', count(*), NULL, NULL FROM tickers
  UNION ALL SELECT 'fundamentos', count(*), min(dt_refer), max(dt_refer) FROM fundamentos
  UNION ALL SELECT 'cotacoes', count(*), min(data), max(data) FROM cotacoes
  UNION ALL SELECT 'macro', count(*), min(data), max(data) FROM macro
  UNION ALL SELECT 'tesouro', count(*), min(data), max(data) FROM tesouro`));

console.log('Demonstrações por ano (só empresas com ação negociada)');
console.table(q(`
  SELECT substr(dt_refer,1,4) ano, sum(tipo='DFP') dfp, sum(tipo='ITR') itr,
         sum(lucro_liq IS NULL) sem_lucro, sum(acoes_on IS NULL) sem_acoes
  FROM fundamentos WHERE cnpj IN (SELECT cnpj FROM tickers WHERE tipo='acao')
  GROUP BY 1 ORDER BY 1`));

console.log('Séries macro');
console.table(q(`SELECT serie, count(*) pontos, min(data) de, max(data) ate,
  (SELECT valor FROM macro m2 WHERE m2.serie=m.serie ORDER BY data DESC LIMIT 1) ultimo
  FROM macro m GROUP BY serie`));

console.log('Últimas execuções');
console.table(q('SELECT inicio, fim, modo, resultado FROM execucoes ORDER BY inicio DESC LIMIT 5'));
db.close();
