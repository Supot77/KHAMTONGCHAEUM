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
  for(let index=0;index<statements.length;index++){
    await client.query(statements[index]);
    if(index===0){
      await client.query('ALTER TABLE rooms ADD COLUMN IF NOT EXISTS last_active_at BIGINT NOT NULL DEFAULT 0');
      await client.query('UPDATE rooms SET last_active_at = updated_at WHERE last_active_at = 0');
    }
  }
  await client.query('COMMIT');console.log('Database schema is ready.');
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
