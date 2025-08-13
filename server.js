const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração em memória para autenticação
const config = {
  clientId: 'meu-client',
  clientSecret: 'minha-senha',
};

// In-memory storage for recent logs and connected SSE clients
const requestLogs = [];
const sseClients = new Set();
const MAX_LOGS = 200;

function broadcastLog(logEntry) {
  const payload = `data: ${JSON.stringify(logEntry)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

function sanitizeRequest(req) {
  // Não mascarar nada: retornar cabeçalhos e body como estão
  return { headers: req.headers, body: req.body };
}

// Middleware para capturar requests e responses
app.use((req, res, next) => {
  const startMs = Date.now();
  const pathStr = String(req.path || '');
  const shouldLog = !(pathStr.startsWith('/config') || pathStr === '/logs/clear');

  const { headers: safeHeaders, body: safeBody } = sanitizeRequest(req);
  const requestInfo = {
    method: req.method,
    path: req.originalUrl || req.url,
    headers: safeHeaders,
    query: req.query,
    body: safeBody,
  };

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let hasLogged = false;

  function finalizeLog(responseBody, responseType) {
    if (!shouldLog || hasLogged) return; // evita duplicidade e oculta /config
    hasLogged = true;
    const durationMs = Date.now() - startMs;
    const logEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      durationMs,
      request: requestInfo,
      response: {
        status: res.statusCode,
        type: responseType,
        body: responseBody,
      },
    };

    requestLogs.push(logEntry);
    if (requestLogs.length > MAX_LOGS) requestLogs.shift();
    broadcastLog(logEntry);
  }

  res.json = (body) => {
    finalizeLog(body, 'json');
    return originalJson(body);
  };

  res.send = (body) => {
    // Try to stringify Buffers/objects safely for logging only
    let loggedBody = body;
    try {
      if (Buffer.isBuffer(body)) loggedBody = body.toString('utf8');
    } catch {}
    finalizeLog(loggedBody, 'send');
    return originalSend(body);
  };

  next();
});

// SSE endpoint para transmitir eventos em tempo real
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Envia histórico inicial
  for (const logEntry of requestLogs) {
    res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
  }

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Servir UI estática
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Limpar logs no servidor
app.post('/logs/clear', (req, res) => {
  requestLogs.length = 0;
  res.json({ ok: true });
});

// Endpoints de configuração
app.get('/config', (req, res) => {
  res.json({ client_id: config.clientId, client_secret: config.clientSecret });
});

app.post('/config', (req, res) => {
  const { client_id, client_secret } = req.body || {};
  if (typeof client_id === 'string' && client_id.trim() !== '') config.clientId = client_id;
  if (typeof client_secret === 'string' && client_secret.trim() !== '') config.clientSecret = client_secret;
  res.json({ ok: true, client_id: config.clientId });
});

function parseBasicAuth(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const [scheme, token] = headerValue.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return { client_id: decoded.slice(0, idx), client_secret: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

app.post('/obter-token', (req, res) => {
  console.log(req.body);
  console.log(req.params);
  console.log("POST recebido com sucesso!");
  
  // Captura credenciais do body ou Authorization Basic
  let { client_id, client_secret } = req.body || {};
  if (!client_id || !client_secret) {
    const parsed = parseBasicAuth(req.headers.authorization);
    if (parsed) {
      client_id = client_id || parsed.client_id;
      client_secret = client_secret || parsed.client_secret;
    }
  }

  if (client_id !== config.clientId || client_secret !== config.clientSecret) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'client_id ou client_secret inválidos',
    });
  }

  const token = Buffer.from(`${client_id}:${Date.now()}:${Math.random()}`)
    .toString('base64')
    .replace(/=+$/, '');

  res.json({ 
    access_token: token,
    expires_in: 7200,
    token_type: 'Bearer',
  });
  
});

app.post('/obter-token/erro', (req, res) => {
  console.log(req.body);
  console.log(req.params);
  console.log("POST recebido com sucesso!");


  res.status(400).json({
    message: 'Erro ao processar a requisição',
    error: 'Bad Request',
  });
  
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
}); 