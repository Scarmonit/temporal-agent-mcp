# Integration Guide

## Integrating with Jules Orchestration

Temporal Agent MCP can schedule recurring tasks that trigger Jules sessions for autonomous development workflows.

### Use Cases

| Schedule | Jules Task | Description |
|----------|-----------|-------------|
| `0 0 * * 1` | Dependency updates | Weekly Monday security patches |
| `*/15 * * * *` | PR monitoring | Check open PRs every 15 minutes |
| `0 6 * * *` | Code quality | Daily morning code analysis |
| `0 */4 * * *` | Health checks | Check service health every 4 hours |

### Configuration

Add temporal-agent-mcp to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "temporal-agent": {
      "command": "node",
      "args": ["/path/to/temporal-agent-mcp/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/temporal_agent",
        "PORT": "3324",
        "HMAC_SECRET": "your-secret-key"
      }
    }
  }
}
```

### Example: Schedule Weekly Dependency Updates

```javascript
// Create a recurring task that triggers Jules
await fetch('http://localhost:3324/mcp/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tool: 'schedule_recurring',
    params: {
      name: 'weekly-dependency-update',
      cron_expression: '0 9 * * 1',  // Monday 9 AM
      timezone: 'America/New_York',
      payload: {
        action: 'create_jules_session',
        repository: 'owner/repo',
        task: 'Update all dependencies to latest secure versions',
        autoApprove: false
      },
      callback_type: 'webhook',
      callback_config: {
        url: 'http://localhost:3323/api/jules/create',
        method: 'POST',
        headers: { 'X-Jules-API-Key': '${JULES_API_KEY}' }
      }
    }
  })
});
```

### Example: PR Monitoring

```javascript
// Check PR status every 15 minutes
await fetch('http://localhost:3324/mcp/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tool: 'schedule_recurring',
    params: {
      name: 'pr-monitor',
      cron_expression: '*/15 * * * *',
      payload: { repos: ['owner/repo1', 'owner/repo2'] },
      callback_type: 'webhook',
      callback_config: {
        url: 'http://localhost:3323/api/pr/check',
        method: 'POST'
      }
    }
  })
});
```

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Desktop                        │
│  ┌─────────────────┐       ┌─────────────────────────┐  │
│  │ temporal-agent  │──────▶│ antigravity-jules-      │  │
│  │     MCP         │       │ orchestration           │  │
│  │   (port 3324)   │       │   (port 3323)           │  │
│  └────────┬────────┘       └───────────┬─────────────┘  │
│           │                            │                 │
│           │ schedules                  │ executes        │
│           │ triggers                   │ monitors        │
│           │                            │                 │
│  ┌────────▼────────┐       ┌───────────▼─────────────┐  │
│  │   PostgreSQL    │       │     Jules API           │  │
│  │   (tasks db)    │       │  (Google Antigravity)   │  │
│  └─────────────────┘       └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Available Temporal Tools

| Tool | Description |
|------|-------------|
| `schedule_one_time` | Schedule a task to run once at a specific time |
| `schedule_recurring` | Schedule a recurring task using cron expression |
| `list_tasks` | List all scheduled tasks |
| `get_task` | Get details of a specific task |
| `cancel_task` | Cancel a scheduled task |
| `pause_task` | Pause a recurring task |
| `resume_task` | Resume a paused task |

### Security Notes

- Webhook URLs are validated against SSRF attacks
- HMAC signatures protect callback integrity
- Rate limiting prevents abuse (100 req/15 min)
- All payloads are sanitized against prototype pollution
