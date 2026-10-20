import { roomService } from '@/lib/storage';
import { body,json,errorResponse } from '@/lib/http';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request:Request){try{const input=await body(request);return json(await (await roomService()).command(input));}catch(error){return errorResponse(error);}}
