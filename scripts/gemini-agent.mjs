import 'dotenv/config';
import http from 'node:http';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash';
const AGENT_NAME = process.env.AGENT_NAME?.trim() || 'VeriBond Gemini Agent';
const AGENT_DESCRIPTION = process.env.AGENT_DESCRIPTION?.trim() || 'Basic Gemini-backed agent endpoint for VeriBond Yellow chat rail testing.';
const SYSTEM_PROMPT = process.env.AGENT_SYSTEM_PROMPT?.trim() || [
  'You are a VeriBond AI agent.',
  'Be concise, factual, and action-oriented.',
  'If uncertain, clearly say what is unknown and suggest the next best check.',
  'Avoid markdown tables unless explicitly requested.',
].join(' ');

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' && forwardedProto ? forwardedProto : 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function getCard(req) {
  const base = getBaseUrl(req);
  const chatEndpoint = `${base}/agent/chat`;
  return {
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    chatEndpoint,
    endpoints: [
      { type: 'REST', value: chatEndpoint },
      { type: 'A2A', value: `${base}/agent/card` },
    ],
    capabilities: {
      input: 'text',
      output: 'text',
      transport: 'https',
    },
  };
}

function extractGeminiText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const first = candidates[0];
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const text = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
  return text;
}

async function queryGemini(payload) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing');
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // keep empty object for error handling below
  }

  if (!response.ok) {
    const errText = typeof data?.error?.message === 'string' ? data.error.message : raw || `Gemini API error ${response.status}`;
    throw new Error(errText);
  }

  const text = extractGeminiText(data);
  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  return text;
}

function buildUserPrompt(input) {
  const { agentId, sessionId, payer, message } = input;
  return [
    'Context:',
    `- Agent ID: ${agentId || 'unknown'}`,
    `- Session ID: ${sessionId || 'unknown'}`,
    `- Payer: ${payer || 'unknown'}`,
    '',
    'User message:',
    String(message || ''),
  ].join('\n');
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);

    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/agent/card')) {
      return sendJson(res, 200, getCard(req));
    }

    if (method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        model: GEMINI_MODEL,
        hasApiKey: !!GEMINI_API_KEY,
      });
    }

    if (method === 'POST' && url.pathname === '/agent/chat') {
      const body = await readJsonBody(req);
      const message = typeof body?.message === 'string' ? body.message.trim() : '';

      if (!message) {
        return sendJson(res, 400, { error: 'message is required' });
      }

      const prompt = buildUserPrompt(body);
      const reply = await queryGemini({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512,
        },
      });

      return sendJson(res, 200, {
        reply,
        provider: 'gemini',
        model: GEMINI_MODEL,
      });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[gemini-agent] listening on http://${HOST}:${PORT}`);
  if (!GEMINI_API_KEY) {
    console.warn('[gemini-agent] GEMINI_API_KEY is not set. /agent/chat will fail until it is configured.');
  }
});
