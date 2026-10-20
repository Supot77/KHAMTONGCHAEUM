import { RoomUnavailableError } from './room-lifecycle';
import type { Command } from './rooms';
export const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function body(request:Request):Promise<Command>{
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin)throw new Error('คำขอต้องมาจากเว็บเกมนี้');
  if(!request.headers.get('Content-Type')?.includes('application/json'))throw new Error('รูปแบบคำขอไม่ถูกต้อง');
  const text=await request.text();if(text.length>16000)throw new Error('คำขอยาวเกินไป');
  const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('คำขอไม่ถูกต้อง');return parsed;
}
export function errorResponse(error:unknown){
  if(error instanceof RoomUnavailableError)return json({error:error.message,code:'ROOM_UNAVAILABLE'},410);
  const message=error instanceof Error?error.message:'เกิดข้อผิดพลาด กรุณาลองใหม่';
  const internal=/D1_|SQLITE|no such table|binding|stack|fetch failed/i.test(message);
  return json({error:internal?'ฐานข้อมูลยังไม่พร้อม กรุณาตรวจการตั้งค่าและ migration':message},400);
}
