/* =========================================================
   Meteo / Painel — consulta de clima com Open-Meteo
   Camadas: dados (API Gateway real) → estado → interface
   ========================================================= */
const API = '/api';        // API Gateway (mesma origem): /api/clima?cidade=…
const TIMEOUT = 15000;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round = n => Math.round(n) || 0;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const hero = $('#clima');

/* ---------- ícones (traço) com partes animáveis ---------- */
const CLOUD = '<path d="M16 40h20a8 8 0 0 0 .8-15.96A11 11 0 0 0 15.6 27 7 7 0 0 0 16 40z"/>';
const SHAPE = '<path d="M16 32h20a8 8 0 0 0 .8-15.96A11 11 0 0 0 15.6 19 7 7 0 0 0 16 32z"/>';
const ICONS = {
  sun:   '<g class="rays"><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/></g><circle cx="24" cy="24" r="7"/>',
  moon:  '<g class="moonp"><path d="M36 28A14 14 0 0 1 20 12a14 14 0 1 0 16 16z"/></g>',
  partly:'<g class="rays sm"><path d="M17 4v2M6 15h2M9 7l1.5 1.5M25 7l-1.5 1.5"/></g><circle cx="17" cy="15" r="5"/><g class="bob"><path d="M17 41h20a8 8 0 0 0 .8-15.96A11 11 0 0 0 16.6 28 7 7 0 0 0 17 41z"/></g>',
  partlyNight:'<g class="moonp"><path d="M24 14a8 8 0 0 1-9-9 8 8 0 1 0 9 9z"/></g><g class="bob"><path d="M17 41h20a8 8 0 0 0 .8-15.96A11 11 0 0 0 16.6 28 7 7 0 0 0 17 41z"/></g>',
  cloud: '<g class="bob">' + CLOUD + '</g>',
  fog:   '<g class="bob"><path d="M16 34h20a8 8 0 0 0 .8-15.96A11 11 0 0 0 15.6 21 7 7 0 0 0 16 34z"/><path d="M12 40h24M16 45h18"/></g>',
  rain:  SHAPE + '<path class="dr" d="M18 37l-2 6"/><path class="dr" d="M26 37l-2 6"/><path class="dr" d="M34 37l-2 6"/>',
  snow:  SHAPE + '<path class="dr" d="M18 38v.01" stroke-width="4"/><path class="dr" d="M26 38v.01" stroke-width="4"/><path class="dr" d="M34 38v.01" stroke-width="4"/><path class="dr" d="M22 43v.01" stroke-width="4"/><path class="dr" d="M30 43v.01" stroke-width="4"/>',
  storm: SHAPE + '<path class="bolt" d="M26 33l-5 7h6l-4 6"/>'
};
const icon = (k, anim = false) =>
  `<svg class="${anim ? 'ia' : ''}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

/* ---------- código meteorológico WMO → descrição, ícone e céu ---------- */
function wmo(c, day = 1) {
  const d = !!day;
  if (c === 0) return {t: d ? 'Céu limpo' : 'Noite limpa', i: d ? 'sun' : 'moon', sky: d ? 'clear-day' : 'clear-night', orb: d ? 'sun' : 'moon'};
  if (c === 1) return {t: 'Predomínio de sol', i: d ? 'partly' : 'partlyNight', sky: d ? 'partly-day' : 'partly-night', orb: d ? 'sun' : 'moon'};
  if (c === 2) return {t: 'Parcialmente nublado', i: d ? 'partly' : 'partlyNight', sky: d ? 'partly-day' : 'partly-night', orb: d ? 'sun' : 'moon'};
  if (c === 3) return {t: 'Nublado', i: 'cloud', sky: 'cloudy', orb: 'none'};
  if (c === 45 || c === 48) return {t: 'Neblina', i: 'fog', sky: 'fog', orb: 'none'};
  if (c >= 51 && c <= 57) return {t: 'Garoa', i: 'rain', sky: 'rain', orb: 'none'};
  if (c >= 61 && c <= 67) return {t: 'Chuva', i: 'rain', sky: 'rain', orb: 'none'};
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return {t: 'Neve', i: 'snow', sky: 'snow', orb: 'none'};
  if (c >= 80 && c <= 82) return {t: 'Pancadas de chuva', i: 'rain', sky: 'rain', orb: 'none'};
  if (c >= 95) return {t: c === 95 ? 'Trovoada' : 'Trovoada com granizo', i: 'storm', sky: 'storm', orb: 'none'};
  return {t: 'Indefinido', i: 'cloud', sky: 'cloudy', orb: 'none'};
}
const compass = d => ['N','NE','L','SE','S','SO','O','NO'][Math.round(d / 45) % 8];
const uvLevel = u => u < 3 ? 'baixo' : u < 6 ? 'moderado' : u < 8 ? 'alto' : u < 11 ? 'muito alto' : 'extremo';
const label = c => [c.name, c.admin1, c.country].filter(Boolean).join(', ');
const region = c => [c.admin1, c.country].filter(Boolean).join(', ');

/* =========================================================
   1. Camada de dados — equivale ao gateway (200 / 400 / 404 / 502)
   ========================================================= */
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/** Chama o gateway. Devolve {status, corpo}; falha de rede/timeout vira 502. */
async function chamarGateway(caminho) {
  try {
    const r = await fetch(API + caminho, {signal: AbortSignal.timeout(TIMEOUT)});
    let corpo = null; try { corpo = await r.json(); } catch {}
    return {status: r.status, corpo};
  } catch { return {status: 502, corpo: {erro: 'Gateway indisponível ou tempo limite excedido.'}}; }
}
async function getJSON(caminho) {
  const {status, corpo} = await chamarGateway(caminho);
  if (status !== 200) throw new ApiError(status, corpo?.erro || 'falha de serviço externo');
  return corpo;
}
/** GET /api/clima?cidade=…[&id=…] → {localidade, localidades, clima, historico} */
function consultarClima(nome, {id, registrar = true} = {}) {
  const q = new URLSearchParams({cidade: nome});
  if (id != null) q.set('id', id);
  if (!registrar) q.set('registrar', '0');
  return getJSON(`/clima?${q}`);
}

/* =========================================================
   2. Céu: gradientes, órbita, chuva, neve e estrelas
   ========================================================= */
const SKIES = ['clear-day','partly-day','clear-night','partly-night','cloudy','rain','storm','snow','fog'];
const skyEl = $('#sky');
skyEl.innerHTML = SKIES.map(k => `<i data-k="${k}"></i>`).join('');

const fx = (() => {
  const cv = $('#fx'), ctx = cv.getContext('2d');
  let W = 0, H = 0, mode = 'none', parts = [], raf = 0, last = 0, onscreen = true;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function make(init) {
    if (mode === 'rain' || mode === 'storm') {
      const storm = mode === 'storm';
      return {x: rnd(-80, W + 80), y: init ? rnd(0, H) : rnd(-60, -5), len: rnd(10, 22), v: rnd(storm ? 16 : 12, storm ? 26 : 19), a: rnd(.25, .55)};
    }
    if (mode === 'snow') return {x: rnd(0, W), y: init ? rnd(0, H) : -6, r: rnd(1, 3.4), v: rnd(.5, 1.5), ph: rnd(0, 6.28), a: rnd(.5, .95)};
    if (mode === 'stars') return {x: rnd(0, W), y: rnd(0, H * .72), r: rnd(.4, 1.5), ph: rnd(0, 6.28), sp: rnd(.015, .045)};
    return {};
  }
  function seed() {
    const n = {rain: W / 6, storm: W / 3.6, snow: W / 11, stars: W / 8}[mode] || 0;
    parts = Array.from({length: Math.round(n)}, () => make(true));
  }
  function size() {
    const r = hero.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); seed();
    if (reduceMotion.matches) frame(0, true);
  }
  function frame(t, still) {
    const k = still ? 0 : Math.min((t - last) / 16.67 || 1, 3); last = t;
    ctx.clearRect(0, 0, W, H);
    const slant = mode === 'storm' ? .28 : .14;
    for (const p of parts) {
      if (mode === 'rain' || mode === 'storm') {
        p.y += p.v * k; p.x -= p.v * slant * k;
        if (p.y > H) Object.assign(p, make(false));
        ctx.strokeStyle = `rgba(214,232,255,${p.a})`; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.len * slant, p.y - p.len); ctx.stroke();
      } else if (mode === 'snow') {
        p.y += p.v * k; p.ph += .015 * k; p.x += Math.sin(p.ph) * .5 * k;
        if (p.y > H + 6) Object.assign(p, make(false));
        ctx.fillStyle = `rgba(255,255,255,${p.a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      } else if (mode === 'stars') {
        p.ph += p.sp * k;
        ctx.fillStyle = `rgba(255,255,255,${.35 + .65 * Math.abs(Math.sin(p.ph))})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
    }
  }
  function loop(t) { frame(t); raf = requestAnimationFrame(loop); }
  function run() {
    cancelAnimationFrame(raf);
    if (reduceMotion.matches || !onscreen || document.hidden || mode === 'none') { frame(0, true); return; }
    last = performance.now(); raf = requestAnimationFrame(loop);
  }
  new IntersectionObserver(e => { onscreen = e[0].isIntersecting; run(); }).observe(hero);
  document.addEventListener('visibilitychange', run);
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(size, 150); });
  size();
  return {set(m) { mode = m; seed(); run(); }};
})();

function setSky(w) {
  hero.dataset.sky = w.sky; hero.dataset.orb = w.orb;
  skyEl.querySelectorAll('i').forEach(i => i.classList.toggle('on', i.dataset.k === w.sky));
  fx.set({rain: 'rain', storm: 'storm', snow: 'snow', 'clear-night': 'stars', 'partly-night': 'stars'}[w.sky] || 'none');
}
setSky(wmo(0, 1)); // céu inicial até a primeira resposta

/* barra de navegação: transparente sobre o céu, sólida depois */
const nav = $('#nav');
const navState = () => nav.classList.toggle('solid', scrollY > hero.offsetHeight - 90);
addEventListener('scroll', navState, {passive: true}); navState();

/* =========================================================
   3. Estado
   ========================================================= */
let locs = [], current = null, lastTemp = 0, selectedId = null;
const cache = new Map();
let recent = [];   // histórico das últimas 5 cidades — mantido pelo gateway (GET /api/historico)
const setRecent = lista => { recent = (lista || []).map(c => ({c})); };

/* =========================================================
   4. Consulta
   ========================================================= */
const nowEl = $('#now');
function showLoading() {
  nowEl.innerHTML = '<div class="loading"><span class="dots"><i></i><i></i><i></i></span>Consultando as condições meteorológicas…</div>';
}
function showError(e, retry) {
  const code = e instanceof ApiError ? e.status : 502;
  const msg = {
    400: 'Informe uma cidade com 2 a 100 caracteres.',
    404: 'Nenhuma localidade encontrada. Verifique a grafia e tente novamente.',
    502: 'Não foi possível consultar o serviço meteorológico agora: ele está indisponível ou demorou demais para responder.'
  }[code];
  nowEl.innerHTML = `<div class="err" role="alert"><b>${code}</b><p>${msg}</p>${code === 502 ? '<button type="button">Tentar de novo</button>' : ''}</div>`;
  const b = nowEl.querySelector('button'); if (b) b.onclick = retry;
}

async function consultar(nome) {
  const go = $('#go'); go.disabled = true; showLoading();
  try {
    const d = await consultarClima(nome);
    locs = d.localidades;
    renderChips();
    aplicar(d);
  } catch (e) { $('#pick').hidden = true; showError(e, () => consultar(nome)); }
  finally { go.disabled = false; }
}

function renderChips() {
  const labels = locs.map(label);
  $('#found').textContent = `Encontramos ${locs.length} localidade${locs.length > 1 ? 's' : ''}. Escolha a cidade correta.`;
  $('#chips').innerHTML = locs.map((c, i) => {
    const dup = labels.indexOf(labels[i]) !== labels.lastIndexOf(labels[i]);
    return `<button type="button" class="chip" data-i="${i}" style="animation-delay:${i * 45}ms" aria-pressed="${i === 0}">${esc(label(c))}${dup ? `<small>${c.latitude.toFixed(2)}, ${c.longitude.toFixed(2)}</small>` : ''}</button>`;
  }).join('');
  $('#pick').hidden = false;
}
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  const c = locs[+b.dataset.i];
  $('#city').value = c.name;
  $('#chips').querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  verClima(c);
});

/** Aplica a resposta do gateway à interface. */
function aplicar(d) {
  const c = d.localidade, w = d.clima;
  current = c; selectedId = c.id; cache.set(c.id, {c, w});
  setRecent(d.historico);
  renderNow(c, w); renderForecast(c, w); renderRecent(); renderCompareSelects();
}
async function verClima(c, {keep = false} = {}) {
  const prev = nowEl.querySelector('.now-in');
  if (keep && prev) prev.classList.add('busy'); else showLoading();
  try { aplicar(await consultarClima(c.name, {id: c.id})); }
  catch (e) { showError(e, () => verClima(c)); }
}

/* ---------- temperatura que sobe contando ---------- */
function countTo(el, to) {
  const from = lastTemp; lastTemp = to;
  if (reduceMotion.matches || from === to) { el.textContent = to; return; }
  const t0 = performance.now(), ms = 1100;
  (function step(t) {
    const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

/* ---------- bloco "agora" ---------- */
function renderNow(c, w) {
  const cur = w.current, d = w.daily, now = wmo(cur.weather_code, cur.is_day);
  setSky(now);
  const obs = new Date(cur.time).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}).replace(', ', ' às ');
  const uv = d.uv_index_max[0], wd = cur.wind_direction_10m;
  nowEl.innerHTML = `
  <div class="now-in">
    <div>
      <div class="place">
        <h2>${esc(c.name)}</h2>
        <p class="where">${esc(region(c))}</p>
        <p class="meta">Latitude ${c.latitude.toFixed(4)}, longitude ${c.longitude.toFixed(4)}</p>
        <p class="meta">Observação em ${esc(obs)}, horário local</p>
      </div>
      <div class="temp" aria-label="${round(cur.temperature_2m)} graus Celsius"><span id="tnum">0</span><sup>°C</sup></div>
      <div class="cond">${icon(now.i, true)}<span>${now.t}</span></div>
      <button class="refresh" id="refresh" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>
        Atualizar dados
      </button>
    </div>
    <ul class="facts">
      <li class="fact"><span class="k">Máxima e mínima de hoje</span><span class="v">${round(d.temperature_2m_max[0])}° <small>/ ${round(d.temperature_2m_min[0])}°</small></span></li>
      <li class="fact"><span class="k">Sensação térmica</span><span class="v">${round(cur.apparent_temperature)}°C</span></li>
      <li class="fact"><span class="k">Vento</span><span class="v" title="Vindo do ${compass(wd)}">
        <svg class="arrow" id="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(180deg)"><path d="M12 20V4M6 10l6-6 6 6"/></svg>
        ${round(cur.wind_speed_10m)} <small>km/h ${compass(wd)} (${round(wd)}°)</small></span></li>
      <li class="fact"><span class="k">Índice UV de hoje</span><span class="v">${round(uv)} <small>${uvLevel(uv)}</small></span><span class="meter uv"><i style="--p:${Math.min(uv / 11, 1) * 100}%"></i></span></li>
      <li class="fact"><span class="k">Umidade</span><span class="v">${cur.relative_humidity_2m}%</span><span class="meter"><i style="--p:${cur.relative_humidity_2m}%"></i></span></li>
    </ul>
  </div>`;
  countTo($('#tnum'), round(cur.temperature_2m));
  // a seta gira até a direção para onde o vento sopra
  requestAnimationFrame(() => requestAnimationFrame(() => { const a = $('#arrow'); if (a) a.style.transform = `rotate(${wd + 180}deg)`; }));
  $('#refresh').onclick = () => verClima(c, {keep: true});
}

/* ---------- previsão: cinco dias + gráfico ---------- */
function renderForecast(c, w) {
  const d = w.daily;
  $('#previsao').hidden = false;
  $('#fc-sub').textContent = `${label(c)}. Mínimas e máximas previstas para cada dia.`;
  const days = d.time.map((t, i) => {
    const dt = new Date(t + 'T12:00');
    return {
      n: i === 0 ? 'Hoje' : dt.toLocaleDateString('pt-BR', {weekday: 'long'}).replace('-feira', ''),
      short: i === 0 ? 'Hoje' : dt.toLocaleDateString('pt-BR', {weekday: 'short'}).replace('.', ''),
      date: dt.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'}),
      max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], w: wmo(d.weather_code[i], 1)
    };
  });
  $('#days').innerHTML = days.map(x => `
    <div class="day"><span class="dn">${x.n}</span><span class="dd">${x.date}</span>${icon(x.w.i)}
      <span class="dc">${x.w.t}</span><span class="dmax">${round(x.max)}°</span><span class="dmin">mín ${round(x.min)}°</span></div>`).join('');
  $('#chart').innerHTML = chart(days);
}

function chart(days) {
  const W = 760, H = 300, pt = 40, pb = 40, pl = 36, pr = 24;
  const all = days.flatMap(d => [d.min, d.max]);
  const lo = Math.floor(Math.min(...all) / 5) * 5 - 5, hi = Math.ceil(Math.max(...all) / 5) * 5 + 5;
  const y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo || 1));
  const gw = (W - pl - pr) / (days.length - 1 || 1), x = i => pl + gw * i;
  const path = k => days.map((d, i) => {
    if (i === 0) return `M${x(0)},${y(d[k])}`;
    const mx = (x(i - 1) + x(i)) / 2; return `C${mx},${y(days[i - 1][k])} ${mx},${y(d[k])} ${x(i)},${y(d[k])}`;
  }).join(' ');
  const back = days.map((d, i) => {
    const j = days.length - 1 - i, mx = (x(j + 1) + x(j)) / 2;
    return i === 0 ? `L${x(j)},${y(days[j].min)}` : `C${mx},${y(days[j + 1].min)} ${mx},${y(days[j].min)} ${x(j)},${y(days[j].min)}`;
  }).join(' ');
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de linhas com a temperatura máxima e mínima de cada um dos próximos cinco dias">
    <defs><linearGradient id="bandg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--hot)" stop-opacity=".22"/><stop offset="1" stop-color="var(--cold)" stop-opacity=".18"/></linearGradient></defs>`;
  for (let v = lo; v <= hi; v += 5) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}°</text>`;
  s += `<path class="band" d="${path('max')} ${back} Z" fill="url(#bandg)"/>`;
  s += `<path class="ln hot" pathLength="1" d="${path('max')}"/><path class="ln cold" pathLength="1" d="${path('min')}"/>`;
  days.forEach((d, i) => {
    const dl = 700 + i * 160;
    s += `<g class="pt" style="animation-delay:${dl}ms">
      <circle cx="${x(i)}" cy="${y(d.max)}" r="5" fill="var(--card)" stroke="var(--hot)" stroke-width="3"/>
      <text x="${x(i)}" y="${y(d.max) - 14}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${round(d.max)}°</text>
      <circle cx="${x(i)}" cy="${y(d.min)}" r="5" fill="var(--card)" stroke="var(--cold)" stroke-width="3"/>
      <text x="${x(i)}" y="${y(d.min) + 24}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${round(d.min)}°</text></g>
      <text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="12.5" fill="var(--muted)" style="text-transform:capitalize">${d.short}</text>`;
  });
  return s + '</svg>';
}

/* ---------- recentes e comparação ---------- */
function renderRecent() {
  $('#recent').innerHTML = recent.length
    ? recent.map((r, i) => `<li><button type="button" data-i="${i}"><b>${esc(r.c.name)}</b><small>${esc(region(r.c))}</small></button></li>`).join('')
    : '<li class="empty">Nenhuma cidade consultada ainda.</li>';
}
$('#recent').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const c = recent[+b.dataset.i].c; $('#city').value = c.name; verClima(c);
  $('#clima').scrollIntoView({behavior: reduceMotion.matches ? 'auto' : 'smooth'});
});

function renderCompareSelects() {
  const A = $('#cmpA'), B = $('#cmpB'), a = A.value, b = B.value;
  A.innerHTML = B.innerHTML = recent.map(r => `<option value="${r.c.id}">${esc(label(r.c))}</option>`).join('');
  if (recent.length >= 2) {
    A.value = recent.some(r => String(r.c.id) === a) ? a : recent[1].c.id;
    B.value = recent.some(r => String(r.c.id) === b) && b !== A.value ? b : recent[0].c.id;
  }
  compare();
}
async function compare() {
  const out = $('#cmp-out');
  if (recent.length < 2) { out.innerHTML = '<p class="empty">Consulte pelo menos duas cidades para comparar.</p>'; return; }
  const ia = +$('#cmpA').value, ib = +$('#cmpB').value;
  if (ia === ib) { out.innerHTML = '<p class="empty">Escolha duas cidades diferentes.</p>'; return; }
  out.innerHTML = '<p class="empty">Carregando comparação…</p>';
  try {
    const get = async id => { if (!cache.has(id)) { const c = recent.find(r => r.c.id === id).c; cache.set(id, {c, w: (await consultarClima(c.name, {id: c.id, registrar: false})).clima}); } return cache.get(id); };
    const [A, B] = await Promise.all([get(ia), get(ib)]);
    const all = [...A.w.daily.temperature_2m_min, ...A.w.daily.temperature_2m_max, ...B.w.daily.temperature_2m_min, ...B.w.daily.temperature_2m_max];
    const lo = Math.min(...all), hi = Math.max(...all), span = (hi - lo) || 1;
    const rng = (mn, mx) => `<div class="rng"><span>${round(mn)}°</span><span class="trk"><i style="left:${(mn - lo) / span * 100}%;width:${Math.max((mx - mn) / span * 100, 5)}%"></i></span><span class="mx">${round(mx)}°</span></div>`;
    const rows = A.w.daily.time.map((t, i) => `<tr><td>${i === 0 ? 'Hoje' : new Date(t + 'T12:00').toLocaleDateString('pt-BR', {weekday: 'short'}).replace('.', '')}</td>
      <td>${rng(A.w.daily.temperature_2m_min[i], A.w.daily.temperature_2m_max[i])}</td><td>${rng(B.w.daily.temperature_2m_min[i], B.w.daily.temperature_2m_max[i])}</td></tr>`).join('');
    out.innerHTML = `<table class="cmp"><thead><tr><th>Dia</th><th>${esc(A.c.name)}</th><th>${esc(B.c.name)}</th></tr></thead><tbody>
      <tr class="now-row"><td>Agora</td><td>${round(A.w.current.temperature_2m)}°C</td><td>${round(B.w.current.temperature_2m)}°C</td></tr>${rows}</tbody></table>`;
  } catch { out.innerHTML = '<p class="empty">502 · não foi possível carregar a comparação. Tente novamente.</p>'; }
}
$('#cmpA').onchange = $('#cmpB').onchange = compare;

/* ---------- formulário ---------- */
$('#form').addEventListener('submit', e => { e.preventDefault(); consultar($('#city').value); });

/* =========================================================
   5. Checklist
   ========================================================= */
const ITEMS = ['Executar a aplicação e consultar Salvador','Consultar três cidades brasileiras diferentes','Consultar uma cidade localizada fora do Brasil','Exibir o estado e o país do local consultado','Exibir latitude e longitude','Adicionar a data e o horário da observação meteorológica','Apresentar a sensação térmica','Exibir a velocidade e a direção do vento','Adicionar o índice de radiação ultravioleta (UV) à consulta','Exibir temperaturas máximas e mínimas dos próximos cinco dias','Adicionar ícones conforme o código meteorológico WMO','Tratar cidades inexistentes e campos vazios','Permitir escolher entre cidades homônimas retornadas pelo Geocoding','Criar um gráfico de temperaturas por dia','Permitir comparar a previsão de duas cidades','Adicionar um botão para atualizar os dados meteorológicos','Registrar o histórico das últimas cinco cidades consultadas','Separar a busca de cidades e a consulta meteorológica em dois microsserviços','Criar um API Gateway para centralizar as consultas','Documentar e apresentar a arquitetura e os testes da aplicação'];
let done = []; try { done = JSON.parse(localStorage.getItem('meteo.checks')) || []; } catch {}
const ul = $('#checks');
ul.innerHTML = ITEMS.map((t, i) => `<li><label><input type="checkbox" data-i="${i}" ${done.includes(i) ? 'checked' : ''}><span>${i + 1}. ${esc(t)}</span></label></li>`).join('');
function updProg() {
  const n = done.length;
  $('#count').textContent = `${n} de 20 concluídos`;
  $('#prog i').style.width = (n / 20 * 100) + '%';
  $('#prog').setAttribute('aria-valuenow', n);
}
ul.addEventListener('change', e => {
  const i = +e.target.dataset.i;
  done = e.target.checked ? [...new Set([...done, i])] : done.filter(x => x !== i);
  try { localStorage.setItem('meteo.checks', JSON.stringify(done)); } catch {}
  updProg();
});
updProg();

/* =========================================================
   6. Testes obrigatórios
   ========================================================= */
const TESTS = [
  ['cidade=Salvador', 200, 'consulta válida', '/clima?cidade=Salvador&registrar=0'],
  ['cidade=Recife', 200, 'consulta válida', '/clima?cidade=Recife&registrar=0'],
  ['cidade=São Paulo', 200, 'consulta válida', '/clima?cidade=' + encodeURIComponent('São Paulo') + '&registrar=0'],
  ['cidade vazia', 400, 'campo inválido', '/clima?cidade='],
  ['cidade inexistente', 404, 'local não encontrado', '/clima?cidade=xqzwkjhg'],
  ['API externa indisponível ou timeout', 502, 'falha de serviço externo', '/clima?cidade=Salvador&registrar=0&simular=timeout']
];
$('#tests').innerHTML = TESTS.map((t, i) => `<tr><td>${t[0]}</td><td>${t[1]} · ${t[2]}</td><td id="t${i}"><span class="pend">Ainda não executado</span></td></tr>`).join('');
$('#runTests').onclick = async () => {
  const b = $('#runTests'); b.disabled = true;
  for (let i = 0; i < TESTS.length; i++) {
    const [, esperado, , caminho] = TESTS[i], cell = $('#t' + i);
    cell.innerHTML = '<span class="pend">Executando…</span>';
    const {status: obtido, corpo} = await chamarGateway(caminho);   // requisição HTTP real ao gateway
    const ok = obtido === esperado;
    cell.innerHTML = `<span class="badge ${ok ? 'ok' : 'bad'}" title="${esc(corpo?.erro || 'consulta bem-sucedida')}">${obtido} · ${ok ? 'passou' : 'falhou'}</span>`;
  }
  b.disabled = false;
};

/* ---------- início ---------- */
(async () => {
  const h = await chamarGateway('/historico');          // restaura o histórico mantido no gateway
  if (h.status === 200) setRecent(h.corpo.historico);
  renderRecent(); renderCompareSelects();
  consultar($('#city').value || 'Salvador');
})();
