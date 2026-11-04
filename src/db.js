import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from './util.js';

export const CAMINHO_DB = join(RAIZ, 'dados', 'comparador.db');

const ESQUEMA = `
-- Empresas abertas (cadastro da CVM)
CREATE TABLE IF NOT EXISTS empresas (
  cnpj TEXT PRIMARY KEY,
  cd_cvm TEXT,
  nome TEXT,
  setor TEXT,
  situacao TEXT,
  controle TEXT,        -- ESTATAL, PRIVADO, ESTRANGEIRO...
  segmento TEXT         -- Novo Mercado, N1, N2, Básico...
);

-- Códigos de negociação. tipo: acao | etf
CREATE TABLE IF NOT EXISTS tickers (
  ticker TEXT PRIMARY KEY,
  cnpj TEXT,
  classe TEXT,          -- ON, PN, UNIT, ETF
  tipo TEXT,
  nome TEXT
);

-- Um registro por empresa por demonstração entregue (ITR trimestral ou DFP anual).
-- Contas de resultado e de caixa são acumuladas no ano (de dt_ini até dt_refer);
-- contas de balanço são a posição em dt_refer. Valores em reais.
CREATE TABLE IF NOT EXISTS fundamentos (
  cnpj TEXT,
  dt_refer TEXT,
  tipo TEXT,            -- ITR | DFP
  dt_ini TEXT,
  dt_receb TEXT,        -- quando a CVM recebeu (o mercado só sabe a partir daqui)
  versao INTEGER,
  consolidado INTEGER,
  receita REAL, lucro_bruto REAL, ebit REAL, equivalencia REAL, da REAL,
  lucro_liq REAL, lucro_contr REAL,
  fco REAL, fci REAL, fcf REAL, capex REAL, dividendos_pagos REAL,
  ativo_total REAL, ativo_circ REAL, caixa REAL,
  passivo_circ REAL, divida_cp REAL, divida_lp REAL,
  pl REAL, pl_contr REAL,
  acoes_on REAL, acoes_pn REAL,            -- descontadas as em tesouraria
  acoes_on_bruto REAL, acoes_pn_bruto REAL, -- com tesouraria (comparáveis ao Formulário de Referência)
  PRIMARY KEY (cnpj, dt_refer, tipo)
);

CREATE TABLE IF NOT EXISTS cotacoes (
  ticker TEXT,
  data TEXT,
  abertura REAL, maxima REAL, minima REAL, fechamento REAL,
  volume REAL,          -- financeiro negociado em R$
  negocios INTEGER,
  parcial INTEGER,      -- 1 = preço durante o pregão (não oficial), trocado à noite pelo fechamento
  PRIMARY KEY (ticker, data)
) WITHOUT ROWID;

-- Quantidade de ações do Formulário de Referência (FRE), que a empresa reenvia poucos dias depois de
-- mudar o capital (aumento, bonificação, desdobramento). Serve para corrigir a quantidade entre um
-- balanço trimestral e o seguinte. Só a versão mais recente de cada empresa.
CREATE TABLE IF NOT EXISTS capital_fre (
  cnpj TEXT PRIMARY KEY,
  versao INTEGER,
  dt_receb TEXT,
  acoes_on REAL,
  acoes_pn REAL
);

-- Pequenos valores de controle (ex.: horário da última cotação parcial)
CREATE TABLE IF NOT EXISTS meta (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

-- Séries do Banco Central: cdi (% ao dia), selic_meta (% a.a.), ipca (% no mês),
-- ipca_12m (%), dolar (PTAX venda)
CREATE TABLE IF NOT EXISTS macro (
  serie TEXT,
  data TEXT,
  valor REAL,
  PRIMARY KEY (serie, data)
) WITHOUT ROWID;

-- Taxas do Tesouro Direto (régua de renda fixa)
CREATE TABLE IF NOT EXISTS tesouro (
  titulo TEXT,
  vencimento TEXT,
  data TEXT,
  taxa REAL,            -- taxa de compra, % a.a.
  pu REAL,              -- preço unitário base (quanto vale um título hoje)
  PRIMARY KEY (titulo, vencimento, data)
) WITHOUT ROWID;

-- Controle de quais arquivos remotos já foram processados
CREATE TABLE IF NOT EXISTS arquivos (
  url TEXT PRIMARY KEY,
  modificado TEXT,
  processado_em TEXT
);

CREATE TABLE IF NOT EXISTS execucoes (
  inicio TEXT,
  fim TEXT,
  modo TEXT,
  resultado TEXT
);
`;

export function abrirDb() {
  mkdirSync(join(RAIZ, 'dados'), { recursive: true });
  const db = new DatabaseSync(CAMINHO_DB);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(ESQUEMA);
  // Colunas acrescentadas depois da primeira versão do banco
  const colunas = db.prepare('PRAGMA table_info(fundamentos)').all().map(c => c.name);
  if (!colunas.includes('equivalencia')) db.exec('ALTER TABLE fundamentos ADD COLUMN equivalencia REAL');
  if (!colunas.includes('acoes_on_bruto')) db.exec('ALTER TABLE fundamentos ADD COLUMN acoes_on_bruto REAL; ALTER TABLE fundamentos ADD COLUMN acoes_pn_bruto REAL');
  const colTesouro = db.prepare('PRAGMA table_info(tesouro)').all().map(c => c.name);
  if (!colTesouro.includes('pu')) db.exec('ALTER TABLE tesouro ADD COLUMN pu REAL');
  const colCotacoes = db.prepare('PRAGMA table_info(cotacoes)').all().map(c => c.name);
  if (!colCotacoes.includes('parcial')) db.exec('ALTER TABLE cotacoes ADD COLUMN parcial INTEGER');
  return db;
}

// Executa fn dentro de uma transação (deixa as cargas grandes muito mais rápidas)
export function transacao(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Diz se a versão remota de um arquivo mudou desde a última vez que foi processado
export async function arquivoMudou(db, url) {
  const resp = await fetch(url, { method: 'HEAD' });
  if (!resp.ok) return { mudou: false, existe: false };
  const modificado = resp.headers.get('last-modified') ?? '';
  const salvo = db.prepare('SELECT modificado FROM arquivos WHERE url = ?').get(url);
  return { mudou: !salvo || salvo.modificado !== modificado, existe: true, modificado };
}

export function marcarArquivo(db, url, modificado) {
  db.prepare(`INSERT INTO arquivos (url, modificado, processado_em) VALUES (?, ?, ?)
              ON CONFLICT(url) DO UPDATE SET modificado = excluded.modificado, processado_em = excluded.processado_em`)
    .run(url, modificado ?? '', new Date().toISOString());
}
