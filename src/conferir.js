// Confere o banco antes de ele ser guardado na release: um banco vazio ou encolhido (download que
// falhou, arquivo da CVM que veio errado) não pode substituir o bom.
//   node src/conferir.js dados/comparador.db [dados/comparador-anterior.db]
// Sai com erro (código 1) se faltar dado; o workflow então não guarda nem publica.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const [novo, anterior] = process.argv.slice(2);
const contar = (arq, tabela) => {
  const db = new DatabaseSync(arq, { readOnly: true });
  try { return db.prepare(`SELECT count(*) n FROM ${tabela}`).get().n; }
  catch { return 0; }
  finally { db.close(); }
};

if (!novo || !existsSync(novo)) {
  console.log(`::error::Banco ${novo ?? ''} não encontrado: nada será guardado`);
  process.exit(1);
}
// Mínimos bem abaixo do normal (nov/2026: 854 empresas, 1,37 milhão de cotações, 29 mil balanços, 265 indicadores)
const MINIMOS = { empresas: 300, tickers: 200, cotacoes: 500000, fundamentos: 10000, indicadores: 100 };
const problemas = [];
for (const [tabela, minimo] of Object.entries(MINIMOS)) {
  const n = contar(novo, tabela);
  if (n < minimo) problemas.push(`${tabela}: ${n} linhas (mínimo ${minimo})`);
}
// Contra o banco anterior: cotações e balanços só crescem; queda de mais de 2% é perda de dado
if (anterior && existsSync(anterior)) {
  for (const tabela of ['cotacoes', 'fundamentos']) {
    const a = contar(anterior, tabela), n = contar(novo, tabela);
    if (a > 0 && n < a * 0.98) problemas.push(`${tabela}: ${n} linhas contra ${a} no banco anterior`);
  }
}

if (problemas.length) {
  console.log(`::error::Banco reprovado, não será guardado: ${problemas.join('; ')}`);
  process.exit(1);
}
console.log('Banco conferido: ' + Object.keys(MINIMOS).map(t => `${t} ${contar(novo, t)}`).join(', '));
