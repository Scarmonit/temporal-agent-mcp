# Temporal Agent MCP

An MCP (Model Context Protocol) server that enables AI agents to **schedule future tasks** - transforming AI from reactive to proactive.

## The Problem

Current AI agents are ephemeral - they can't:
- Schedule actions for the future ("remind me tomorrow")
- Create recurring tasks ("check this every hour")
- Survive session termination
- Act proactively without human re-initiation

## The Solution

Temporal Agent MCP provides persistent task scheduling:

```
You: "Monitor this PR and let me know when CI passes"
AI: *schedules recurring check, notifies you when done*

You: "Remind me to follow up on this in 3 days"
AI: *creates scheduled task, sends notification in 3 days*
```

## Features

- **One-time scheduling**: Schedule tasks for specific times or relative delays
- **Recurring tasks**: Cron-based scheduling (hourly, daily, weekly, etc.)
- **Multiple callback types**: Webhooks, Slack, Email, or stored notifications
- **Timezone-aware**: Full IANA timezone support
- **Secure by default**: SSRF protection, payload sanitization, rate limiting
- **Execution history**: Full audit trail of task executions

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up PostgreSQL

```bash
# Create database
createdb temporal_agent

# Or use Docker
docker run -d --name temporal-pg \
  -e POSTGRES_DB=temporal_agent \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15
```

### 3. Configure environment

```bash
export DATABASE_URL="postgresql://localhost:5432/temporal_agent"
export SLACK_WEBHOOK_URL="https://hooks.slack.com/..."  # Optional
```

### 4. Run migrations

```bash
npm run migrate
```

### 5. Start the server

```bash
npm run dev
```

The server will be available at `http://localhost:3324`

## MCP Tools

### `schedule_task`

Schedule a one-time task for future execution.

```json
{
  "name": "Check PR status",
  "in": "2h",
  "callback": {
    "type": "webhook",
    "url": "https://example.com/webhook"
  },
  "payload": { "pr_number": 123 }
}
```

**Timing options:**
- `at`: ISO 8601 datetime (`2025-12-20T09:00:00Z`)
- `in`: Relative time (`30m`, `2h`, `3d`, `1w`)

### `schedule_recurring`

Create a recurring task with cron expressions.

```json
{
  "name": "Daily standup reminder",
  "cron": "0 9 * * 1-5",
  "timezone": "America/New_York",
  "callback": {
    "type": "slack",
    "channel": "#team"
  }
}
```

**Common cron patterns:**
- `0 9 * * *` - Every day at 9:00 AM
- `0 9 * * 1` - Every Monday at 9:00 AM
- `0 */2 * * *` - Every 2 hours
- `30 8 * * 1-5` - Weekdays at 8:30 AM

### `list_tasks`

Query scheduled tasks.

```json
{
  "status": "active",
  "type": "recurring",
  "tags": ["monitoring"]
}
```

### `get_task`

Get detailed task information with execution history.

```json
{
  "id": "uuid-here",
  "include_history": true
}
```

### `cancel_task`

Cancel a scheduled task.

```json
{
  "id": "uuid-here"
}
```

### `pause_task` / `resume_task`

Pause or resume recurring tasks.

```json
{
  "id": "uuid-here"
}
```

## Callback Types

### Webhook

Sends HTTP POST to your endpoint with HMAC signature:

```
X-Temporal-Agent-Signature: sha256=...
X-Temporal-Agent-Task-Id: uuid
X-Temporal-Agent-Timestamp: ISO8601
```

### Slack

Sends rich formatted message to Slack channel.

### Email

Sends HTML email notification.

### Store

Stores notification for polling via `/notifications` endpoint.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/mcp/tools` | GET | List available tools |
| `/mcp/execute` | POST | Execute a tool |
| `/mcp` | POST | JSON-RPC 2.0 endpoint |
| `/notifications` | GET | Get stored notifications |
| `/sse` | GET | Server-sent events stream |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3324 | Server port |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `SCHEDULER_POLL_INTERVAL` | 10000 | Poll interval in ms |
| `SLACK_WEBHOOK_URL` | - | Default Slack webhook |
| `SMTP_HOST` | - | SMTP server for email |
| `HMAC_SECRET` | - | Secret for webhook signatures |

## Security

This server has undergone comprehensive security hardening with **49/49 security tests passing**.

| Severity | Vulnerability | Status |
|----------|--------------|--------|
| CRITICAL | DNS Rebinding (SSRF) | FIXED |
| CRITICAL | IPv6 SSRF Bypass | FIXED |
| CRITICAL | HMAC Replay Attacks | FIXED |
| HIGH | Cron Expression Injection | FIXED |
| HIGH | No Rate Limiting | FIXED |
| HIGH | Verbose Error Disclosure | FIXED |
| MEDIUM | Prototype Pollution | FIXED |
| MEDIUM | Lenient JSON Parsing | FIXED |

**Key Security Features:**
- **SSRF Protection**: Blocks IPv4 + IPv6 private ranges, cloud metadata endpoints
- **DNS Rebinding Prevention**: Re-validates URLs at fetch time with IP pinning
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **HMAC with Timestamp**: Prevents replay attacks (5-minute window)
- **Strict Input Validation**: Cron whitelist, payload sanitization

See [SECURITY.md](./SECURITY.md) for detailed vulnerability analysis and fixes.

## Deployment

### Render

1. **Create a new Web Service** on Render
2. **Connect your repository**
3. **Configure settings**:
   - **Build Command**: `npm install && npm run migrate`
   - **Start Command**: `npm start`
   - **Environment**: Node

4. **Add environment variables**:
   ```
   DATABASE_URL=postgresql://user:pass@host:5432/db
   NODE_ENV=production
   HMAC_SECRET=<generate-secure-random-string>
   ```

5. **Add PostgreSQL database** (Render managed or external)

6. **Deploy** - The health check endpoint `/health` verifies deployment

### Railway

1. **Create a new project** from GitHub
2. **Add PostgreSQL plugin** (one-click setup)
3. **Configure environment**:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   NODE_ENV=production
   HMAC_SECRET=<generate-secure-random-string>
   ```

4. **Set start command**: `npm run migrate && npm start`

5. **Deploy** - Railway auto-detects Node.js

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3324
CMD ["npm", "start"]
```

```bash
docker build -t temporal-agent-mcp .
docker run -d -p 3324:3324 \
  -e DATABASE_URL="postgresql://..." \
  -e NODE_ENV=production \
  temporal-agent-mcp
```

### Running the Scheduler Worker

The scheduler worker runs as a separate process:

```bash
# In production, run both processes:
npm start           # MCP Server (port 3324)
npm run worker      # Scheduler Worker (polls tasks)
```

For PaaS deployments, use a **Background Worker** or **Worker Dyno** for the scheduler.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Temporal Agent MCP                        │
├─────────────────────────────────────────────────────────────┤
│  MCP Server (Express)          │  Scheduler Worker          │
│  ├─ POST /mcp/execute          │  ├─ Poll Loop (10s)        │
│  │   └─ Tool handlers          │  │   └─ Query due tasks    │
│  ├─ GET /health                │  ├─ Task Executor          │
│  └─ JSON-RPC endpoint          │  │   ├─ Webhook caller     │
│                                │  │   ├─ Slack notifier     │
│                                │  │   └─ Email sender       │
│                                │  └─ Cron Evaluator         │
├─────────────────────────────────────────────────────────────┤
│                      PostgreSQL                              │
│  ├─ tasks (scheduled & recurring)                           │
│  ├─ task_executions (history)                               │
│  └─ stored_notifications (polling)                          │
└─────────────────────────────────────────────────────────────┘
```

## License

MIT
