// npm run dev → sobe o gateway (3000) e os dois microsserviços (4001 e 4002) como processos separados.
// (Uso local apenas. Na Vercel, o site vem de public/ e a API das funções em api/.)
const { fork } = require('child_process');
const path = require('path');

const env = {
  ...process.env,
  LOC_URL: `http://localhost:${process.env.LOC_PORT || 4001}`,
  MET_URL: `http://localhost:${process.env.MET_PORT || 4002}`
};

const procs = [
  ['localizacao', 'backend/services/localizacao.js'],
  ['meteorologia', 'backend/services/meteorologia.js'],
  ['gateway', 'backend/gateway/gateway.js']
].map(([nome, arq]) => {
  const p = fork(path.join(__dirname, arq), { stdio: 'inherit', env });
  p.on('exit', code => { if (code) { console.error(`[${nome}] encerrou com código ${code}`); encerrar(code); } });
  return p;
});

function encerrar(code = 0) { procs.forEach(p => p.kill()); process.exit(code); }
process.on('SIGINT', () => encerrar());
process.on('SIGTERM', () => encerrar());
console.log('Aplicação rodando em http://localhost:' + (process.env.PORT || 3000));
