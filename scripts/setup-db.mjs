import nextEnv from '@next/env';
import pg from 'pg';
import { readFileSync } from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const connection=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL||process.env.POSTGRES_URL;
if(!connection)throw new Error('Set DATABASE_URL in .env.local, or run database/schema.sql in the Neon SQL Editor.');
const client=new pg.Client({connectionString:connection,connectionTimeoutMillis:10000});
const statements=readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8').split('-- statement-breakpoint').map(s=>s.trim()).filter(Boolean);
await client.connect();
try{
  await client.query('BEGIN');
  for(const statement of statements)await client.query(statement);
  await client.query('COMMIT');console.log('Database schema is ready.');
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
