import mysql from 'mysql2/promise';
import { config } from './config.js';

// dateStrings keeps DATE columns as 'YYYY-MM-DD' strings so no timezone shifting happens.
export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: config.dbConnectionLimit,
  timezone: '+05:30',
  dateStrings: true,
  decimalNumbers: true,
  charset: 'utf8mb4',
  multipleStatements: false,
});

// Standard MySQL 8 behaviour on every connection. Some cloud hosts (e.g. Aiven) default to
// ANSI mode, where "double quotes" mean column names and || means concatenation.
export const SQL_MODE = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

pool.on('connection', (conn) => {
  conn.query(`SET SESSION sql_mode = '${SQL_MODE}'`);
  conn.query("SET time_zone = '+05:30'");
});

/** Run a parameterized query and return rows. */
export async function query(sql, params = [], conn = pool) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

export async function one(sql, params = [], conn = pool) {
  const rows = await query(sql, params, conn);
  return rows[0] || null;
}

/** Run fn(conn) inside a transaction; commits on success, rolls back on error. */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
