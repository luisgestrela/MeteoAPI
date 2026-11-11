# METEO / PAINEL — Monitoramento Meteorológico

Aplicação web de consulta de clima por cidade com **API Gateway** e **dois microsserviços** em Node.js,
usando os serviços gratuitos da [Open-Meteo](https://open-meteo.com/) (Geocoding e Forecast), sem chave de API.

## Como executar

```bash
npm run dev      # sobe gateway (3000) + microsserviços (4001 e 4002)
# abra http://localhost:3000
npm test         # 15 testes de integração (a Open-Meteo é simulada: roda offline)
```

Requer Node.js 18+. Não há dependências para instalar (usa apenas módulos nativos do Node).
Portas alteráveis por variável de ambiente: `PORT`, `LOC_PORT`, `MET_PORT`.

> Abra sempre pelo endereço do gateway (`http://localhost:3000`). Abrir o `index.html` direto no
> navegador ou pelo Live Server não funciona, pois o frontend precisa da rota `/api`.

## Arquitetura

```
Frontend (HTML · CSS · JS)
        │  GET /api/clima?cidade=…
        ▼
API Gateway  :3000 ── valida entrada, orquestra, guarda histórico, serve o frontend
        ├─► Microsserviço de localização  :4001 ──► Open-Meteo Geocoding
        └─► Microsserviço de meteorologia :4002 ──► Open-Meteo Forecast
```

| Arquivo | Papel |
|---|---|
| `backend/gateway/gateway.js` | Ponto único de entrada. Valida a cidade (2–100 caracteres), chama localização e depois meteorologia, mantém o histórico das 5 últimas cidades. |
| `backend/services/localizacao.js` | Cidade → lista de localidades (nome, estado, país, latitude, longitude). |
| `backend/services/meteorologia.js` | Latitude/longitude → clima atual + previsão de 5 dias (inclui sensação térmica, vento, umidade e UV). |
| `backend/lib.js` | Utilidades comuns: servidor HTTP, `fetch` com timeout, mapeamento de erros. |
| `index.html`, `style.css`, `script.js` | Frontend, que só conversa com o gateway. |

Por que separar serviços: cada um tem uma responsabilidade, pode ser testado, escalado ou trocado
(ex.: outro provedor de geocodificação) sem mexer no outro.

## Endpoints

### Gateway (`:3000`)

| Método e rota | Descrição | Respostas |
|---|---|---|
| `GET /api/clima?cidade=Salvador` | Localiza a cidade, busca o clima e registra no histórico | 200, 400, 404, 502 |
| `GET /api/clima?cidade=Salvador&id=3450554` | Igual, escolhendo uma localidade homônima pelo `id` | 200, 400, 404, 502 |
| `GET /api/historico` | Últimas 5 cidades consultadas (mais recente primeiro) | 200 |
| `GET /api/saude` | Estado do gateway e dos microsserviços | 200 |

Parâmetros opcionais de `/api/clima`: `registrar=0` (não altera o histórico) e `simular=timeout`
(força um timeout real na API de meteorologia, para demonstrar o 502; desative com `ALLOW_SIMULATION=0`).

Resposta 200:
```json
{ "localidade": {"id": 3450554, "name": "Salvador", "admin1": "Bahia", "country": "Brasil", "latitude": -12.97, "longitude": -38.51},
  "localidades": [ … ],
  "clima": { "current": { "temperature_2m": 29.4, "apparent_temperature": 32, "wind_speed_10m": 14, … },
             "daily":   { "time": [ … 5 dias ], "temperature_2m_max": [ … ], "temperature_2m_min": [ … ], "uv_index_max": [ … ] } },
  "historico": [ … ] }
```
Erros: `{ "erro": "mensagem" }`.

### Microsserviços
- `GET :4001/localizar?nome=Salvador` → `{ "resultados": [ … ] }` (200, 400, 404, 502)
- `GET :4002/clima?lat=-12.97&lon=-38.51` → `{ "current": …, "daily": … }` (200, 400, 502)

### Códigos de status

| Código | Quando |
|---|---|
| 200 | Consulta bem-sucedida |
| 400 | Cidade vazia, com menos de 2 ou mais de 100 caracteres (ou coordenadas inválidas) |
| 404 | Nenhuma localização encontrada |
| 502 | Open-Meteo indisponível, com erro ou acima do tempo limite (8 s); microsserviço fora do ar |

## Testes

**Pelo painel:** seção "Testes obrigatórios" → *Executar testes*. Cada linha faz uma requisição HTTP real ao gateway.

| Cenário | Esperado |
|---|---|
| `cidade=Salvador` | 200 |
| `cidade=Recife` | 200 |
| `cidade=São Paulo` | 200 |
| cidade vazia | 400 |
| cidade inexistente (`xqzwkjhg`) | 404 |
| API externa indisponível / timeout | 502 |

**Pelo terminal:** `npm test` roda os 6 cenários acima e mais casos (1 caractere, mais de 100 caracteres,
escolha de homônimas por `id`, histórico limitado a 5 sem repetição, microsserviços isolados e `/api/saude`).

Exemplos com `curl`:
```bash
curl "http://localhost:3000/api/clima?cidade=Salvador"
curl -i "http://localhost:3000/api/clima?cidade="                 # 400
curl -i "http://localhost:3000/api/clima?cidade=xqzwkjhg"         # 404
curl -i "http://localhost:3000/api/clima?cidade=Salvador&simular=timeout"   # 502
```

## Questões para discussão

1. **Frontend direto × backend:** o backend esconde detalhes e chaves das APIs, centraliza validação, tratamento de erros, cache e histórico, e permite trocar o provedor sem alterar o frontend.
2. **Latitude e longitude:** nomes de cidades são ambíguos (há várias "Salvador"); coordenadas identificam um ponto único.
3. **Atual × previsão:** dados atuais são observações do momento; a previsão é uma estimativa para dias futuros e pode mudar.
4. **Open-Meteo fora do ar:** o gateway responde 502 com mensagem clara e o frontend oferece "Tentar de novo".
5. **Vantagens de separar os serviços:** responsabilidades isoladas, testes independentes, escalabilidade e troca de provedor sem efeito colateral.
