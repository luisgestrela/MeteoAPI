// Testes de integração do gateway + microsserviços.
// A Open-Meteo é simulada por um servidor local, então rodam offline: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const P = { geo: 5900, loc: 5902, met: 5903, gw: 5904 };   // a Open-Meteo simulada atende /geo e /forecast na mesma porta
process.env.GEO_URL = `http://localhost:${P.geo}/geo`;
process.env.FC_URL = `http://localhost:${P.geo}/forecast`;
process.env.LOC_URL = `http://localhost:${P.loc}`;
process.env.MET_URL = `http://localhost:${P.met}`;

const CIDADES = {
  salvador: [
    { id: 1, name: 'Salvador', admin1: 'Bahia', country: 'Brasil', latitude: -12.97, longitude: -38.51 },
    { id: 2, name: 'Salvador', admin1: 'Buenos Aires', country: 'Argentina', latitude: -35.1, longitude: -58.2 }
  ],
  recife: [{ id: 3, name: 'Recife', admin1: 'Pernambuco', country: 'Brasil', latitude: -8.05, longitude: -34.9 }],
  'são paulo': [{ id: 4, name: 'São Paulo', admin1: 'São Paulo', country: 'Brasil', latitude: -23.55, longitude: -46.63 }]
};
for (let i = 10; i < 17; i++) CIDADES['cidade' + i] = [{ id: i, name: 'Cidade' + i, country: 'Brasil', latitude: i, longitude: i }];

const dias = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
const previsao = {
  current: { time: '2026-11-10T12:00', temperature_2m: 29, relative_humidity_2m: 70, apparent_temperature: 32, is_day: 1, weather_code: 2, wind_speed_10m: 10, wind_direction_10m: 90 },
  daily: { time: dias, weather_code: [0, 1, 2, 3, 61], temperature_2m_max: [30, 30, 29, 29, 28], temperature_2m_min: [24, 24, 23, 23, 22], uv_index_max: [9, 8, 7, 6, 5] }
};

const abertos = [];
const abrir = (srv, porta) => new Promise(r => { srv.listen(porta, r); abertos.push(srv); });
const get = async caminho => {
  const r = await fetch(`http://localhost:${P.gw}${caminho}`);
  return { status: r.status, corpo: await r.json() };
};

test.before(async () => {
  // Open-Meteo simulada
  const mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const envia = (s, c) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(c)); };
    if (u.pathname === '/geo') {
      const nome = u.searchParams.get('name').toLowerCase();
      if (nome === 'falha') return envia(500, {});
      return envia(200, CIDADES[nome] ? { results: CIDADES[nome] } : {});
    }
    if (u.pathname === '/forecast') return setTimeout(() => envia(200, previsao), 20);
    envia(404, {});
  });
  await abrir(mock, P.geo);
  await abrir(require('../backend/services/localizacao').server, P.loc);
  await abrir(require('../backend/services/meteorologia').server, P.met);
  await abrir(require('../backend/gateway/gateway').server, P.gw);
});
test.after(() => abertos.forEach(s => s.close()));

test('200 · cidade=Salvador devolve localidade, clima e lista de homônimas', async () => {
  const { status, corpo } = await get('/api/clima?cidade=Salvador');
  assert.equal(status, 200);
  assert.equal(corpo.localidade.name, 'Salvador');
  assert.equal(corpo.localidades.length, 2);
  assert.equal(corpo.clima.daily.time.length, 5);
  assert.ok('temperature_2m' in corpo.clima.current);
});
test('200 · cidade=Recife', async () => assert.equal((await get('/api/clima?cidade=Recife')).status, 200));
test('200 · cidade=São Paulo (acentos)', async () => assert.equal((await get('/api/clima?cidade=' + encodeURIComponent('São Paulo'))).status, 200));

test('200 · id escolhe a localidade homônima correta', async () => {
  const { status, corpo } = await get('/api/clima?cidade=Salvador&id=2');
  assert.equal(status, 200);
  assert.equal(corpo.localidade.country, 'Argentina');
});
test('404 · id que não pertence à busca', async () => assert.equal((await get('/api/clima?cidade=Salvador&id=999')).status, 404));

test('400 · cidade vazia', async () => assert.equal((await get('/api/clima?cidade=')).status, 400));
test('400 · sem o parâmetro cidade', async () => assert.equal((await get('/api/clima')).status, 400));
test('400 · 1 caractere', async () => assert.equal((await get('/api/clima?cidade=a')).status, 400));
test('400 · mais de 100 caracteres', async () => assert.equal((await get('/api/clima?cidade=' + 'a'.repeat(101))).status, 400));
test('404 · cidade inexistente', async () => assert.equal((await get('/api/clima?cidade=xqzwkjhg')).status, 404));
test('502 · Open-Meteo Geocoding responde erro', async () => assert.equal((await get('/api/clima?cidade=falha')).status, 502));
test('502 · timeout na API de meteorologia', async () => {
  const { status, corpo } = await get('/api/clima?cidade=Salvador&simular=timeout');
  assert.equal(status, 502);
  assert.match(corpo.erro, /indispon|tempo/i);
});

test('histórico guarda só as 5 últimas, sem repetir, mais recente primeiro', async () => {
  for (let i = 10; i < 17; i++) await get('/api/clima?cidade=cidade' + i);
  await get('/api/clima?cidade=cidade14');             // repetida sobe para o topo
  await get('/api/clima?cidade=cidade11&registrar=0'); // não registra
  const { corpo } = await get('/api/historico');
  assert.deepEqual(corpo.historico.map(h => h.name), ['Cidade14', 'Cidade16', 'Cidade15', 'Cidade13', 'Cidade12']);
});

test('microsserviços respondem direto', async () => {
  const l = await fetch(`http://localhost:${P.loc}/localizar?nome=Recife`);
  assert.equal(l.status, 200);
  assert.equal((await fetch(`http://localhost:${P.loc}/localizar?nome=x`)).status, 400);
  assert.equal((await fetch(`http://localhost:${P.met}/clima?lat=1&lon=2`)).status, 200);
  assert.equal((await fetch(`http://localhost:${P.met}/clima?lat=abc&lon=2`)).status, 400);
});

test('/api/saude e rota inexistente', async () => {
  const s = await get('/api/saude');
  assert.deepEqual(s.corpo, { gateway: 'ok', localizacao: 'ok', meteorologia: 'ok', modo: 'microsserviços' });
  assert.equal((await get('/api/nada')).status, 404);
});

// ---- Modo Vercel (serverless): sem microsserviços permanentes, o gateway chama os módulos em processo único
test('modo processo único (Vercel): mesmos contratos 200 / 400 / 404 / 502', async () => {
  const { LOC_URL, MET_URL } = process.env;
  delete process.env.LOC_URL; delete process.env.MET_URL;
  try {
    assert.equal((await get('/api/clima?cidade=Recife&registrar=0')).status, 200);
    assert.equal((await get('/api/clima?cidade=')).status, 400);
    assert.equal((await get('/api/clima?cidade=xqzwkjhg')).status, 404);
    assert.equal((await get('/api/clima?cidade=Recife&registrar=0&simular=timeout')).status, 502);
    assert.equal((await get('/api/clima?cidade=falha')).status, 502);
    assert.equal((await get('/api/saude')).corpo.modo, 'processo único');
  } finally { Object.assign(process.env, { LOC_URL, MET_URL }); }
});

test('funções em api/ funcionam como handlers (req, res) da Vercel', async () => {
  const { LOC_URL, MET_URL } = process.env;
  delete process.env.LOC_URL; delete process.env.MET_URL;
  const rotas = { '/api/clima': 'clima', '/api/historico': 'historico', '/api/saude': 'saude', '/api/localizacao': 'localizacao', '/api/meteorologia': 'meteorologia' };
  const srv = http.createServer((req, res) => require(`../api/${rotas[new URL(req.url, 'http://x').pathname]}.js`)(req, res));
  await new Promise(r => srv.listen(5905, r));
  try {
    const g = async c => { const r = await fetch(`http://localhost:5905${c}`); return { status: r.status, corpo: await r.json() }; };
    assert.equal((await g('/api/clima?cidade=Salvador&registrar=0')).status, 200);
    assert.equal((await g('/api/clima?cidade=')).status, 400);
    assert.equal((await g('/api/historico')).status, 200);
    assert.equal((await g('/api/saude')).status, 200);
    assert.equal((await g('/api/localizacao?nome=Recife')).status, 200);
    assert.equal((await g('/api/localizacao?nome=xqzwkjhg')).status, 404);
    assert.equal((await g('/api/meteorologia?lat=1&lon=2')).status, 200);
    assert.equal((await g('/api/meteorologia?lat=x&lon=2')).status, 400);
  } finally { srv.close(); Object.assign(process.env, { LOC_URL, MET_URL }); }
});
