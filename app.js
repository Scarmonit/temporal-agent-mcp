// Express app configuration (separted for testability)
// SECURITY HARDENED: Rate limiting (HIGH-3), Error disclosure (HIGH-4)

import express from 'express';
import config from './config.js';
import { logSecurityEvent } from './utils/security.js';

const app = express();

// HIGH-3 FIX: In-memory rate limiter (per IP)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 100; // per window

export function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', { ip, count: record.count });
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((record.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count };
}

// Export for testing
export function resetRateLimits() {
  rateLimitStore.clear();
}

export function setRateLimitConfig(maxRequests) {
  // For testing - allows setting lower limits
  return { RATE_LIMIT_MAX_REQUESTS: maxRequests };
}

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref(); // unref() so it doesn't keep process alive in tests

// Helper to get client IP
export function getClientIp(req) {
  return req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    'unknown';
}

// MEDIUM-2 FIX: Strict JSON parsing
app.use(express.json({
  limit: '1mb',
  strict: true,
  type: 'application/json',
}));

// Content-Type enforcement middleware for POST requests
app.use((req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({
      error: 'Unsupported Media Type',
      message: 'Content-Type must be application/json',
    });
  }
  next();
});

// HIGH-3 FIX: Rate limiting middleware
app.use('/mcp', (req, res, next) => {
  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);

  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', rateLimit.retryAfter);
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: rateLimit.retryAfter,
    });
  }

  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[HTTP] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'temporal-agent-mcp',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// MCP Protocol: List available tools (stub for testing)
app.get('/mcp/tools', (req, res) => {
  res.json({
    tools: [],
  });
});

// MCP Protocol: Execute a tool (stub for testing)
app.post('/mcp/execute', async (req, res, next) => {
  try {
    const { tool, params, context } = req.body;

    if (!tool) {
      return res.status(400).json({
        error: 'Missing required field: tool',
      });
    }

    // For testing - simulate different scenarios
    if (tool === 'throw_db_error') {
      throw new Error('ECONNREFUSED: Connection refused to database at 127.0.0.1:5432');
    }

    if (tool === 'throw_internal_error') {
      const err = new Error('Something went wrong internally');
      err.stack = 'Error: Something went wrong internally\n    at Object.<anonymous> (/app/index.js:123:45)\n    at processTicksAndRejections (internal/process/task_queues.js:95:5)';
      throw err;
    }

    res.json({ success: true, tool });
  } catch (error) {
    next(error);
  }
});

// Standard MCP JSON-RPC endpoint
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: must use JSON-RPC 2.0' },
    });
  }

  try {
    let result;

    switch (method) {
      case 'tools/list':
        result = { tools: [] };
        break;

      case 'initialize':
        result = {
          protocolVersion: '1.0',
          serverInfo: {
            name: 'temporal-agent-mcp',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
        };
        break;

      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }

    res.json({ jsonrpc: '2.0', id, result });
  } catch (error) {
    // HIGH-4 FIX: Generic error message
    console.error('[MCP] Error:', error);
    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: 'Internal error occurred' },
    });
  }
});

// HIGH-4 FIX: Error handling middleware with sanitized messages
app.use((err, req, res, next) => {
  // Log full error internally
  if (process.env.NODE_ENV !== 'test') {
    console.error('[Error]', {
      message: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
      ip: getClientIp(req),
    });
  }

  // Return sanitized error to client
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(500).json({
    error: 'Internal server error',
    message: isDevelopment ? err.message : 'An error occurred processing your request',
    requestId: req.headers['x-request-id'],
  });
});

export default app;
export { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS };
