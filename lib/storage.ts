import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { RoomService } from './rooms';
import { createProvider } from './gemini';
import { createSqlStore,postgresPlaceholders } from './sql-store';
import { observePoolErrors } from './pool-errors';
import type { RoomStore } from './rooms';
let localStore:RoomStore|undefined;
let databasePool:Pool|undefined;
export async function roomStore():Promise<RoomStore> {
  const connectionString=process.env.DATABASE_URL||process.env.POSTGRES_URL;
  if(connectionString){
    if(!databasePool){
      databasePool=new Pool({connectionString,max:5,idleTimeoutMillis:5000,connectionTimeoutMillis:10000});
      observePoolErrors(databasePool);
      if(process.env.VERCEL)attachDatabasePool(databasePool);
    }
    return createSqlStore(async(query,parameters)=>(await databasePool!.query(postgresPlaceholders(query),parameters)).rows as Record<string,unknown>[],Date.now,async work=>{
      const client=await databasePool!.connect();
      try{await client.query('BEGIN');const value=await work(async(q,p)=>(await client.query(postgresPlaceholders(q),p)).rows);await client.query('COMMIT');return value;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },'postgres');
  }
  if(process.env.VERCEL)throw new Error('ยังไม่ได้เชื่อม Neon: ตั้งค่า DATABASE_URL และรัน schema ตามคู่มือ');
  if(!localStore){
    // Local development alone uses a durable SQLite file. Never use Vercel's filesystem for rooms.
    const { createLocalStore }=await import('./storage-local');localStore=createLocalStore();
  }
  return localStore;
}
export function languageProvider(){return createProvider(process.env.GEMINI_API_KEY,process.env.GEMINI_MODEL);}
export async function roomService(){return new RoomService(await roomStore(),languageProvider());}
