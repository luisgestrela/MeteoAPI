// API GATEWAY — ponto único de entrada: /api/clima?cidade=…
// Valida a entrada, orquestra os dois microsserviços e mantém o histórico.
//
// Dois modos de operação (escolhidos automaticamente):
//  • Local (npm run dev): LOC_URL e MET_URL apontam para os microsserviços, que rodam como
//    processos separados (portas 4001 e 4002) e são chamados por HTTP.
//  • Vercel (serverless): sem LOC_URL/MET_URL, o gateway chama os mesmos módulos em processo único,
//    pois não há servidores permanentes. A lógica e os contratos (400/404/502) são idênticos.
const fs = require('fs');
const path = require('path');
const { HttpError, buscarJSON, criarHandler, criarServidor } = require('../lib');
const { localizar } = require('../services/localizacao');
const { obterClima } = require('../services/meteorologia');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', '..', 'public');

/* ---------- histórico das últimas 5 cidades (memória do gateway) ---------- */
let historico = [];
function registrar(loc) {
  historico = [loc, ...historico.filter(h => h.id !== loc.id)].slice(0, 5);
}

/* ---------- chamadas aos microsserviços ---------- */
// microsserviço fora do ar ou lento → 502 do ponto de vista do cliente
const interno = url => buscarJSON(url, { repassarErro: true }).catch(e => {
  throw e instanceof HttpError ? e : new HttpError(502, 'Serviço interno indisponível.');
});
const chamarLocalizacao = nome => process.env.LOC_URL
  ? interno(`${process.env.LOC_URL}/localizar?nome=${encodeURIComponent(nome)}`)
  : localizar(nome);
const chamarMeteorologia = (lat, lon, simular) => process.env.MET_URL
  ? interno(`${process.env.MET_URL}/clima?${new URLSearchParams({ lat, lon, ...(simular ? { simular } : {}) })}`)
  : obterClima(lat, lon, simular);

const rotas = {
  // GET /api/clima?cidade=Salvador[&id=3450554][&registrar=0][&simular=timeout]
  'GET /api/clima': async url => {
    const cidade = (url.searchParams.get('cidade') || '').trim();
    if (cidade.length < 2 || cidade.length > 100)
      throw new HttpError(400, 'Informe uma cidade com 2 a 100 caracteres.');

    const { resultados } = await chamarLocalizacao(cidade);
    const id = url.searchParams.get('id');
    const localidade = id ? resultados.find(r => String(r.id) === id) : resultados[0];
    if (!localidade) throw new HttpError(404, 'Local não encontrado.');

    const clima = await chamarMeteorologia(localidade.latitude, localidade.longitude, url.searchParams.get('simular'));

    if (url.searchParams.get('registrar') !== '0') registrar(localidade);
    return { localidade, localidades: resultados, clima, historico };
  },

  'GET /api/historico': async () => ({ historico }),

  'GET /api/saude': async () => {
    if (!process.env.LOC_URL || !process.env.MET_URL)
      return { gateway: 'ok', localizacao: 'ok', meteorologia: 'ok', modo: 'processo único' };
    const ver = u => buscarJSON(`${u}/saude`, { timeout: 2000 }).then(() => 'ok', () => 'indisponível');
    const [localizacao, meteorologia] = await Promise.all([ver(process.env.LOC_URL), ver(process.env.MET_URL)]);
    return { gateway: 'ok', localizacao, meteorologia, modo: 'microsserviços' };
  }
};

/** Handler só da API — usado pelas funções serverless em /api. */
const handler = criarHandler('gateway', rotas);

/* ---------- arquivos estáticos (apenas no modo local; na Vercel a pasta public/ é servida pela CDN) ---------- */
const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/script.js': ['script.js', 'text/javascript; charset=utf-8']
};
async function estaticos(req, res, url) {
  const e = ESTATICOS[url.pathname];
  if (!e || req.method !== 'GET') return false;
  const dados = await fs.promises.readFile(path.join(PUBLIC, e[0]));
  res.writeHead(200, { 'Content-Type': e[1], 'Cache-Control': 'no-store' });
  res.end(dados);
  return true;
}

const server = criarServidor('gateway', rotas, estaticos);
if (require.main === module) server.listen(PORT, () => console.log(`[gateway] http://localhost:${PORT}`));
module.exports = { server, handler };
