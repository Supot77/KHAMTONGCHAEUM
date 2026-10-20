export type Mode = 'shared' | 'online';
export type Player = { id: string; name: string; tokenHash: string };
export type Word = { id: string; text: string; playerId: string | null; previousId: string | null; syllables: string[] | null; check: 'pending' | 'valid' | 'error'; manual?: boolean; at: number };
export type ResetEvent = { id: string; at: number; reason: 'duplicate' | 'human'; word: string; wordId: string; previous: string; previousId: string; playerName: string; playerId: string; syllables: string[]; reusable: {text:string; playerName:string}[]; removed: Word[]; appealed?: boolean };
export type Game = {
  code: string; mode: Mode; status: 'lobby'|'starting'|'playing'|'ended'; hostId: string; players: Player[];
  chain: Word[]; events: ResetEvent[]; roundId: string; turnIndex: number; turnNumber: number; deadline: number|null; turnSeconds: number;
  manual: boolean; aiError: string|null; nextCheckAt: number; lease: {id:string; until:number; roundId:string}|null;
  processed: string[]; createdAt:number; notice:string|null;
};

export function normalize(text:string) { return text.normalize('NFC').trim(); }
export function validateWord(input:unknown):string {
  if(typeof input!=='string') throw new Error('กรุณาพิมพ์คำภาษาไทย');
  const word=normalize(input);
  if(word.length<1||word.length>64||!/^[\u0E01-\u0E3A\u0E40-\u0E4E]+$/.test(word)||!/[ก-ฮ]/.test(word)) throw new Error('ใช้คำภาษาไทย 1–64 ตัวอักษร โดยไม่เว้นวรรคหรือใส่เครื่องหมาย');
  return word;
}
export function validateName(input:unknown):string {
  if(typeof input!=='string') throw new Error('กรุณาใส่ชื่อผู้เล่น');
  const name=normalize(input).replace(/[\u0000-\u001f\u007f]/g,'');
  if(name.length<1||name.length>20) throw new Error('ชื่อผู้เล่นต้องมี 1–20 ตัวอักษร');
  return name;
}
export function validateSyllables(word:string, value:unknown):string[] {
  if(!Array.isArray(value)||!value.length||value.length>32||value.some(s=>typeof s!=='string'||!s||s.length>64||!/[ก-ฮ]/.test(s)||!/^[ก-ฮเแโใไ]/.test(s))||value.join('')!==word) throw new Error('ผลแบ่งพยางค์ไม่ตรงรูปเขียนเดิม กรุณาตรวจด้วยผู้เล่นหรือลองใหม่');
  return value as string[];
}
export function duplicates(previous:string[], current:string[]) { return [...new Set(current.filter(s=>previous.includes(s)))]; }
export function createGame(code:string,mode:Mode,names:string[],hostHash:string,seconds:number,now=Date.now()):Game {
  if(!['shared','online'].includes(mode)) throw new Error('โหมดไม่ถูกต้อง');
  if(names.length<1||names.length>8||(mode==='shared'&&names.length<2)) throw new Error('เล่นเครื่องเดียวใช้ผู้เล่น 2–8 คน');
  const clean=names.map(validateName);
  if(new Set(clean).size!==clean.length) throw new Error('ชื่อผู้เล่นต้องไม่ซ้ำกัน');
  if(![0,15,30,45,60].includes(seconds)) throw new Error('เวลาต้องเป็น 15, 30, 45, 60 วินาที หรือปิดเวลา');
  const players=clean.map((name,i)=>({id:crypto.randomUUID(),name,tokenHash:i===0?hostHash:''}));
  return {code,mode,status:'lobby',hostId:players[0].id,players,chain:[],events:[],roundId:crypto.randomUUID(),turnIndex:0,turnNumber:0,deadline:null,turnSeconds:seconds,manual:false,aiError:null,nextCheckAt:0,lease:null,processed:[],createdAt:now,notice:null};
}
function deadline(game:Game,now:number) { return game.turnSeconds ? now+game.turnSeconds*1000:null; }
export function startRound(game:Game,seed:{text:string;syllables:string[]},now=Date.now()) {
  const text=validateWord(seed.text); const syllables=validateSyllables(text,seed.syllables);
  game.roundId=crypto.randomUUID(); game.chain=[{id:crypto.randomUUID(),text,playerId:null,previousId:null,syllables,check:'valid',at:now}];
  game.events=[]; game.turnIndex=0; game.turnNumber++; game.deadline=deadline(game,now); game.status='playing'; game.aiError=null;game.lease=null;game.nextCheckAt=0;game.notice=null;
}
export function advanceTimeout(game:Game,now=Date.now()):boolean {
  if(game.status!=='playing'||game.deadline===null||now<game.deadline) return false;
  const turns=Math.floor((now-game.deadline)/(game.turnSeconds*1000))+1;
  const name=game.players[game.turnIndex].name;
  game.turnIndex=(game.turnIndex+turns)%game.players.length;game.turnNumber+=turns;game.deadline+=turns*game.turnSeconds*1000;
  game.notice=turns===1?`${name} หมดเวลา — เปลี่ยนตาแล้ว`:`ข้าม ${turns} ตาที่หมดเวลา`;return true;
}
export function assertTurn(game:Game,actorId:string,expectedTurn:number,now:number) {
  if(game.status!=='playing') throw new Error('รอให้เริ่มเกมก่อน');
  if(game.deadline!==null&&now>=game.deadline) throw new Error('หมดเวลาแล้ว รออัปเดตตาปัจจุบัน');
  if(expectedTurn!==game.turnNumber) throw new Error('ตาเปลี่ยนแล้ว กรุณาส่งคำอีกครั้ง');
  if(game.mode==='online'&&game.players[game.turnIndex].id!==actorId) throw new Error('ยังไม่ถึงตาของคุณ');
  if(game.mode==='shared'&&actorId!==game.hostId) throw new Error('ใช้เครื่องที่สร้างเกมเพื่อส่งคำ');
}
export function submitWord(game:Game,actorId:string,input:unknown,now:number,expectedTurn:number):Word {
  assertTurn(game,actorId,expectedTurn,now);const text=validateWord(input);
  if(game.chain.length>=1000) throw new Error('ครบ 1,000 คำแล้ว ให้เจ้าของห้องจบรอบแล้วเริ่มรอบใหม่');
  const word:Word={id:crypto.randomUUID(),text,playerId:game.players[game.turnIndex].id,previousId:game.chain.at(-1)?.id??null,syllables:null,check:'pending',at:now};
  game.chain.push(word);game.turnIndex=(game.turnIndex+1)%game.players.length;game.turnNumber++;game.deadline=deadline(game,now);game.notice=null;return word;
}
export function skipTurn(game:Game,actorId:string,now:number,expectedTurn:number) {
  assertTurn(game,actorId,expectedTurn,now);const name=game.players[game.turnIndex].name;
  game.turnIndex=(game.turnIndex+1)%game.players.length;game.turnNumber++;game.deadline=deadline(game,now);game.notice=`${name} ข้ามตา`;
}
export function rollback(game:Game,wordId:string,reason:'duplicate'|'human',syllables:string[],now:number) {
  const index=game.chain.findIndex(w=>w.id===wordId);if(index<1)return;
  const word=game.chain[index];const prev=game.chain[index-1];
  const name=(id:string|null)=>game.players.find(p=>p.id===id)?.name??'คำตั้งต้น';
  const removed=game.chain.splice(index);
  game.events.push({id:crypto.randomUUID(),at:now,reason,word:word.text,wordId:word.id,previous:prev.text,previousId:prev.id,playerName:name(word.playerId),playerId:word.playerId!,syllables,reusable:removed.slice(1).map(w=>({text:w.text,playerName:name(w.playerId)})),removed});
  game.turnIndex=Math.max(0,game.players.findIndex(p=>p.id===word.playerId));game.turnNumber++;game.deadline=game.status==='playing'?deadline(game,now):null;game.notice=null;
}
export function applySegments(game:Game,roundId:string,results:{id:string;syllables:string[]}[],now:number) {
  if(roundId!==game.roundId)return;
  // Validate the complete batch before changing state: a malformed answer is atomic.
  const live=results.map(r=>({result:r,word:game.chain.find(w=>w.id===r.id)})).filter(r=>r.word);
  for(const {word,result} of live)validateSyllables(word!.text,result.syllables);
  for(const {word,result} of live)word!.syllables=result.syllables;
  for(let i=1;i<game.chain.length;i++) {
    const current=game.chain[i],previous=game.chain[i-1];
    if(current.manual){current.check='valid';continue;}
    if(!previous.syllables||!current.syllables)continue;
    const repeated=duplicates(previous.syllables,current.syllables);
    if(repeated.length){rollback(game,current.id,'duplicate',repeated,now);break;}
    current.check='valid';
  }
}
export function resolveManually(game:Game,id:string,now:number,syllables?:string[]) {
  const word=game.chain.find(w=>w.id===id);if(!word||!word.playerId)throw new Error('ไม่พบคำที่ต้องการรับรอง');
  if(syllables)word.syllables=validateSyllables(word.text,syllables);
  word.manual=true;word.check='valid';
  applySegments(game,game.roundId,[],now);
}
export function appealReset(game:Game,eventId:string,now:number) {
  const event=game.events.find(e=>e.id===eventId);
  if(!event||event.appealed||game.chain.at(-1)?.id!==event.previousId)throw new Error('รับรองย้อนหลังได้ก่อนส่งคำใหม่เท่านั้น');
  const word={...event.removed[0],manual:true,check:'valid' as const};
  game.chain.push(word);event.appealed=true;game.turnIndex=(game.players.findIndex(p=>p.id===word.playerId)+1)%game.players.length;game.turnNumber++;game.deadline=game.status==='playing'?deadline(game,now):null;
  // Descendants stay reset; an appeal only restores the disputed word.
}
export function scoreboard(game:Game) {
  return game.players.map(p=>({id:p.id,name:p.name,score:game.chain.filter(w=>w.playerId===p.id&&w.check==='valid').length,pending:game.chain.filter(w=>w.playerId===p.id&&w.check!=='valid').length}));
}
export function publicGame(game:Game,revision:number,youId:string,now=Date.now()) {
  const {processed,lease,players,...safe}=game;
  return {...safe,events:game.events.map(({removed,...event})=>event),players:scoreboard(game),revision,youId,isHost:youId===game.hostId,serverNow:now,pending:game.chain.filter(w=>w.check!=='valid').length};
}
export type PublicGame = ReturnType<typeof publicGame>;
