import {validateWord} from './game.ts';
import {validateAnalysis,ANALYSIS_POLICY,CATEGORIES,NOUN_TYPES} from './word-analysis.ts';
import {ROOM_ACTIVITY_SQL,ROOM_IDLE_MS,RoomUnavailableError} from './room-lifecycle.ts';
import type {WordAnalysis} from './word-analysis.ts';
import type {SqlExecute,SqlTransaction,SqlRow} from './sql-store.ts';
export type DictionaryEntry={word:string;analysis:WordAnalysis;source:string;model:string;policy:string;updatedAt:number;validationError:string|null};
export type DictionaryPage={items:DictionaryEntry[];nextCursor:string|null;total:number};
export type DictionaryChange={originalWord:string;word:string;analysis:WordAnalysis;expectedUpdatedAt:number;roomCode:string;playerId:string};
export interface DictionaryStore{
  getDictionary(word:string):Promise<DictionaryEntry|null>;
  listDictionary(query:string,after:string):Promise<DictionaryPage>;
  updateDictionary(change:DictionaryChange):Promise<DictionaryEntry>;
}
export class DictionaryConflictError extends Error{constructor(){super('คำนี้ถูกแก้ไขไปแล้วหรือคำสะกดใหม่มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไข');}}
// A dictionary is also a repair tool: malformed historical facts must remain visible.
// This display-only projection never certifies a row or writes normalized data back.
function entry(row:SqlRow):DictionaryEntry{
 const word=String(row.word);let raw:Partial<WordAnalysis>={},analysis:WordAnalysis,validationError:string|null=null;
 try{raw=JSON.parse(String(row.analysis));analysis=validateAnalysis(word,raw);}
 catch(error){
  validationError=error instanceof SyntaxError?'ข้อมูลวิเคราะห์เดิมอ่านไม่ได้ กรุณาแก้ไขหรือให้ AI วิเคราะห์ใหม่':error instanceof Error?error.message:'ข้อมูลเดิมยังไม่ครบ กรุณาตรวจทาน';
  const a=raw&&typeof raw==='object'?raw:{};
  const category=CATEGORIES.includes(a.category!)?a.category!:'uncertain';
  analysis={syllables:Array.isArray(a.syllables)?a.syllables.filter((s):s is string=>typeof s==='string').slice(0,160).map(s=>s.slice(0,200)):[],category,
   nounType:category==='noun'&&NOUN_TYPES.includes(a.nounType!)&&a.nounType!=='none'?a.nounType!:(category==='noun'?'common':'none'),
   reason:typeof a.reason==='string'?a.reason.slice(0,500):'',suggestions:Array.isArray(a.suggestions)?a.suggestions.filter((s):s is string=>typeof s==='string').slice(0,3).map(s=>s.slice(0,200)):[],titleContext:typeof a.titleContext==='string'?a.titleContext.slice(0,300):''};
 }
 return {word,analysis,validationError,source:String(row.source),model:String(row.model),policy:String(row.policy),updatedAt:Number(row.updated_at)};
}
export function createDictionaryStore(execute:SqlExecute,clock:()=>number,transaction:SqlTransaction|undefined,dialect:string):DictionaryStore{
 return {
  async getDictionary(word){const [row]=await execute('SELECT word,analysis,source,model,policy,updated_at FROM word_dictionary WHERE word = ?',[word]);return row?entry(row):null;},
  async listDictionary(query,after){
    if(query.length>200||after.length>200)throw new Error('คำค้นยาวเกินไป');
    const literal=query.normalize('NFC').trim().replace(/[!%_]/g,c=>'!'+c);
    const rows=await execute("SELECT word,analysis,source,model,policy,updated_at FROM word_dictionary WHERE word LIKE ? ESCAPE '!' AND word > ? ORDER BY word LIMIT 31",['%'+literal+'%',after]);
    const [count]=await execute("SELECT COUNT(*) AS total FROM word_dictionary WHERE word LIKE ? ESCAPE '!'",['%'+literal+'%']);
    const items=rows.slice(0,30).map(entry);return {items,nextCursor:rows.length>30?items.at(-1)!.word:null,total:Number(count.total)};
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
      const replacement=renamed?validateAnalysis(original,{...previous.analysis,...(previous.validationError?{syllables:[original.replace(/[^\p{L}\p{M}\p{N}]/gu,'')]}:{}),category:'other',nounType:'none',reason:`แก้รูปสะกดเป็น “${word}”`,suggestions:[word],titleContext:''}):analysis;
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
