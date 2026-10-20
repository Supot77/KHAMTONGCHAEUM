import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { handleRoomCleanup } from '../lib/cleanup-handler.ts';
import { DELETE_EXPIRED_ROOMS_SQL,ROOM_IDLE_MS } from '../lib/room-lifecycle.ts';
let pool:Pool|undefined;
export default {
  async fetch(request:Request){
    return handleRoomCleanup(request,async()=>{
      if(!pool){
        if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
        pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,idleTimeoutMillis:5000,connectionTimeoutMillis:10000});
        attachDatabasePool(pool);
      }
      const result=await pool.query(DELETE_EXPIRED_ROOMS_SQL.replace('?', '$1'),[Date.now()-ROOM_IDLE_MS]);
      return result.rowCount??0;
    });
  }
};
