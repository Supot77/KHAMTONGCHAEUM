import { roomService } from '@/lib/storage';
import { body,json,errorResponse } from '@/lib/http';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){try{const input=await body(request);return json(await (await roomService()).check(String(input.code??''),String(input.token??'')));}catch(error){return errorResponse(error);}}
