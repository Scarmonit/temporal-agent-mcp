// Security utilities for Temporal Agent MCP
// SECURITY HARDENED: Addresses CRITICAL-1, CRITICAL-2, CRITICAL-3, HIGH-2
import { URL } from 'url';
import dns from 'dns/promises';
import crypto from 'crypto';
import { isIPv4, isIPv6 } from 'net';
import config from '../config.js';

// Private/internal IP ranges to block (SSRF prevention)
// CRITICAL-2 FIX: Comprehensive IPv4 and IPv6 blocking
const BLOCKED_IPV4_PATTERNS = [
  /^127\./,                           // Loopback
  /^10\./,                            // Private Class A
  /^172\.(1[6-9]|2\d|3[01])\./,      // Private Class B
  /^192\.168\./,                      // Private Class C
  /^169\.254\./,                      // Link-local (AWS/GCP/Azure metadata)
  /^0\./,                             // Current network
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // Carrier-grade NAT
  /^192\.0\.0\./,                     // IETF Protocol Assignments
  /^192\.0\.2\./,                     // TEST-NET-1
  /^198\.51\.100\./,                  // TEST-NET-2
  /^203\.0\.113\./,                   // TEST-NET-3
  /^224\./,                           // Multicast
  /^240\./,                           // Reserved
  /^255\.255\.255\.255$/,             // Broadcast
];

const BLOCKED_IPV6_PATTERNS = [
  /^::1$/i,                           // Loopback
  /^::$/,                             // Unspecified
  /^::ffff:127\./i,                   // IPv4-mapped loopback
  /^::ffff:10\./i,                    // IPv4-mapped private A
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i, // IPv4-mapped private B
  /^::ffff:192\.168\./i,              // IPv4-mapped private C
  /^::ffff:169\.254\./i,              // IPv4-mapped link-local (METADATA!)
  /^::ffff:0\./i,                     // IPv4-mapped current network
  /^fe80:/i,                          // Link-local
  /^fc00:/i,                          // Unique local (deprecated)
  /^fd[0-9a-f]{2}:/i,                 // Unique local addresses (ULA)
  /^ff[0-9a-f]{2}:/i,                 // Multicast
  /^2001:db8:/i,                      // Documentation
  /^100::/i,                          // Discard prefix
  /^64:ff9b:/i,                       // IPv4/IPv6 translation
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  '*.local',
  '*.localhost',
  'metadata.google.internal',         // GCP metadata
  'metadata.internal',                // Generic cloud metadata
  '169.254.169.254',                  // AWS/Azure/GCP metadata
  'instance-data',                    // EC2 metadata alias
  'kubernetes.default.svc',           // Kubernetes API
  '*.kubernetes.default.svc',
];

/**
 * Check if an IP address is blocked
 * @param {string} ip - IP address to check
 * @returns {boolean}
 */
export function isBlockedIP(ip) {
  if (!ip) return true;

  // Check IPv4 patterns
  for (const pattern of BLOCKED_IPV4_PATTERNS) {
    if (pattern.test(ip)) return true;
  }

  // Check IPv6 patterns
  for (const pattern of BLOCKED_IPV6_PATTERNS) {
    if (pattern.test(ip)) return true;
  }

  // Check for IPv4-mapped IPv6 that might slip through
  const ipv4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4MappedMatch) {
    const ipv4Part = ipv4MappedMatch[1];
    for (const pattern of BLOCKED_IPV4_PATTERNS) {
      if (pattern.test(ipv4Part)) return true;
    }
  }

  return false;
}

/**
 * Validate a webhook URL for safety
 * @param {string} urlString - URL to validate
 * @returns {Promise<{valid: boolean, error?: string, resolvedIps?: string[]}>}
 */
export async function validateWebhookUrl(urlString) {
  try {
    const url = new URL(urlString);

    // Must be HTTPS in production
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { valid: false, error: 'URL must use http or https protocol' };
    }

    // Enforce HTTPS in production
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      return { valid: false, error: 'HTTPS required in production' };
    }

    // Check against blocked hostnames
    const hostname = url.hostname.toLowerCase();
    for (const blocked of BLOCKED_HOSTNAMES) {
      if (blocked.startsWith('*.')) {
        const suffix = blocked.slice(1);
        if (hostname.endsWith(suffix) || hostname === suffix.slice(1)) {
          return { valid: false, error: `Hostname ${hostname} is blocked` };
        }
      } else if (hostname === blocked) {
        return { valid: false, error: `Hostname ${hostname} is blocked` };
      }
    }

    // Block IPv6 bracket notation for direct IPs
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      const ipv6 = hostname.slice(1, -1);
      if (isBlockedIP(ipv6)) {
        return { valid: false, error: `IPv6 address ${ipv6} is blocked` };
      }
    }

    // Check allowlist if configured
    if (config.security.allowedWebhookDomains.length > 0) {
      const allowed = config.security.allowedWebhookDomains.some(
        domain => hostname === domain || hostname.endsWith(`.${domain}`)
      );
      if (!allowed) {
        return { valid: false, error: `Domain ${hostname} not in allowlist` };
      }
    }

    // CRITICAL-2 FIX: Resolve BOTH IPv4 AND IPv6
    const resolvedIps = [];

    try {
      const ipv4Addresses = await dns.resolve4(hostname).catch(() => []);
      resolvedIps.push(...ipv4Addresses);
    } catch (e) { /* IPv4 resolution failed, continue */ }

    try {
      const ipv6Addresses = await dns.resolve6(hostname).catch(() => []);
      resolvedIps.push(...ipv6Addresses);
    } catch (e) { /* IPv6 resolution failed, continue */ }

    // If it's a direct IP address
    if (resolvedIps.length === 0) {
      if (isIPv4(hostname) || isIPv6(hostname)) {
        resolvedIps.push(hostname);
      } else {
        return { valid: false, error: `DNS resolution failed for ${hostname}` };
      }
    }

    // Check ALL resolved IPs against blocklist
    for (const ip of resolvedIps) {
      if (isBlockedIP(ip)) {
        return { valid: false, error: `IP ${ip} is in a blocked range (SSRF protection)` };
      }
    }

    return { valid: true, resolvedIps };
  } catch (error) {
    return { valid: false, error: `Invalid URL: ${error.message}` };
  }
}

/**
 * CRITICAL-1 FIX: Secure fetch that re-validates DNS at fetch time
 * This prevents DNS rebinding attacks (TOCTOU)
 * @param {string} url - URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function secureFetch(url, options = {}) {
  // Re-validate URL immediately before fetch (prevents DNS rebinding)
  const validation = await validateWebhookUrl(url);
  if (!validation.valid) {
    throw new Error(`URL validation failed: ${validation.error}`);
  }

  // Use resolved IP to prevent DNS rebinding between validation and fetch
  const parsedUrl = new URL(url);
  const resolvedIp = validation.resolvedIps[0];

  // For IP addresses, use directly; for hostnames, construct IP-based URL
  let fetchUrl = url;
  if (resolvedIp && !isIPv4(parsedUrl.hostname) && !isIPv6(parsedUrl.hostname)) {
    // Replace hostname with resolved IP
    const ipHost = isIPv6(resolvedIp) ? `[${resolvedIp}]` : resolvedIp;
    fetchUrl = url.replace(parsedUrl.hostname, ipHost);
  }

  // Fetch with Host header to maintain virtual hosting
  const fetchOptions = {
    ...options,
    headers: {
      ...options.headers,
      'Host': parsedUrl.hostname, // Preserve original hostname
    },
    redirect: 'manual', // Don't follow redirects (they could bypass SSRF checks)
  };

  const response = await fetch(fetchUrl, fetchOptions);

  // Block redirects that could bypass SSRF protection
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    throw new Error(`Redirects are blocked for security. Target: ${location}`);
  }

  return response;
}

/**
 * Validate cron expression for safety
 * HIGH-2 FIX: Character whitelist to prevent injection
 * @param {string} expression - Cron expression
 * @returns {{valid: boolean, error?: string}}
 */
export function validateCronExpression(expression) {
  if (!expression || typeof expression !== 'string') {
    return { valid: false, error: 'Cron expression is required' };
  }

  // HIGH-2 FIX: Whitelist allowed characters (prevents shell injection)
  const allowedCharsRegex = /^[0-9\s,\-*/LW#?]+$/;
  if (!allowedCharsRegex.test(expression)) {
    return {
      valid: false,
      error: 'Cron expression contains invalid characters. Only 0-9, space, comma, dash, asterisk, and slash are allowed.',
    };
  }

  const parts = expression.trim().split(/\s+/);

  // Only allow 5-part cron (minute hour day month weekday)
  if (parts.length !== 5) {
    return { valid: false, error: 'Cron expression must have exactly 5 parts (minute hour day month weekday)' };
  }

  // Validate each part isn't too long (DoS prevention)
  for (const part of parts) {
    if (part.length > 20) {
      return { valid: false, error: 'Cron expression part too long' };
    }
  }

  // Block expressions that would run too frequently
  const minute = parts[0];
  if (minute === '*' || minute === '*/1') {
    return { valid: false, error: 'Cron cannot run more frequently than once per minute' };
  }

  // Prevent running every minute via many values
  if (minute.includes(',') && minute.split(',').length > 30) {
    return { valid: false, error: 'Too many minute values specified' };
  }

  return { valid: true };
}

/**
 * Sanitize payload data
 * MEDIUM-1 FIX: Improved prototype pollution prevention
 * @param {any} payload - Payload to sanitize
 * @param {number} maxSize - Maximum size in bytes
 * @returns {{valid: boolean, sanitized?: any, error?: string}}
 */
export function sanitizePayload(payload, maxSize = config.limits.maxPayloadSizeBytes) {
  if (payload === undefined || payload === null) {
    return { valid: true, sanitized: {} };
  }

  try {
    const json = JSON.stringify(payload);

    if (json.length > maxSize) {
      return { valid: false, error: `Payload exceeds maximum size of ${maxSize} bytes` };
    }

    // MEDIUM-1 FIX: Use reviver to block dangerous keys during parsing
    const dangerous = new Set(['__proto__', 'constructor', 'prototype']);

    const sanitized = JSON.parse(json, (key, value) => {
      if (dangerous.has(key)) {
        return undefined; // Skip dangerous keys
      }
      return value;
    });

    return { valid: true, sanitized };
  } catch (error) {
    return { valid: false, error: `Invalid payload: ${error.message}` };
  }
}

/**
 * CRITICAL-3 FIX: Generate HMAC signature INCLUDING timestamp
 * This prevents replay attacks
 * @param {string|object} payload - Payload to sign
 * @param {string} timestamp - ISO timestamp to include in signature
 * @returns {string} - HMAC signature
 */
export function generateHmacSignature(payload, timestamp) {
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);

  // Include timestamp in signed content to prevent replay attacks
  const signedContent = timestamp ? `${timestamp}.${message}` : message;

  return crypto
    .createHmac('sha256', config.security.hmacSecret)
    .update(signedContent)
    .digest('hex');
}

/**
 * CRITICAL-3 FIX: Verify HMAC signature with timestamp validation
 * @param {string} payload - Payload
 * @param {string} signature - Signature to verify
 * @param {string} timestamp - Timestamp from request
 * @param {number} maxAgeMs - Maximum age of signature (default: 5 minutes)
 * @returns {{valid: boolean, error?: string}}
 */
export function verifyHmacSignature(payload, signature, timestamp, maxAgeMs = 5 * 60 * 1000) {
  // Validate timestamp is recent
  if (timestamp) {
    const timestampMs = new Date(timestamp).getTime();
    const now = Date.now();

    if (isNaN(timestampMs)) {
      return { valid: false, error: 'Invalid timestamp format' };
    }

    if (Math.abs(now - timestampMs) > maxAgeMs) {
      return { valid: false, error: 'Timestamp too old or too far in future' };
    }
  }

  const expected = generateHmacSignature(payload, timestamp);

  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
    return { valid: isValid };
  } catch (error) {
    // Length mismatch or invalid hex
    return { valid: false, error: 'Signature verification failed' };
  }
}

/**
 * Log security events for monitoring
 * @param {string} event - Event type
 * @param {object} details - Event details
 */
export function logSecurityEvent(event, details) {
  console.warn('[SECURITY]', JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...details,
  }));
}

export default {
  validateWebhookUrl,
  secureFetch,
  validateCronExpression,
  sanitizePayload,
  generateHmacSignature,
  verifyHmacSignature,
  logSecurityEvent,
  isBlockedIP,
};
