# Changelog

All notable changes to the Temporal Agent MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-12-17

### Added
- **7 MCP Tools** for persistent task scheduling:
  - `schedule_task` - Schedule one-time tasks
  - `schedule_recurring` - Schedule recurring tasks with cron expressions
  - `list_tasks` - List all scheduled tasks
  - `get_task` - Get task details
  - `cancel_task` - Cancel a scheduled task
  - `pause_task` - Pause a recurring task
  - `resume_task` - Resume a paused task

- **Notification System** with multiple callback types:
  - Webhook callbacks with HMAC signatures
  - Slack notifications with rich formatting
  - Email notifications via SMTP
  - In-app notification storage

- **Security Hardening** (8 vulnerabilities fixed):
  - CRITICAL-1: SSRF protection with IPv4/IPv6 blocking
  - CRITICAL-2: DNS rebinding prevention
  - CRITICAL-3: HMAC signature verification with timestamps
  - HIGH-1: SQL injection prevention (parameterized queries)
  - HIGH-2: Cron expression validation (whitelist approach)
  - HIGH-3: Rate limiting (100 req/15 min per IP)
  - HIGH-4: Error message sanitization
  - MEDIUM-1: Payload sanitization (prototype pollution prevention)

- **PostgreSQL Persistence**:
  - Tasks table with full audit trail
  - Execution history tracking
  - Stored notifications for polling

- **Worker Process**:
  - Configurable polling interval
  - Batch processing (50 tasks per cycle)
  - Distributed locking for multi-worker support
  - Graceful shutdown handling

- **Documentation**:
  - README.md with quick start guide
  - SECURITY.md with full audit report
  - INTEGRATION.md for Jules orchestration

### Security
- All 8 identified vulnerabilities addressed
- 51 security tests passing
- Production-ready security configuration

## [0.1.0] - 2025-12-16

### Added
- Initial project structure
- Basic MCP server implementation
- Database schema design
