import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

// A single shared pool. Parameterized queries only — never build SQL
// from string interpolation, especially since raw log content is
// untrusted input.
export const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  database: config.mysql.database,
  user: config.mysql.user,
  password: config.mysql.password,
  waitForConnections: true,
  connectionLimit: 10,
});
