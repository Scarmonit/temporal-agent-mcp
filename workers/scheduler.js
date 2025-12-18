// Scheduler Worker for Temporal Agent MCP
// Polls for due tasks and executes callbacks

import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import pool from '../db/pool.js';
import { TaskQueries, ExecutionQueries } from '../db/queries.js';
import { getNextCronRun } from '../utils/time.js';
import { sendWebhook } from '../notifiers/webhook.js';
import { sendSlackNotification } from '../notifiers/slack.js';
import { sendEmailNotification } from '../notifiers/email.js';

const WORKER_ID = `worker-${uuidv4().slice(0, 8)}`;
let isRunning = false;
let pollInterval = null;

/**
 * Execute a single task's callback
 */
async function executeTask(task) {
  const startTime = Date.now();
  console.log(`[Scheduler] Executing task: ${task.name} (${task.id})`);

  // Create execution record
  const execution = await ExecutionQueries.create({
    taskId: task.id,
    status: 'running',
    requestUrl: task.callback_config?.url,
    requestPayload: task.payload,
  });

  let result;

  try {
    // Execute based on callback type
    switch (task.callback_type) {
      case 'webhook':
        result = await sendWebhook(task, task.callback_config);
        break;

      case 'slack':
        result = await sendSlackNotification(task, task.callback_config);
        break;

      case 'email':
        result = await sendEmailNotification(task, task.callback_config);
        break;

      case 'store':
        // Store notification for later retrieval
        await pool.query(
          `INSERT INTO stored_notifications (task_id, payload, session_id)
           VALUES ($1, $2, $3)`,
          [task.id, JSON.stringify({
            task_id: task.id,
            task_name: task.name,
            executed_at: new Date().toISOString(),
            payload: task.payload,
          }), task.created_by]
        );
        result = { success: true };
        break;

      default:
        result = { success: false, error: `Unknown callback type: ${task.callback_type}` };
    }
  } catch (error) {
    result = { success: false, error: error.message };
  }

  const durationMs = Date.now() - startTime;

  // Update execution record
  await ExecutionQueries.complete(
    execution.id,
    result.success ? 'success' : 'failed',
    result.statusCode || null,
    result.body || null,
    durationMs,
    result.error || null
  );

  // Update task status
  if (task.task_type === 'one_time') {
    // One-time task: mark as completed
    await TaskQueries.recordExecution(task.id, null, true);
    console.log(`[Scheduler] One-time task completed: ${task.name}`);
  } else if (task.task_type === 'recurring') {
    // Recurring task: calculate next run time
    const nextRunAt = getNextCronRun(task.cron_expression, task.timezone);
    await TaskQueries.recordExecution(task.id, nextRunAt, false);
    console.log(`[Scheduler] Recurring task executed: ${task.name}, next run: ${nextRunAt?.toISOString()}`);
  }

  return result;
}

/**
 * Process due tasks
 */
async function processDueTasks() {
  if (!isRunning) return;

  try {
    // Get due tasks
    const dueTasks = await TaskQueries.getDueTasks(config.scheduler.batchSize);

    if (dueTasks.length === 0) {
      return;
    }

    console.log(`[Scheduler] Found ${dueTasks.length} due tasks`);

    // Process each task
    for (const task of dueTasks) {
      // Try to lock the task
      const locked = await TaskQueries.lockTask(task.id, WORKER_ID);

      if (!locked) {
        // Another worker got it
        console.log(`[Scheduler] Task ${task.id} locked by another worker, skipping`);
        continue;
      }

      try {
        await executeTask(task);
      } catch (error) {
        console.error(`[Scheduler] Error executing task ${task.id}:`, error);
        // Unlock the task so it can be retried
        await TaskQueries.unlockTask(task.id);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error processing due tasks:', error);
  }
}

/**
 * Clean up stale locks (from crashed workers)
 * SECURITY FIX: Uses parameterized query to prevent SQL injection
 */
async function cleanupStaleLocks() {
  try {
    // Convert lockTimeoutMs to seconds for the interval calculation
    const lockTimeoutSeconds = config.scheduler.lockTimeoutMs / 1000;

    const result = await pool.query(
      `UPDATE tasks
       SET locked_at = NULL, locked_by = NULL
       WHERE locked_at < NOW() - (INTERVAL '1 second' * $1)
       RETURNING id, name`,
      [lockTimeoutSeconds]
    );

    if (result.rows.length > 0) {
      console.log(`[Scheduler] Cleaned up ${result.rows.length} stale locks`);
    }
  } catch (error) {
    console.error('[Scheduler] Error cleaning up stale locks:', error);
  }
}

/**
 * Start the scheduler worker
 */
export function startScheduler() {
  if (isRunning) {
    console.log('[Scheduler] Already running');
    return;
  }

  console.log(`[Scheduler] Starting worker ${WORKER_ID}`);
  console.log(`[Scheduler] Poll interval: ${config.scheduler.pollIntervalMs}ms`);

  isRunning = true;

  // Initial run
  processDueTasks();

  // Set up polling interval
  pollInterval = setInterval(() => {
    processDueTasks();
  }, config.scheduler.pollIntervalMs);

  // Clean up stale locks periodically (every 5 minutes)
  setInterval(() => {
    cleanupStaleLocks();
  }, 5 * 60 * 1000);

  console.log('[Scheduler] Worker started');
}

/**
 * Stop the scheduler worker
 */
export function stopScheduler() {
  if (!isRunning) {
    console.log('[Scheduler] Not running');
    return;
  }

  console.log('[Scheduler] Stopping worker');
  isRunning = false;

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  console.log('[Scheduler] Worker stopped');
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    workerId: WORKER_ID,
    isRunning,
    pollIntervalMs: config.scheduler.pollIntervalMs,
    batchSize: config.scheduler.batchSize,
  };
}

// Run as standalone script if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[Scheduler] Running as standalone worker');
  startScheduler();

  // Handle shutdown gracefully
  process.on('SIGINT', () => {
    console.log('[Scheduler] Received SIGINT, shutting down...');
    stopScheduler();
    pool.end().then(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    console.log('[Scheduler] Received SIGTERM, shutting down...');
    stopScheduler();
    pool.end().then(() => process.exit(0));
  });
}

export default {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
};
