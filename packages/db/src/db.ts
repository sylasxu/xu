import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, {
  prepare: false,
  max: 20,
  connect_timeout: 10,
  // API 是常驻进程，避免随机寿命导致频繁重连噪音。
  max_lifetime: null,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;

export async function closeConnection() {
  await client.end();
}
