// Email notifier - sends email notifications via SMTP

import nodemailer from 'nodemailer';
import config from '../config.js';

// Lazy-initialized transporter
let transporter = null;

function getTransporter() {
  if (!transporter && config.email.host) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: config.email.user ? {
        user: config.email.user,
        pass: config.email.pass,
      } : undefined,
    });
  }
  return transporter;
}

/**
 * Send an email notification
 * @param {object} task - The task being executed
 * @param {object} callbackConfig - Callback configuration (email address)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function sendEmailNotification(task, callbackConfig) {
  const transport = getTransporter();

  if (!transport) {
    return { success: false, error: 'Email not configured. Set SMTP_HOST environment variable.' };
  }

  const { email } = callbackConfig;
  if (!email) {
    return { success: false, error: 'No email address configured' };
  }

  // Build email content
  const subject = `[Temporal Agent] Task Executed: ${task.name}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">⏰ Scheduled Task Executed</h2>

      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #333;">${task.name}</h3>
        ${task.description ? `<p style="color: #666;">${task.description}</p>` : ''}

        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Task Type:</td>
            <td style="padding: 8px 0; font-weight: bold;">${task.task_type}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Scheduled For:</td>
            <td style="padding: 8px 0;">${task.scheduled_at || task.next_run_at || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Executed At:</td>
            <td style="padding: 8px 0;">${new Date().toISOString()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Execution #:</td>
            <td style="padding: 8px 0;">${(task.execution_count || 0) + 1}</td>
          </tr>
        </table>
      </div>

      ${task.payload && Object.keys(task.payload).length > 0 ? `
        <div style="background: #f0f0f0; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h4 style="margin-top: 0;">Payload:</h4>
          <pre style="background: #fff; padding: 10px; border-radius: 4px; overflow-x: auto;">${JSON.stringify(task.payload, null, 2)}</pre>
        </div>
      ` : ''}

      <p style="color: #999; font-size: 12px; margin-top: 30px;">
        Task ID: ${task.id}<br>
        Source: Temporal Agent MCP
      </p>
    </div>
  `;

  const text = `
Scheduled Task Executed: ${task.name}

${task.description || ''}

Task Type: ${task.task_type}
Scheduled For: ${task.scheduled_at || task.next_run_at || 'N/A'}
Executed At: ${new Date().toISOString()}
Execution #: ${(task.execution_count || 0) + 1}

${task.payload && Object.keys(task.payload).length > 0 ? `Payload:\n${JSON.stringify(task.payload, null, 2)}` : ''}

---
Task ID: ${task.id}
Source: Temporal Agent MCP
  `.trim();

  try {
    await transport.sendMail({
      from: config.email.from,
      to: email,
      subject,
      text,
      html,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: `Email send failed: ${error.message}` };
  }
}

export default { sendEmailNotification };
