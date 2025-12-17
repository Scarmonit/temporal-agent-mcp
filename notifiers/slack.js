// Slack notifier - sends messages to Slack channels

import config from '../config.js';

/**
 * Send a Slack notification
 * @param {object} task - The task being executed
 * @param {object} callbackConfig - Callback configuration (channel/webhook URL)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendSlackNotification(task, callbackConfig) {
  // Use provided webhook URL or default
  const webhookUrl = callbackConfig.channel || callbackConfig.url || config.slack.defaultWebhookUrl;

  if (!webhookUrl) {
    return { success: false, error: 'No Slack webhook URL configured' };
  }

  // Build Slack message
  const message = {
    text: `Scheduled task completed: ${task.name}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `⏰ ${task.name}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Task Type:*\n${task.task_type}`,
          },
          {
            type: 'mrkdwn',
            text: `*Status:*\nExecuted`,
          },
          {
            type: 'mrkdwn',
            text: `*Scheduled For:*\n${task.scheduled_at || task.next_run_at || 'N/A'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Execution #:*\n${(task.execution_count || 0) + 1}`,
          },
        ],
      },
    ],
  };

  // Add description if present
  if (task.description) {
    message.blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Description:*\n${task.description}`,
      },
    });
  }

  // Add payload if present
  if (task.payload && Object.keys(task.payload).length > 0) {
    message.blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Payload:*\n\`\`\`${JSON.stringify(task.payload, null, 2).slice(0, 500)}\`\`\``,
      },
    });
  }

  // Add footer
  message.blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Task ID: ${task.id} | Source: Temporal Agent MCP`,
      },
    ],
  });

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (response.ok) {
      return { success: true };
    } else {
      const error = await response.text();
      return { success: false, error: `Slack API error: ${error}` };
    }
  } catch (error) {
    return { success: false, error: `Slack notification failed: ${error.message}` };
  }
}

export default { sendSlackNotification };
