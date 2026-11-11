// Utilidades compartilhadas pelo gateway e pelos microsserviços (sem dependências externas)
const http = require('http');

const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 8000;

/** Erro com código HTTP, usado para mapear falhas em 400 / 404 / 502. */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function enviarJSON(res, status, corpo) {
  const txt = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(txt),
    'Cache-Control': 'no-store'
  });
  res.end(txt);
}

/**
 * GET JSON com timeout. Qualquer falha de rede, timeout ou resposta não-2xx
 * do serviço externo vira HttpError 502 (indisponibilidade externa).
 * Se `repassarErro` for true, o status/mensagem do serviço interno é preservado.
 */
async function buscarJSON(url, { timeout = TIMEOUT_MS, repassarErro = false } = {}) {
  let resp;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new HttpError(502, 'Serviço externo indisponível ou tempo limite excedido.');
  }
  let corpo = null;
  try { corpo = await resp.json(); } catch { /* corpo não JSON */ }
  if (!resp.ok) {
    if (repassarErro && corpo && corpo.erro) throw new HttpError(resp.status, corpo.erro);
    throw new HttpError(502, 'Serviço externo respondeu com erro.');
  }
  if (corpo === null) throw new HttpError(502, 'Resposta inválida do serviço externo.');
  return corpo;
}

/** Cria um servidor HTTP simples a partir de um mapa { 'GET /rota': handler(url, req) }. */
function criarServidor(nome, rotas, extra) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const t0 = Date.now();
    try {
      if (extra && await extra(req, res, url)) return;
      const handler = rotas[`${req.method} ${url.pathname}`];
      if (!handler) throw new HttpError(404, 'Rota não encontrada.');
      enviarJSON(res, 200, await handler(url, req));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error(`[${nome}]`, e);
      enviarJSON(res, status, { erro: status === 500 ? 'Erro interno.' : e.message });
    } finally {
      console.log(`[${nome}] ${req.method} ${req.url} → ${res.statusCode} (${Date.now() - t0} ms)`);
    }
  });
}

module.exports = { HttpError, enviarJSON, buscarJSON, criarServidor, TIMEOUT_MS };
