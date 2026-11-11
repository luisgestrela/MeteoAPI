// API GATEWAY — ponto único de entrada: /api/clima?cidade=…
// Valida a entrada, orquestra os dois microsserviços, mantém o histórico e serve o frontend.
const fs = require('fs');
const path = require('path');
const { HttpError, buscarJSON, criarServidor } = require('../lib');

const PORT = Number(process.env.PORT) || 3000;
const LOC_URL = process.env.LOC_URL || `http://localhost:${process.env.LOC_PORT || 4001}`;
const MET_URL = process.env.MET_URL || `http://localhost:${process.env.MET_PORT || 4002}`;
const ROOT = path.join(__dirname, '..', '..');

/* ---------- histórico das últimas 5 cidades (em memória) ---------- */
let historico = [];
function registrar(loc) {
  historico = [loc, ...historico.filter(h => h.id !== loc.id)].slice(0, 5);
}

/* ---------- chamadas aos microsserviços (erros internos preservados) ---------- */
const interno = url => buscarJSON(url, { repassarErro: true }).catch(e => {
  // microsserviço fora do ar ou lento → 502 do ponto de vista do cliente
  throw e instanceof HttpError ? e : new HttpError(502, 'Serviço interno indisponível.');
});

const rotas = {
  // GET /api/clima?cidade=Salvador[&id=3450554][&registrar=0][&simular=timeout]
  'GET /api/clima': async url => {
    const cidade = (url.searchParams.get('cidade') || '').trim();
    if (cidade.length < 2 || cidade.length > 100)
      throw new HttpError(400, 'Informe uma cidade com 2 a 100 caracteres.');

    const { resultados } = await interno(`${LOC_URL}/localizar?nome=${encodeURIComponent(cidade)}`);
    const id = url.searchParams.get('id');
    const localidade = id ? resultados.find(r => String(r.id) === id) : resultados[0];
    if (!localidade) throw new HttpError(404, 'Local não encontrado.');

    const q = new URLSearchParams({ lat: localidade.latitude, lon: localidade.longitude });
    if (url.searchParams.get('simular')) q.set('simular', url.searchParams.get('simular'));
    const clima = await interno(`${MET_URL}/clima?${q}`);

    if (url.searchParams.get('registrar') !== '0') registrar(localidade);
    return { localidade, localidades: resultados, clima, historico };
  },

  'GET /api/historico': async () => ({ historico }),

  'GET /api/saude': async () => {
    const ver = u => buscarJSON(`${u}/saude`, { timeout: 2000 }).then(() => 'ok', () => 'indisponível');
    const [localizacao, meteorologia] = await Promise.all([ver(LOC_URL), ver(MET_URL)]);
    return { gateway: 'ok', localizacao, meteorologia };
  }
};

/* ---------- arquivos estáticos do frontend (lista fechada) ---------- */
const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/script.js': ['script.js', 'text/javascript; charset=utf-8']
};
async function estaticos(req, res, url) {
  const e = ESTATICOS[url.pathname];
  if (!e || req.method !== 'GET') return false;
  const dados = await fs.promises.readFile(path.join(ROOT, e[0]));
  res.writeHead(200, { 'Content-Type': e[1], 'Cache-Control': 'no-store' });
  res.end(dados);
  return true;
}

const server = criarServidor('gateway', rotas, estaticos);
if (require.main === module) server.listen(PORT, () => console.log(`[gateway] http://localhost:${PORT}`));
module.exports = server;
