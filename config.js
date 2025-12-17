// Configuration for Temporal Agent MCP
// All settings can be overridden via environment variables

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3324', 10),
  host: process.env.HOST || '0.0.0.0',

  // Database
  database: {
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/temporal_agent',
    poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),
  },

  // Scheduler Worker
  scheduler: {
    pollIntervalMs: parseInt(process.env.SCHEDULER_POLL_INTERVAL || '10000', 10), // 10 seconds
    batchSize: parseInt(process.env.SCHEDULER_BATCH_SIZE || '50', 10),
    lockTimeoutMs: parseInt(process.env.SCHEDULER_LOCK_TIMEOUT || '60000', 10), // 1 minute
  },

  // Task Limits
  limits: {
    maxActiveTasksPerUser: parseInt(process.env.MAX_ACTIVE_TASKS || '100', 10),
    maxPayloadSizeBytes: parseInt(process.env.MAX_PAYLOAD_SIZE || '65536', 10), // 64KB
    maxExecutionsPerDay: parseInt(process.env.MAX_EXECUTIONS_PER_DAY || '1000', 10),
    minCronIntervalSeconds: parseInt(process.env.MIN_CRON_INTERVAL || '60', 10), // 1 minute
  },

  // Webhook Settings
  webhook: {
    timeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT || '30000', 10), // 30 seconds
    maxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES || '3', 10),
    retryDelayMs: parseInt(process.env.WEBHOOK_RETRY_DELAY || '60000', 10), // 1 minute
    userAgent: 'TemporalAgentMCP/1.0',
  },

  // Slack Integration
  slack: {
    defaultWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  },

  // Email Integration
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'temporal-agent@localhost',
  },

  // Security
  security: {
    apiKey: process.env.API_KEY, // Optional API key for authentication
    hmacSecret: process.env.HMAC_SECRET || 'change-me-in-production',
    allowedWebhookDomains: process.env.ALLOWED_WEBHOOK_DOMAINS?.split(',') || [], // Empty = allow all (with SSRF protection)
  },
};

export default config;
