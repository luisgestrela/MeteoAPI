// Função serverless (Vercel) → microsserviço de meteorologia (GET /api/meteorologia?lat=…&lon=…)
module.exports = require('../backend/services/meteorologia').handler;
