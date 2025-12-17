-- Temporal Agent MCP Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tasks table: stores all scheduled tasks (one-time and recurring)
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Task type
  task_type VARCHAR(20) NOT NULL CHECK (task_type IN ('one_time', 'recurring')),

  -- Scheduling (one-time)
  scheduled_at TIMESTAMPTZ,

  -- Scheduling (recurring)
  cron_expression VARCHAR(100),
  timezone VARCHAR(50) DEFAULT 'UTC',
  next_run_at TIMESTAMPTZ, -- Computed next execution time for efficient querying

  -- Callback configuration
  callback_type VARCHAR(20) NOT NULL CHECK (callback_type IN ('webhook', 'slack', 'email', 'store')),
  callback_config JSONB NOT NULL DEFAULT '{}',

  -- Task payload (data to send in callback)
  payload JSONB NOT NULL DEFAULT '{}',

  -- Status
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'failed', 'cancelled')),

  -- Retry configuration
  max_retries INT DEFAULT 3,
  retry_delay_seconds INT DEFAULT 60,
  current_retry_count INT DEFAULT 0,

  -- Execution tracking
  last_executed_at TIMESTAMPTZ,
  execution_count INT DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(255), -- Session or user identifier
  tags TEXT[] DEFAULT '{}',

  -- Lock for concurrent worker safety
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(255)
);

-- Task executions: history of all task runs
CREATE TABLE IF NOT EXISTS task_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

  -- Execution details
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(20) CHECK (status IN ('running', 'success', 'failed', 'timeout', 'skipped')),

  -- Response info
  response_code INT,
  response_body TEXT,
  error_message TEXT,

  -- Performance
  duration_ms INT,
  retry_number INT DEFAULT 0,

  -- Request details (for debugging)
  request_url TEXT,
  request_payload JSONB
);

-- Stored notifications: for 'store' callback type (polled by MCP client)
CREATE TABLE IF NOT EXISTS stored_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ,

  -- For efficient polling
  session_id VARCHAR(255)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_at ON tasks(scheduled_at)
  WHERE status = 'active' AND task_type = 'one_time';

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);

CREATE INDEX IF NOT EXISTS idx_tasks_tags ON tasks USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_executions_task_id ON task_executions(task_id);

CREATE INDEX IF NOT EXISTS idx_executions_executed_at ON task_executions(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stored_notifications_session ON stored_notifications(session_id)
  WHERE read_at IS NULL;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- View for due tasks (ready to execute)
CREATE OR REPLACE VIEW due_tasks AS
SELECT *
FROM tasks
WHERE status = 'active'
  AND locked_at IS NULL
  AND (
    (task_type = 'one_time' AND scheduled_at <= NOW())
    OR
    (task_type = 'recurring' AND next_run_at <= NOW())
  );

-- Comments
COMMENT ON TABLE tasks IS 'Scheduled tasks for Temporal Agent MCP';
COMMENT ON TABLE task_executions IS 'Execution history for tasks';
COMMENT ON TABLE stored_notifications IS 'Notifications stored for MCP client polling';
COMMENT ON VIEW due_tasks IS 'Tasks that are ready to be executed';
