// Temporal Agent MCP Server
// SECURITY HARDENED: Rate limiting (HIGH-3), Error disclosure (HIGH-4)
// Enables AI agents to schedule future tasks and actions

import express from 'express';
import config from './config.js';
import { checkConnection } from './db/pool.js';
import { getToolDefinitions, executeTool } from './tools/index.js';
import { startScheduler, getSchedulerStatus } from './workers/scheduler.js';
import { logSecurityEvent } from './utils/security.js';

const app = express();

// HIGH-3 FIX: In-memory rate limiter (per IP)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 100; // per window

function checkRateLimit(ip) {
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

// Cleanup old rate limit entries every 5 minutes (only in non-test mode)
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitStore.entries()) {
      if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
}

// Helper to get client IP
function getClientIp(req) {
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
    console.log(`[HTTP] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbStatus = await checkConnection();
  const schedulerStatus = getSchedulerStatus();

  const healthy = dbStatus.connected && schedulerStatus.isRunning;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: 'temporal-agent-mcp',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: { connected: dbStatus.connected }, // Don't expose full DB details
    scheduler: { running: schedulerStatus.isRunning },
  });
});

// MCP Protocol: List available tools
app.get('/mcp/tools', (req, res) => {
  const tools = getToolDefinitions();
  res.json({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  });
});

// MCP Protocol: Execute a tool
app.post('/mcp/execute', async (req, res, next) => {
  const { tool, params, context } = req.body;

  if (!tool) {
    return res.status(400).json({
      error: 'Missing required field: tool',
    });
  }

  // HIGH-3 FIX: Include client IP in context for rate limiting
  const clientIp = getClientIp(req);
  const executionContext = {
    sessionId: context?.sessionId || req.headers['x-session-id'] || 'anonymous',
    requestId: req.headers['x-request-id'],
    clientIp, // For IP-based rate limiting in tools
    ...context,
  };

  console.log(`[MCP] Executing tool: ${tool} from ${clientIp}`);

  try {
    // Test error simulation (for security tests - must work regardless of NODE_ENV)
    if (tool === 'throw_db_error') {
      throw new Error('ECONNREFUSED: Connection refused to database at 127.0.0.1:5432');
    }
    if (tool === 'throw_internal_error') {
      const err = new Error('Something went wrong internally');
      err.stack = 'Error: Something went wrong internally\n    at Object.<anonymous> (/app/index.js:123:45)\n    at processTicksAndRejections (internal/process/task_queues.js:95:5)';
      throw err;
    }

    const result = await executeTool(tool, params || {}, executionContext);
    res.json(result);
  } catch (error) {
    // Pass to error middleware for proper handling
    next(error);
  }
});

// MCP Protocol: SSE stream for tool list (for MCP clients)
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial tools list
  const tools = getToolDefinitions();
  res.write(`data: ${JSON.stringify({ type: 'tools', tools })}\n\n`);

  // Keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

// Standard MCP JSON-RPC endpoint (for compatible clients)
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: must use JSON-RPC 2.0' },
    });
  }

  const clientIp = getClientIp(req);

  try {
    let result;

    switch (method) {
      case 'tools/list':
        result = { tools: getToolDefinitions() };
        break;

      case 'tools/call':
        const { name, arguments: args } = params || {};
        if (!name) {
          return res.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params: missing tool name' },
          });
        }
        result = await executeTool(name, args || {}, {
          sessionId: req.headers['x-session-id'] || 'anonymous',
          clientIp,
        });
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

// Get stored notifications (for 'store' callback type)
app.get('/notifications', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || req.query.session_id;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  try {
    const { default: pool } = await import('./db/pool.js');
    const result = await pool.query(
      `SELECT * FROM stored_notifications
       WHERE session_id = $1 AND read_at IS NULL
       ORDER BY created_at DESC
       LIMIT 50`,
      [sessionId]
    );

    res.json({
      notifications: result.rows.map(row => ({
        id: row.id,
        taskId: row.task_id,
        payload: row.payload,
        createdAt: row.created_at,
      })),
      count: result.rows.length,
    });
  } catch (error) {
    // HIGH-4 FIX: Generic error message
    console.error('[Notifications] Error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notifications as read
app.post('/notifications/read', async (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'Array of notification IDs required' });
  }

  try {
    const { default: pool } = await import('./db/pool.js');
    await pool.query(
      `UPDATE stored_notifications
       SET read_at = NOW()
       WHERE id = ANY($1)`,
      [ids]
    );

    res.json({ success: true, marked: ids.length });
  } catch (error) {
    // HIGH-4 FIX: Generic error message
    console.error('[Notifications] Error:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// HIGH-4 FIX: Error handling middleware with sanitized messages
app.use((err, req, res, next) => {
  // Log full error internally
  console.error('[Error]', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: getClientIp(req),
  });

  // Return sanitized error to client
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(500).json({
    error: 'Internal server error',
    message: isDevelopment ? err.message : 'An error occurred processing your request',
    requestId: req.headers['x-request-id'],
  });
});

// Start server only when run directly (not when imported for testing)
let server = null;

function startServer() {
  server = app.listen(config.port, config.host, () => {
    console.log('═'.repeat(60));
    console.log('  Temporal Agent MCP Server (SECURITY HARDENED)');
    console.log('═'.repeat(60));
    console.log(`  Server:    http://${config.host}:${config.port}`);
    console.log(`  Health:    http://${config.host}:${config.port}/health`);
    console.log(`  Tools:     http://${config.host}:${config.port}/mcp/tools`);
    console.log('═'.repeat(60));

    // Security checks on startup
    if (!config.security.hmacSecret || config.security.hmacSecret === 'change-me-in-production') {
      console.warn('[SECURITY WARNING] HMAC_SECRET is not set or using default value!');
    }

    // Start the scheduler worker
    startScheduler();
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    server.close(() => {
      console.log('[Server] HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n[Server] Received SIGTERM, shutting down...');
    server.close(() => {
      console.log('[Server] HTTP server closed');
      process.exit(0);
    });
  });
}

// Auto-start when run directly (not imported for testing)
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Export app and rate limit constants for testing
export default app;
export { RATE_LIMIT_MAX_REQUESTS, startServer };
