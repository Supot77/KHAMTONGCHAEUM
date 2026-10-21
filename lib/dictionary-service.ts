import {tokenHash} from './rooms.ts';
import type {RoomStore} from './rooms.ts';
import {validateWord} from './game.ts';
import {validateAnalysis} from './word-analysis.ts';
import {RoomUnavailableError} from './room-lifecycle.ts';
import type {LanguageProvider} from './gemini.ts';
import type {WordAnalysis} from './word-analysis.ts';
export type DictionaryRequest={action?:unknown;code?:unknown;token?:unknown;query?:unknown;after?:unknown;originalWord?:unknown;word?:unknown;analysis?:unknown;expectedUpdatedAt?:unknown;request?:unknown};
export async function dictionaryCommand(store:RoomStore,input:DictionaryRequest,provider?:Pick<LanguageProvider,'configured'|'model'|'reviewAnalysis'>){
 const hash=await tokenHash(input.token),code=String(input.code??'').toUpperCase();
 if(!/^[A-Z2-9]{6}$/.test(code))throw new Error('เข้าห้องก่อนเปิดพจนานุกรม');
 const row=await store.read(code),player=row?.game.players.find(p=>p.tokenHash===hash);
 if(!row||!player)throw new RoomUnavailableError('คุณไม่ได้อยู่ในห้องนี้แล้ว กรุณาเข้าห้องอีกครั้ง');
 if(input.action==='list')return store.listDictionary(String(input.query??''),String(input.after??''));
 if(input.action==='analyze'){
  if(!provider?.configured)throw new Error('ยังไม่ได้ตั้งค่าโมเดลที่เซิร์ฟเวอร์');
  const word=validateWord(input.word),originalWord=validateWord(input.originalWord),old=await store.getDictionary(originalWord);
  if(!old||old.updatedAt!==input.expectedUpdatedAt)throw new Error('ข้อมูลคำเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนขอวิเคราะห์');
  const request=input.request??'';if(typeof request!=='string'||request.length>500)throw new Error('คำขอถึง AI ต้องไม่เกิน 500 ตัวอักษร');
  // Allow incorrect/unfinished segmentation as review DATA, while bounding every field.
  // Only the returned model analysis and the final save must satisfy exact spelling.
  const draft=input.analysis as WordAnalysis;
  if(!draft||!Array.isArray(draft.syllables)||draft.syllables.length>160||draft.syllables.some(s=>typeof s!=='string'||s.length>200))throw new Error('รูปแบบพยางค์ในคำขอไม่ถูกต้อง');
  const bounded=validateAnalysis(word,{...draft,syllables:[word.replace(/[^\p{L}\p{M}\p{N}]/gu,'')],reason:draft.reason||'ขอให้ตรวจการแบ่งพยางค์และประเภทคำใหม่',titleContext:['song','movie','series'].includes(draft.nounType)&&!draft.titleContext?'ยังไม่มีข้อมูลชื่อผลงาน กรุณาตรวจสอบและระบุข้อมูลที่รู้จริง':draft.titleContext});
  const result=await provider.reviewAnalysis({word,original:old.validationError||word!==originalWord?null:old.analysis,proposal:{...bounded,syllables:draft.syllables},request});
  const latest=await store.read(code);if(!latest?.game.players.some(p=>p.id===player.id&&p.tokenHash===hash))throw new RoomUnavailableError('คุณไม่ได้อยู่ในห้องนี้แล้ว กรุณาเข้าห้องอีกครั้ง');
  return {...result,analysis:validateAnalysis(word,result.analysis),word,model:provider.model};
 }
 if(input.action!=='save')throw new Error('คำสั่งพจนานุกรมไม่ถูกต้อง');
 const word=validateWord(input.word),analysis=validateAnalysis(word,input.analysis);
 return {entry:await store.updateDictionary({originalWord:validateWord(input.originalWord),word,analysis,expectedUpdatedAt:input.expectedUpdatedAt as number,roomCode:code,playerId:player.id})};
}
