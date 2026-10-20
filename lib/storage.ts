import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { RoomService } from './rooms';
import { createProvider } from './gemini';
import { createSqlStore,postgresPlaceholders } from './sql-store';
import type { RoomStore } from './rooms';
let localStore:RoomStore|undefined;
let databasePool:Pool|undefined;
export async function roomStore():Promise<RoomStore> {
  const connectionString=process.env.DATABASE_URL||process.env.POSTGRES_URL;
  if(connectionString){
    if(!databasePool){
      databasePool=new Pool({connectionString,max:5,idleTimeoutMillis:5000,connectionTimeoutMillis:10000});
      if(process.env.VERCEL)attachDatabasePool(databasePool);
    }
    return createSqlStore(async(query,parameters)=>(await databasePool!.query(postgresPlaceholders(query),parameters)).rows as Record<string,unknown>[]);
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
