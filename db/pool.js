// Database connection pool using pg
import pg from 'pg';
import config from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.database.connectionString,
  max: config.database.poolSize,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log connection events
pool.on('connect', () => {
  console.log('[DB] New client connected to pool');
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err);
});

// Helper for transactions
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Health check
export async function checkConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    return { connected: true, timestamp: result.rows[0].now };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

export default pool;
