// Entregas de ITR e DFP à CVM no dia em que acontecem, pela consulta pública do sistema ENET/RAD.
// Os arquivos abertos da CVM (dados.cvm.gov.br), de onde vêm os números, só são regenerados aos
// domingos: entre a divulgação do resultado e o domingo, a base continua no trimestre anterior. Sem
// saber da entrega, o site dizia "lucro intacto" para a Marcopolo um dia depois de o lucro cair 43%.
// Esta tabela não traz números, só a data: o cálculo marca a empresa como "resultado novo fora da base".
import { log } from './util.js';

const URL_RAD = 'https://www.rad.cvm.gov.br/ENET/frmConsultaExternaCVM.aspx/ListarDocumentos';
const CATEGORIAS = [['EST_3', 'ITR'], ['EST_4', 'DFP']];
const br = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const semTags = s => (s ?? '').replace(/<[^>]+>/g, '').trim();

export function criarTabelaEntregas(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS entregas (
    cd_cvm TEXT, tipo TEXT, dt_refer TEXT, dt_entrega TEXT, PRIMARY KEY (cd_cvm, tipo, dt_refer))`);
  // Identificação do documento no ENET, para baixar o próprio ITR no dia (src/itrdia.js)
  const cols = db.prepare('PRAGMA table_info(entregas)').all().map(c => c.name);
  if (!cols.includes('seq')) db.exec('ALTER TABLE entregas ADD COLUMN seq TEXT; ALTER TABLE entregas ADD COLUMN versao INTEGER; ALTER TABLE entregas ADD COLUMN protocolo TEXT');
}

async function listar(categoria, de, ate) {
  const corpo = { dataDe: br(de), dataAte: br(ate), empresa: '', setorAtividade: '-1', categoriaEmissor: '-1',
    situacaoEmissor: '-1', tipoParticipante: '1', dataReferencia: '', categoria, periodo: '2', horaIni: '', horaFim: '',
    palavraChave: '', ultimaDtRef: 'false', tipoEmpresa: '0', token: '', versaoCaptcha: '' };
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(URL_RAD, { method: 'POST', body: JSON.stringify(corpo), signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json())?.d;
      if (!d || d.temErro) throw new Error(d?.msgErro || 'resposta vazia');
      // Registros separados por "&*" e campos por "$&": código CVM, empresa, categoria, ..., data de
      // referência ("20260930 30/09/2026"), data de entrega ("20261103 03/11/2026 18:10")
      // O link de download vem dentro do HTML do registro: OpenDownloadDocumentos('seq','versão','protocolo','ITR')
      return (d.dados ?? '').split('&*').filter(Boolean).map(reg => {
        const campos = reg.split('$&').map(semTags);
        const dl = /OpenDownloadDocumentos\('(\d+)','(\d+)','([^']+)'/.exec(reg);
        campos.download = dl ? { seq: dl[1], versao: Number(dl[2]), protocolo: dl[3] } : null;
        return campos;
      });
    } catch (e) {
      if (i === 3) throw e;
      await new Promise(res => setTimeout(res, 3000 * i));
    }
  }
}

// Entregas dos últimos 60 dias. Guarda a primeira entrega de cada (empresa, tipo, data de referência):
// reapresentações não mudam a data em que o mercado conheceu o resultado.
export async function atualizarEntregas(db) {
  criarTabelaEntregas(db);
  const ate = new Date(), de = new Date(Date.now() - 60 * 864e5);
  // Data: a primeira entrega. Documento: a versão mais recente (reapresentação corrige números)
  const ins = db.prepare(`INSERT INTO entregas (cd_cvm, tipo, dt_refer, dt_entrega, seq, versao, protocolo) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET dt_entrega = min(entregas.dt_entrega, excluded.dt_entrega),
      seq = CASE WHEN coalesce(excluded.versao, 0) >= coalesce(entregas.versao, 0) THEN coalesce(excluded.seq, entregas.seq) ELSE entregas.seq END,
      protocolo = CASE WHEN coalesce(excluded.versao, 0) >= coalesce(entregas.versao, 0) THEN coalesce(excluded.protocolo, entregas.protocolo) ELSE entregas.protocolo END,
      versao = max(coalesce(excluded.versao, 0), coalesce(entregas.versao, 0))`);
  let n = 0;
  for (const [categoria, tipo] of CATEGORIAS) {
    for (const c of await listar(categoria, de, ate)) {
      const cd = String(Number((c[0] ?? '').replace(/\D/g, '')));
      const ref = /^(\d{4})(\d{2})(\d{2})/.exec(c[5] ?? ''), ent = /^(\d{4})(\d{2})(\d{2})/.exec(c[6] ?? '');
      if (cd === '0' || !ref || !ent) continue;
      ins.run(cd, tipo, `${ref[1]}-${ref[2]}-${ref[3]}`, `${ent[1]}-${ent[2]}-${ent[3]}`,
        c.download?.seq ?? null, c.download?.versao ?? null, c.download?.protocolo ?? null);
      n++;
    }
  }
  log(`Entregas à CVM (ITR/DFP) nos últimos 60 dias: ${n}`);
}
