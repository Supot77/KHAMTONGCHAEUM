import {tokenHash} from './rooms.ts';
import type {RoomStore} from './rooms.ts';
import {validateWord} from './game.ts';
import {validateAnalysis} from './word-analysis.ts';
import {RoomUnavailableError} from './room-lifecycle.ts';
export type DictionaryRequest={action?:unknown;code?:unknown;token?:unknown;query?:unknown;after?:unknown;originalWord?:unknown;word?:unknown;analysis?:unknown;expectedUpdatedAt?:unknown};
export async function dictionaryCommand(store:RoomStore,input:DictionaryRequest){
 const hash=await tokenHash(input.token),code=String(input.code??'').toUpperCase();
 if(!/^[A-Z2-9]{6}$/.test(code))throw new Error('เข้าห้องก่อนเปิดพจนานุกรม');
 const row=await store.read(code),player=row?.game.players.find(p=>p.tokenHash===hash);
 if(!row||!player)throw new RoomUnavailableError('คุณไม่ได้อยู่ในห้องนี้แล้ว กรุณาเข้าห้องอีกครั้ง');
 if(input.action==='list')return store.listDictionary(String(input.query??''),String(input.after??''));
 if(input.action!=='save')throw new Error('คำสั่งพจนานุกรมไม่ถูกต้อง');
 const word=validateWord(input.word),analysis=validateAnalysis(word,input.analysis);
 return {entry:await store.updateDictionary({originalWord:validateWord(input.originalWord),word,analysis,expectedUpdatedAt:input.expectedUpdatedAt as number,roomCode:code,playerId:player.id})};
}
