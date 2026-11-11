// Microsserviço de METEOROLOGIA → Open-Meteo Forecast
// GET /clima?lat=-12.97&lon=-38.51
const { HttpError, buscarJSON, criarServidor, TIMEOUT_MS } = require('../lib');

const PORT = Number(process.env.MET_PORT) || 4002;
const FC_URL = process.env.FC_URL || 'https://api.open-meteo.com/v1/forecast';

const rotas = {
  'GET /clima': async url => {
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!url.searchParams.get('lat') || !url.searchParams.get('lon') ||
        !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      throw new HttpError(400, 'Latitude e longitude inválidas.');
    const p = new URLSearchParams({
      latitude: lat, longitude: lon, timezone: 'auto', forecast_days: 5, wind_speed_unit: 'kmh',
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,uv_index_max'
    });
    // Apenas para demonstrar/testar o cenário 502: força um timeout real de 1 ms na API externa.
    const simular = process.env.ALLOW_SIMULATION !== '0' && url.searchParams.get('simular') === 'timeout';
    const d = await buscarJSON(`${FC_URL}?${p}`, { timeout: simular ? 1 : TIMEOUT_MS });
    if (!d.current || !d.daily) throw new HttpError(502, 'Resposta inesperada do serviço meteorológico.');
    return { current: d.current, daily: d.daily };
  },
  'GET /saude': async () => ({ servico: 'meteorologia', status: 'ok' })
};

const server = criarServidor('meteorologia', rotas);
if (require.main === module) server.listen(PORT, () => console.log(`[meteorologia] porta ${PORT}`));
module.exports = server;
