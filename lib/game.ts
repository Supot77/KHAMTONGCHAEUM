import { prepareCompetition,eliminate,nextActiveIndex,activeIds } from './competition.ts';
import type { Competition } from './competition.ts';
import type { Challenge } from './challenge.ts';
import { validateAnalysis, nounDecision } from './word-analysis.ts';
import type { WordAnalysis } from './word-analysis.ts';
export type Mode = 'shared' | 'online';
export type Player = { id: string; name: string; tokenHash: string };
export type Verification={status:'waiting_analysis'|'waiting_previous'|'valid'|'duplicate'|'not_noun'|'review'|'manual';repeated:string[];previousId:string|null;applied:boolean};
export type Word = { id: string; phaseId?:string; text: string; playerId: string | null; previousId: string | null; syllables: string[] | null; check: 'pending' | 'valid' | 'error' | 'review'; analysis?:WordAnalysis; languageStatus?:'queued'|'analyzing'|'ready'|'uncertain'|'error'; analysisSource?:'database'|'model'; verification?:Verification; manual?: boolean; at: number };
export type ResetEvent = { id: string; at: number; reason: 'duplicate' | 'human' | 'not_noun'; explanation?:string; suggestions?:string[]; word: string; wordId: string; previous: string; previousId: string; playerName: string; playerId: string; syllables: string[]; reusable: {text:string; playerName:string}[]; removed: Word[]; appealed?: boolean };
export type Review = {id:string; wordId:string; playerId:string; analysis:WordAnalysis; model?:string; status?:'draft'|'checking'|'answered'|'error'|'confirming'|'approved'; requestId?:string; leaseUntil?:number; response?:{verdict:'agree'|'revise'|'uncertain';analysis:WordAnalysis;reason:string}; error?:string; approvedId?:string; approvedAnalysis?:WordAnalysis};
export type RoundResult = {loserId:string;reason:'duplicate'|'not_noun'|'human'|'timeout'|'surrender'|'challenge';at:number};
export type Game = {
  continuation?:{at:number;starterId:string;anchorId:string;word:string;loserId:string}|null;
  releasedWords?:{text:string;playerName:string}[];
  competition?:Competition; challenge?:Challenge|null; archiveWords?:Word[];
  roundNumber?:number; result?:RoundResult|null; reviews?:Record<string,Review>;
  code: string; mode: Mode; status: 'lobby'|'starting'|'playing'|'ended'; hostId: string; players: Player[];
  chain: Word[]; events: ResetEvent[]; roundId: string; turnIndex: number; turnNumber: number; deadline: number|null; turnSeconds: number;
  manual: boolean; aiError: string|null; nextCheckAt: number; lease: {id:string; until:number; roundId:string}|null;
  processed: string[]; createdAt:number; notice:string|null;
};

export function normalize(text:string) { return text.normalize('NFC').trim(); }
export function validateWord(input:unknown):string {
  if(typeof input!=='string') throw new Error('กรุณาพิมพ์คำภาษาไทย');
  const word=normalize(input);
  if(word.length<1||word.length>200||!/[\p{L}]/u.test(word)||!/^[-\p{L}\p{M}\p{N} \u2010-\u2015.,!?…:'"()&/ฯๆ]+$/u.test(word)) throw new Error('ใช้คำนามหรือชื่อผลงาน 1–200 ตัวอักษร ไม่ใส่บรรทัดใหม่');
  return word;
}
export function validateName(input:unknown):string {
  if(typeof input!=='string') throw new Error('กรุณาใส่ชื่อผู้เล่น');
  const name=normalize(input).replace(/[\u0000-\u001f\u007f]/g,'');
  if(name.length<1||name.length>20) throw new Error('ชื่อผู้เล่นต้องมี 1–20 ตัวอักษร');
  return name;
}
export function validateSyllables(word:string, value:unknown):string[] {
  const written=word.replace(/[^\p{L}\p{M}\p{N}]/gu,'');
  if(!Array.isArray(value)||!value.length||value.length>160||value.some(s=>typeof s!=='string'||!s||s.length>200||!/^\p{L}[\p{L}\p{M}\p{N}]*$|^\p{N}+$/u.test(s)||(/^[\u0E00-\u0E7F]/.test(s)&&!/^[ก-ฮเแโใไ๐-๙]/.test(s)))||value.join('')!==written) throw new Error('ผลแบ่งพยางค์ไม่ตรงรูปเขียนเดิม กรุณาตรวจด้วยผู้เล่นหรือลองใหม่');
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
  return {roundNumber:0,result:null,reviews:{},code,mode,status:'lobby',hostId:players[0].id,players,chain:[],events:[],roundId:crypto.randomUUID(),turnIndex:0,turnNumber:0,deadline:null,turnSeconds:seconds,manual:false,aiError:null,nextCheckAt:0,lease:null,processed:[],createdAt:now,notice:null};
}
function deadline(game:Game,now:number) { return game.turnSeconds ? now+game.turnSeconds*1000:null; }
export function startRound(game:Game,seed:{text:string;syllables:string[]},now=Date.now()) {
  const text=validateWord(seed.text); const syllables=validateSyllables(text,seed.syllables);
  const previous=roundWords(game);const sameSet=Boolean(game.competition&&!game.competition.setComplete);
  prepareCompetition(game);
  if(sameSet)game.archiveWords=previous;
  game.roundNumber=game.competition!.round;game.result=null;game.challenge=null;game.continuation=null;game.releasedWords=[];
  game.roundId=crypto.randomUUID(); game.chain=[{id:crypto.randomUUID(),text,playerId:null,previousId:null,syllables,check:'valid',at:now}];
  game.events=[]; game.turnIndex=nextActiveIndex(game,-1); game.turnNumber++; game.deadline=deadline(game,now); game.status='playing'; game.aiError=null;game.lease=null;game.nextCheckAt=0;game.notice=null;
}
export function advanceTimeout(game:Game,now=Date.now()):boolean {
  if(game.status!=='playing'||(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase))||game.deadline===null||now<game.deadline) return false;
  finishRound(game,game.players[game.turnIndex].id,'timeout',now);
  game.notice=`${game.players[game.turnIndex].name} หมดเวลา — จบรอบ`;return true;
}
export function assertTurn(game:Game,actorId:string,expectedTurn:number,now:number) {
  if(game.status!=='playing') throw new Error('รอให้เริ่มเกมก่อน');
  if(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase))throw new Error('กำลังชาเลนจ์ รอผลก่อนต่อคำ');
  if(game.deadline!==null&&now>=game.deadline) throw new Error('หมดเวลาแล้ว รออัปเดตตาปัจจุบัน');
  if(expectedTurn!==game.turnNumber) throw new Error('ตาเปลี่ยนแล้ว กรุณาส่งคำอีกครั้ง');
  if(game.mode==='online'&&game.players[game.turnIndex].id!==actorId) throw new Error('ยังไม่ถึงตาของคุณ');
  if(game.mode==='shared'&&actorId!==game.hostId) throw new Error('ใช้เครื่องที่สร้างเกมเพื่อส่งคำ');
}
export function submitWord(game:Game,actorId:string,input:unknown,now:number,expectedTurn:number):Word {
  assertTurn(game,actorId,expectedTurn,now);const text=validateWord(input);
  if(game.chain.length>=1000) throw new Error('ครบ 1,000 คำแล้ว ให้เจ้าของห้องจบรอบแล้วเริ่มรอบใหม่');
  const word:Word={id:crypto.randomUUID(),phaseId:game.roundId,text,playerId:game.players[game.turnIndex].id,previousId:game.chain.at(-1)?.id??null,syllables:null,check:'pending',languageStatus:'queued',verification:{status:'waiting_analysis',repeated:[],previousId:game.chain.at(-1)?.id??null,applied:false},at:now};
  game.chain.push(word);game.turnIndex=nextActiveIndex(game,game.turnIndex);game.turnNumber++;game.deadline=deadline(game,now);game.notice=null;return word;
}
export function skipTurn(game:Game,actorId:string,now:number,expectedTurn:number) {
  assertTurn(game,actorId,expectedTurn,now);finishRound(game,game.players[game.turnIndex].id,'surrender',now);
}
export function rollback(game:Game,wordId:string,reason:'duplicate'|'human'|'not_noun',syllables:string[],now:number) {
  const index=game.chain.findIndex(w=>w.id===wordId);if(index<1)return;
  const word=game.chain[index];const prev=game.chain[index-1];
  const name=(id:string|null)=>game.players.find(p=>p.id===id)?.name??'คำตั้งต้น';
  const removed=game.chain.splice(index);
  game.events.push({id:crypto.randomUUID(),at:now,reason,word:word.text,wordId:word.id,previous:prev.text,previousId:prev.id,playerName:name(word.playerId),playerId:word.playerId!,syllables,explanation:reason==='not_noun'?word.analysis?.reason:undefined,suggestions:reason==='not_noun'?word.analysis?.suggestions:undefined,reusable:removed.slice(1).map(w=>({text:w.text,playerName:name(w.playerId)})),removed});
  finishRound(game,word.playerId!,reason,now);
  game.turnIndex=Math.max(0,game.players.findIndex(p=>p.id===word.playerId));game.turnNumber++;game.deadline=game.status==='playing'?deadline(game,now):null;game.notice=null;
}
export function applySegments(game:Game,roundId:string,results:{id:string;syllables:string[]}[],now:number) {
  if(roundId!==game.roundId)return;
  // Validate the complete batch before changing state: a malformed answer is atomic.
  const live=results.map(r=>({result:r,word:game.chain.find(w=>w.id===r.id)})).filter(r=>r.word);
  for(const {word,result} of live)validateSyllables(word!.text,result.syllables);
  for(const {word,result} of live)word!.syllables=result.syllables;
  evaluateWords(game,now);
}
// Analyze facts separately from game consequences. Historical findings never change scores.
export function evaluateWords(game:Game,now:number){
  const words=roundWords(game),byId=new Map(words.map(w=>[w.id,w]));
  for(const current of words){
    if(!current.playerId)continue;
    const previous=byId.get(current.previousId??'');
    let status:Verification['status']='waiting_analysis',repeated:string[]=[];
    if(current.manual)status='manual';
    else if(current.analysis&&nounDecision(current.analysis)==='reject')status='not_noun';
    else if(current.analysis&&nounDecision(current.analysis)==='review'){status='review';if(previous?.syllables&&current.syllables)repeated=duplicates(previous.syllables,current.syllables);}
    else if(current.syllables){
      if(!previous?.syllables)status='waiting_previous';
      else {repeated=duplicates(previous.syllables,current.syllables);status=repeated.length?'duplicate':'valid';}
    }
    current.languageStatus=current.analysis?(current.analysis.category==='uncertain'?'uncertain':'ready'):(current.languageStatus??'queued');
    const live=game.status==='playing'&&(!current.phaseId||current.phaseId===game.roundId)&&game.chain.some(w=>w.id===current.id);
    const applied=(current.verification?.applied===true&&current.verification.status===status)||(live&&!['waiting_analysis','waiting_previous','review'].includes(status));
    current.verification={status,repeated,previousId:current.previousId,applied};
    current.check=status==='valid'||status==='manual'?'valid':status==='review'||(!live&&['duplicate','not_noun'].includes(status))?'review':current.languageStatus==='error'?'error':'pending';
    if(live&&(status==='duplicate'||status==='not_noun'))rollback(game,current.id,status==='duplicate'?'duplicate':'not_noun',repeated,now);
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
  return game.players.map(p=>({id:p.id,name:p.name,score:game.competition?.totals[p.id]??0,setScore:game.competition?.setPoints[p.id]??0,roundScore:game.competition?.roundPoints[p.id]??0,active:activeIds(game).includes(p.id),pending:game.chain.filter(w=>w.playerId===p.id&&w.check!=='valid').length}));
}
export function publicGame(game:Game,revision:number,youId:string,now=Date.now()) {
  const {processed,lease,players,archiveWords,...safe}=game;
  const reviewing=game.status==='ended'&&!game.continuation;
  const challenge=game.challenge;
  const publicChallenge=challenge?(({votes,...rest})=>({...rest,votesCast:Object.keys(votes).length,votedIds:Object.keys(votes),youVote:votes[youId]??null, tally:['resolved','judging'].includes(challenge.phase)?{yes:Object.values(votes).filter(Boolean).length,no:Object.values(votes).filter(v=>!v).length}:null}))(challenge):null;
  return {...safe,challenge:publicChallenge,reviews:reviewing?game.reviews??{}:{},chain:['playing','ended'].includes(game.status)?game.chain.slice(-1):[],wordCount:Math.max(0,game.chain.length-1),needsCheck:['playing','ended'].includes(game.status)&&(analysisCandidates(game).some(needsAnalysis)||requiresVerification(game)),reviewWords:reviewing?roundWords(game):[],events:game.events.map(({removed,...event})=>event),players:scoreboard(game),revision,youId,isHost:youId===game.hostId,serverNow:now,pending:reviewing?roundWords(game).filter(needsAnalysis).length:game.chain.filter(w=>w.check!=='valid').length};
}
export type PublicGame = ReturnType<typeof publicGame>;

export function needsAnalysis(word:Word) { return (!word.analysis && !word.manual && Boolean(word.playerId)) || (!word.syllables && !word.analysis); }
export function analysisCandidates(game:Game):Word[]{
  if(game.continuation)return [];
  const live=game.chain.filter(w=>(!w.phaseId||w.phaseId===game.roundId)&&needsAnalysis(w));
  return game.status==='ended'?[...live,...roundWords(game).filter(w=>needsAnalysis(w)&&!live.some(x=>x.id===w.id))]:live;
}
export function requiresVerification(game:Game){return !game.continuation&&(game.status==='ended'?roundWords(game):game.chain).some(w=>w.playerId&&w.analysis&&!w.verification);}
export function roundWords(game:Game):Word[] {
  return [...new Map([...(game.archiveWords??[]),...game.chain,...game.events.flatMap(e=>e.removed)].map(w=>[w.id,w])).values()];
}
export function finishRound(game:Game,loserId:string,reason:RoundResult['reason'],now:number) {
  if(game.status!=='playing'||!activeIds(game).includes(loserId))return;
  if(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase)){game.challenge.phase='cancelled';game.challenge.deadline=null;}
  if(!game.competition)prepareCompetition(game);
  eliminate(game,loserId);
  game.result={loserId,reason,at:now};game.status='ended';game.deadline=null;game.turnNumber++;
  game.continuation=null;
  if(!game.competition!.setComplete){
    const rejected=reason==='challenge'&&game.challenge?.result?.connected===false?game.challenge.wordId:null;
    const anchor=[...game.chain].reverse().find(w=>w.id!==rejected&&(w.manual||!w.playerId||w.check==='valid'));
    if(anchor){const starter=nextActiveIndex(game,game.players.findIndex(p=>p.id===loserId));game.continuation={at:now+5000,starterId:game.players[starter].id,anchorId:anchor.id,word:anchor.text,loserId};}
  }
}
export function advanceContinuation(game:Game,now=Date.now()):boolean{
  const next=game.continuation;
  if(game.status!=='ended'||!next||now<next.at||game.competition?.setComplete)return false;
  const index=game.chain.findIndex(w=>w.id===next.anchorId);if(index<0)return false;
  const previous=roundWords(game);for(const word of previous)word.phaseId??=game.roundId;
  const removed=game.chain.splice(index+1);
  const rejected=game.challenge?.result?.connected===false?game.challenge.wordId:null;
  game.releasedWords=[...(game.releasedWords??[]),...removed.filter(w=>w.id!==rejected).map(w=>({text:w.text,playerName:game.players.find(p=>p.id===w.playerId)?.name??'ผู้เล่น'}))];
  game.archiveWords=previous;game.roundId=crypto.randomUUID();
  game.turnIndex=game.players.findIndex(p=>p.id===next.starterId);
  game.turnNumber++;game.deadline=deadline(game,next.at);game.status='playing';
  game.result=null;game.continuation=null;game.challenge=null;game.lease=null;game.aiError=null;game.nextCheckAt=0;
  game.notice=`${game.players[game.turnIndex].name} เริ่มต่อจาก “${game.chain.at(-1)!.text}”`;
  return true;
}
export function applyAnalyses(game:Game,roundId:string,results:{id:string;analysis:WordAnalysis}[],now:number) {
  if(roundId!==game.roundId)return;
  const live=results.map(r=>({word:roundWords(game).find(w=>w.id===r.id),analysis:r.analysis})).filter(r=>r.word);
  // Validate all results before any mutation. Removed words remain available for post-round review.
  const valid=live.map(r=>({word:r.word!,analysis:validateAnalysis(r.word!.text,r.analysis)}));
  for(const {word,analysis} of valid){word.analysis=analysis;word.syllables=analysis.syllables;if(!word.manual)word.check='pending';}
  // Still calculate historical verdicts, but evaluateWords gates all consequences on live play.
  applySegments(game,roundId,[],now);
  for(const word of game.chain)if(word.playerId&&!word.manual&&!word.analysis)word.check='pending';
}
