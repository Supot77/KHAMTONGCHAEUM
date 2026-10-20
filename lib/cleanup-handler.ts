import { parseTriggerDelivery } from '@neon/functions/triggers';

// Neon strips caller-supplied x-neon-* headers at its native gateway.
// Authenticate before opening a database connection, and never trust scheduled_at as the expiry clock.
export async function handleRoomCleanup(request:Request,cleanup:()=>Promise<number>):Promise<Response>{
  if(new URL(request.url).pathname!=='/')return new Response('Not found',{status:404});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  const parsed=await parseTriggerDelivery(request);
  if(!parsed.ok)return new Response(parsed.error,{status:parsed.error==='invalid_body'?400:401});
  const invocation=parsed.invocation;
  if(invocation.type!=='schedule'||invocation.trigger.name!=='expired-rooms')return new Response('Unexpected trigger',{status:403});
  const deleted=await cleanup();
  console.log(JSON.stringify({job:'expired-rooms',scheduledAt:invocation.data.scheduledAt,deleted}));
  return Response.json({ok:true,deleted});
}
