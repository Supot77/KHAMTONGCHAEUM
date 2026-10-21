import {validateWord} from './game.ts';
import {validateAnalysis,ANALYSIS_POLICY} from './word-analysis.ts';
import {ROOM_ACTIVITY_SQL,ROOM_IDLE_MS,RoomUnavailableError} from './room-lifecycle.ts';
import type {WordAnalysis} from './word-analysis.ts';
import type {SqlExecute,SqlTransaction,SqlRow} from './sql-store.ts';
export type DictionaryEntry={word:string;analysis:WordAnalysis;source:string;model:string;policy:string;updatedAt:number};
export type DictionaryPage={items:DictionaryEntry[];nextCursor:string|null};
export type DictionaryChange={originalWord:string;word:string;analysis:WordAnalysis;expectedUpdatedAt:number;roomCode:string;playerId:string};
export interface DictionaryStore{
  listDictionary(query:string,after:string):Promise<DictionaryPage>;
  updateDictionary(change:DictionaryChange):Promise<DictionaryEntry>;
}
export class DictionaryConflictError extends Error{constructor(){super('คำนี้ถูกแก้ไขไปแล้วหรือคำสะกดใหม่มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข');}}
const entry=(row:SqlRow):DictionaryEntry=>({word:String(row.word),analysis:validateAnalysis(String(row.word),JSON.parse(String(row.analysis))),source:String(row.source),model:String(row.model),policy:String(row.policy),updatedAt:Number(row.updated_at)});
export function createDictionaryStore(execute:SqlExecute,clock:()=>number,transaction:SqlTransaction|undefined,dialect:string):DictionaryStore{
 return {
  async listDictionary(query,after){
    if(query.length>200||after.length>200)throw new Error('คำค้นยาวเกินไป');
    const literal=query.normalize('NFC').trim().replace(/[!%_]/g,c=>'!'+c);
    const rows=await execute("SELECT word,analysis,source,model,policy,updated_at FROM word_dictionary WHERE word LIKE ? ESCAPE '!' AND word > ? ORDER BY word LIMIT 31",['%'+literal+'%',after]);
    const items=rows.slice(0,30).map(entry);return {items,nextCursor:rows.length>30?items.at(-1)!.word:null};
  },
  async updateDictionary(change){
    if(!transaction)throw new Error('ระบบบันทึกพจนานุกรมต้องใช้ transaction');
    const original=validateWord(change.originalWord),word=validateWord(change.word),analysis=validateAnalysis(word,change.analysis);
    if(!Number.isSafeInteger(change.expectedUpdatedAt)||change.expectedUpdatedAt<0)throw new Error('ไม่พบรุ่นข้อมูลคำ กรุณาโหลดใหม่');
    return transaction(async exec=>{
      const [room]=await exec(`SELECT data FROM rooms WHERE code = ? AND ${ROOM_ACTIVITY_SQL} > ?${dialect==='postgres'?' FOR SHARE':''}`,[change.roomCode,clock()-ROOM_IDLE_MS]);
      const author=room?JSON.parse(String(room.data)).players.find((p:{id:string})=>p.id===change.playerId):null;
      if(!author)throw new RoomUnavailableError('คุณไม่ได้อยู่ในห้องนี้แล้ว กรุณาเข้าห้องอีกครั้ง');
      const [old]=await exec('SELECT word,analysis,source,model,policy,updated_at FROM word_dictionary WHERE word = ?',[original]);
      if(!old||Number(old.updated_at)!==change.expectedUpdatedAt)throw new DictionaryConflictError();
      const previous=entry(old),at=Math.max(clock(),previous.updatedAt+1),renamed=word!==original;
      const replacement=renamed?validateAnalysis(original,{...previous.analysis,category:'other',nounType:'none',reason:`แก้รูปสะกดเป็น “${word}”`,suggestions:[word],titleContext:''}):analysis;
      const [updated]=await exec("UPDATE word_dictionary SET analysis=?,source='players',model='players-editor',policy=?,updated_at=? WHERE word=? AND updated_at=? RETURNING word,analysis,source,model,policy,updated_at",[JSON.stringify(replacement),ANALYSIS_POLICY,at,original,change.expectedUpdatedAt]);
      if(!updated)throw new DictionaryConflictError();
      let result=updated;
      if(renamed){
        const [created]=await exec("INSERT INTO word_dictionary(word,analysis,source,model,policy,updated_at) VALUES(?,?,'players','players-editor',?,?) ON CONFLICT(word) DO NOTHING RETURNING word,analysis,source,model,policy,updated_at",[word,JSON.stringify(analysis),ANALYSIS_POLICY,at]);
        if(!created)throw new DictionaryConflictError();result=created;
      }
      for(const [row,action] of [[old,'before'],[updated,renamed?'spelling-correction':'edit'],...(renamed?[[result,'corrected-spelling']]:[])] as [SqlRow,string][]){
        await exec('INSERT INTO word_analysis_history(id,word,analysis,source,model,policy,updated_at,metadata) VALUES(?,?,?,?,?,?,?,?)',[crypto.randomUUID(),row.word,row.analysis,row.source,row.model,row.policy,row.updated_at,JSON.stringify({action,roomCode:change.roomCode,playerId:change.playerId,playerName:author.name,originalWord:original,correctedWord:word})]);
      }
      return entry(result);
    });
  }
 };
}
