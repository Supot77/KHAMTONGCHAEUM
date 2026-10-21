import {roomStore} from '@/lib/storage';
import {body,json,errorResponse} from '@/lib/http';
import {dictionaryCommand} from '@/lib/dictionary-service';
import {DictionaryConflictError} from '@/lib/dictionary';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request:Request){
 try{return json(await dictionaryCommand(await roomStore(),await body(request)));}
 catch(error){if(error instanceof DictionaryConflictError)return json({error:error.message},409);return errorResponse(error);}
}
