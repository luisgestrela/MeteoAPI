// npm run dev → sobe o gateway (porta 3000) e os dois microsserviços (4001 e 4002).
const { fork } = require('child_process');
const path = require('path');

const procs = [
  ['localizacao', 'backend/services/localizacao.js'],
  ['meteorologia', 'backend/services/meteorologia.js'],
  ['gateway', 'backend/gateway/gateway.js']
].map(([nome, arq]) => {
  const p = fork(path.join(__dirname, arq), { stdio: 'inherit' });
  p.on('exit', code => { if (code) { console.error(`[${nome}] encerrou com código ${code}`); encerrar(code); } });
  return p;
});

function encerrar(code = 0) { procs.forEach(p => p.kill()); process.exit(code); }
process.on('SIGINT', () => encerrar());
process.on('SIGTERM', () => encerrar());
console.log('Aplicação rodando em http://localhost:' + (process.env.PORT || 3000));
