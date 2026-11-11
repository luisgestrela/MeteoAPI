// Função serverless (Vercel) → microsserviço de localização (GET /api/localizacao?nome=…)
module.exports = require('../backend/services/localizacao').handler;
