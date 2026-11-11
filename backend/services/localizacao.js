// Microsserviço de LOCALIZAÇÃO → Open-Meteo Geocoding
// GET /localizar?nome=Salvador
const { HttpError, buscarJSON, criarHandler, criarServidor } = require('../lib');

const PORT = Number(process.env.LOC_PORT) || 4001;
const GEO_URL = () => process.env.GEO_URL || 'https://geocoding-api.open-meteo.com/v1/search';

/** Regra de negócio do serviço (também usada em processo único na Vercel). */
async function localizar(nomeBruto) {
  const nome = (nomeBruto || '').trim();
  if (nome.length < 2 || nome.length > 100) throw new HttpError(400, 'Informe uma cidade com 2 a 100 caracteres.');
  const d = await buscarJSON(`${GEO_URL()}?name=${encodeURIComponent(nome)}&count=10&language=pt&format=json`);
  if (!Array.isArray(d.results) || !d.results.length) throw new HttpError(404, 'Local não encontrado.');
  return {
    resultados: d.results.map(r => ({
      id: r.id, name: r.name, admin1: r.admin1 || null, country: r.country || null,
      latitude: r.latitude, longitude: r.longitude, timezone: r.timezone || null
    }))
  };
}

const rotas = {
  'GET /localizar': url => localizar(url.searchParams.get('nome')),
  'GET /api/localizacao': url => localizar(url.searchParams.get('nome')),   // rota na Vercel
  'GET /saude': async () => ({ servico: 'localizacao', status: 'ok' })
};

const handler = criarHandler('localizacao', rotas);
const server = criarServidor('localizacao', rotas);
if (require.main === module) server.listen(PORT, () => console.log(`[localizacao] porta ${PORT}`));
module.exports = { server, handler, localizar };
