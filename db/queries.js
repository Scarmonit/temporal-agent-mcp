// SQL query builders for tasks
import pool from './pool.js';
import { v4 as uuidv4 } from 'uuid';

export const TaskQueries = {
  // Create a new task
  async create(task) {
    const id = uuidv4();
    const query = `
      INSERT INTO tasks (
        id, name, description, task_type,
        scheduled_at, cron_expression, timezone, next_run_at,
        callback_type, callback_config, payload,
        max_retries, retry_delay_seconds,
        created_by, tags
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11,
        $12, $13,
        $14, $15
      ) RETURNING *
    `;

    const values = [
      id,
      task.name,
      task.description || null,
      task.taskType,
      task.scheduledAt || null,
      task.cronExpression || null,
      task.timezone || 'UTC',
      task.nextRunAt || task.scheduledAt || null,
      task.callbackType,
      JSON.stringify(task.callbackConfig),
      JSON.stringify(task.payload || {}),
      task.maxRetries ?? 3,
      task.retryDelaySeconds ?? 60,
      task.createdBy || null,
      task.tags || [],
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Get task by ID
  async getById(id) {
    const query = 'SELECT * FROM tasks WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  // List tasks with filters
  async list(filters = {}) {
    const conditions = ['1=1'];
    const values = [];
    let paramIndex = 1;

    if (filters.status && filters.status !== 'all') {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filters.status);
    }

    if (filters.taskType) {
      conditions.push(`task_type = $${paramIndex++}`);
      values.push(filters.taskType);
    }

    if (filters.createdBy) {
      conditions.push(`created_by = $${paramIndex++}`);
      values.push(filters.createdBy);
    }

    if (filters.tags && filters.tags.length > 0) {
      conditions.push(`tags && $${paramIndex++}`);
      values.push(filters.tags);
    }

    // HIGH-1 FIX: Parameterize LIMIT and OFFSET to prevent SQL injection
    const limit = Math.min(parseInt(filters.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);

    // Add LIMIT and OFFSET as parameters
    values.push(limit);
    values.push(offset);

    const query = `
      SELECT * FROM tasks
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    const result = await pool.query(query, values);
    return result.rows;
  },

  // HIGH-3 FIX: Count active tasks by IP for rate limiting
  async countActiveByIp(clientIp) {
    const query = `
      SELECT COUNT(*) as count
      FROM tasks
      WHERE client_ip = $1 AND status IN ('active', 'paused')
    `;
    const result = await pool.query(query, [clientIp]);
    return parseInt(result.rows[0].count, 10);
  },

  // Update task status
  async updateStatus(id, status) {
    const query = `
      UPDATE tasks
      SET status = $2
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id, status]);
    return result.rows[0];
  },

  // Cancel task
  async cancel(id) {
    return this.updateStatus(id, 'cancelled');
  },

  // Pause task
  async pause(id) {
    return this.updateStatus(id, 'paused');
  },

  // Resume task
  async resume(id) {
    return this.updateStatus(id, 'active');
  },

  // Get due tasks (for scheduler worker)
  async getDueTasks(batchSize = 50) {
    const query = `
      SELECT * FROM due_tasks
      ORDER BY COALESCE(next_run_at, scheduled_at) ASC
      LIMIT $1
    `;
    const result = await pool.query(query, [batchSize]);
    return result.rows;
  },

  // Lock a task for execution (prevents double execution)
  async lockTask(id, workerId) {
    const query = `
      UPDATE tasks
      SET locked_at = NOW(), locked_by = $2
      WHERE id = $1
        AND locked_at IS NULL
        AND status = 'active'
      RETURNING *
    `;
    const result = await pool.query(query, [id, workerId]);
    return result.rows[0] || null;
  },

  // Unlock a task
  async unlockTask(id) {
    const query = `
      UPDATE tasks
      SET locked_at = NULL, locked_by = NULL
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // Update after execution
  async recordExecution(id, nextRunAt = null, completed = false) {
    const query = `
      UPDATE tasks
      SET
        last_executed_at = NOW(),
        execution_count = execution_count + 1,
        next_run_at = $2,
        status = CASE WHEN $3 THEN 'completed' ELSE status END,
        locked_at = NULL,
        locked_by = NULL
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id, nextRunAt, completed]);
    return result.rows[0];
  },

  // Delete task
  async delete(id) {
    const query = 'DELETE FROM tasks WHERE id = $1 RETURNING *';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  },

  // Count active tasks for rate limiting
  async countActiveByUser(createdBy) {
    const query = `
      SELECT COUNT(*) as count
      FROM tasks
      WHERE created_by = $1 AND status IN ('active', 'paused')
    `;
    const result = await pool.query(query, [createdBy]);
    return parseInt(result.rows[0].count, 10);
  },
};

export const ExecutionQueries = {
  // Record an execution
  async create(execution) {
    const query = `
      INSERT INTO task_executions (
        task_id, status, response_code, response_body,
        error_message, duration_ms, retry_number,
        request_url, request_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      execution.taskId,
      execution.status,
      execution.responseCode || null,
      execution.responseBody || null,
      execution.errorMessage || null,
      execution.durationMs || null,
      execution.retryNumber || 0,
      execution.requestUrl || null,
      JSON.stringify(execution.requestPayload || {}),
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Get executions for a task
  async getByTaskId(taskId, limit = 20) {
    const query = `
      SELECT * FROM task_executions
      WHERE task_id = $1
      ORDER BY executed_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [taskId, limit]);
    return result.rows;
  },

  // Update execution status
  async complete(id, status, responseCode, responseBody, durationMs, errorMessage = null) {
    const query = `
      UPDATE task_executions
      SET
        completed_at = NOW(),
        status = $2,
        response_code = $3,
        response_body = $4,
        duration_ms = $5,
        error_message = $6
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id, status, responseCode, responseBody, durationMs, errorMessage]);
    return result.rows[0];
  },
};

export default { TaskQueries, ExecutionQueries };
