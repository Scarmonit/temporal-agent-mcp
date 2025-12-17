// Webhook notifier - sends HTTP POST callbacks
// SECURITY HARDENED: Uses secureFetch (CRITICAL-1) and timestamped HMAC (CRITICAL-3)

import config from '../config.js';
import { secureFetch, generateHmacSignature, logSecurityEvent } from '../utils/security.js';

/**
 * Send a webhook callback
 * @param {object} task - The task being executed
 * @param {object} callbackConfig - Callback configuration (url, etc.)
 * @returns {Promise<{success: boolean, statusCode?: number, body?: string, error?: string}>}
 */
export async function sendWebhook(task, callbackConfig) {
  const { url } = callbackConfig;

  if (!url) {
    return { success: false, error: 'No webhook URL configured' };
  }

  // Build the callback payload
  const payload = {
    task_id: task.id,
    task_name: task.name,
    task_type: task.task_type,
    scheduled_at: task.scheduled_at || task.next_run_at,
    executed_at: new Date().toISOString(),
    execution_count: (task.execution_count || 0) + 1,
    payload: task.payload || {},
    source: 'temporal-agent-mcp',
    version: '1.0',
  };

  const payloadString = JSON.stringify(payload);

  // CRITICAL-3 FIX: Include timestamp in HMAC signature
  const timestamp = new Date().toISOString();
  const signature = generateHmacSignature(payloadString, timestamp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.webhook.timeoutMs);

  try {
    // CRITICAL-1 FIX: Use secureFetch to prevent DNS rebinding
    const response = await secureFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': config.webhook.userAgent,
        'X-Temporal-Agent-Signature': signature,
        'X-Temporal-Agent-Task-Id': task.id,
        'X-Temporal-Agent-Timestamp': timestamp,
      },
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => '');

    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
        body: responseBody.slice(0, 1000), // Limit stored response size
      };
    } else {
      return {
        success: false,
        statusCode: response.status,
        body: responseBody.slice(0, 1000),
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
  } catch (error) {
    clearTimeout(timeout);

    // Log security events
    if (error.message.includes('SSRF') || error.message.includes('blocked')) {
      logSecurityEvent('WEBHOOK_BLOCKED', {
        url,
        taskId: task.id,
        reason: error.message,
      });
    }

    if (error.name === 'AbortError') {
      return {
        success: false,
        error: `Webhook timed out after ${config.webhook.timeoutMs}ms`,
      };
    }

    return {
      success: false,
      error: `Webhook failed: ${error.message}`,
    };
  }
}

export default { sendWebhook };
