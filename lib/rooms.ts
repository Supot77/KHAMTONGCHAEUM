import { RoomUnavailableError } from './room-lifecycle.ts';
import { advanceChallenge,openChallenge,debate,castVote,resolveChallenge } from './challenge.ts';
import { validateAnalysis } from './word-analysis.ts';
import type { WordAnalysis } from './word-analysis.ts';
import { createGame, reserveSubmission, releaseSubmission, expireSubmission, startRound, submitWord, skipTurn, advanceTimeout, advanceContinuation, publicGame, validateName, validateWord, applyAnalyses, needsAnalysis, analysisCandidates, requiresVerification, roundWords, rollback, resolveManually, appealReset } from './game.ts';
import type { Game } from './game.ts';
import { AiError } from './gemini.ts';
import type { LanguageProvider } from './gemini.ts';

export interface RoomStore {
  read(code:string):Promise<{game:Game;revision:number}|null>;
  insert(game:Game):Promise<boolean>;
  write(code:string,revision:number,game:Game):Promise<boolean>;
  touch(code:string,now:number):Promise<boolean>;
  pruneExpired(now:number):Promise<number>;
  analyses(model:string,words:string[]):Promise<Record<string,WordAnalysis>>;
  randomNoun():Promise<{text:string;analysis:WordAnalysis}|null>;
  saveAnalyses(model:string,entries:Record<string,WordAnalysis>,source?:'model'|'players',metadata?:Record<string,string>):Promise<void>;
  claimAnalyses(words:string[],leaseId:string,until:number,now:number):Promise<string[]>;
  releaseAnalyses(words:string[],leaseId:string):Promise<void>;
  cached(model:string,words:string[]):Promise<Record<string,string[]>>;
  cache(model:string,entries:Record<string,string[]>):Promise<void>;
}
export type Command={action:string;code?:string;token?:string;commandId?:string;name?:unknown;names?:unknown;mode?:unknown;seconds?:unknown;setsPerRound?:unknown;text?:unknown;turn?:unknown;wordId?:unknown;eventId?:unknown;manual?:unknown;syllables?:unknown;analysis?:unknown;proposalId?:unknown;actorId?:unknown;reason?:unknown;finish?:unknown;connected?:unknown;challengeId?:unknown;useModel?:unknown};
export async function tokenHash(token:unknown):Promise<string> {
  if(typeof token!=='string'||token.length<32||token.length>160)throw new Error('เซสชันไม่ถูกต้อง กรุณาเข้าห้องอีกครั้ง');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export class RoomService {
  readonly store:RoomStore;readonly provider:LanguageProvider;readonly clock:()=>number;
  constructor(store:RoomStore,provider:LanguageProvider,clock=()=>Date.now()){this.store=store;this.provider=provider;this.clock=clock;}
  async mutate<T>(code:string,fn:(game:Game)=>T):Promise<{value:T;game:Game;revision:number}> {
    for(let attempt=0;attempt<10;attempt++){
      const row=await this.store.read(code);if(!row)throw new RoomUnavailableError();
      const value=fn(row.game);
      if(await this.store.write(code,row.revision,row.game))return {value,game:row.game,revision:row.revision+1};
    }
    throw new Error('ห้องกำลังอัปเดต กรุณาลองอีกครั้ง');
  }
  async command(command:Command) {
    const hash=await tokenHash(command.token);const now=this.clock();
    if(!['create','join','read','heartbeat','submit','pass','start','retry','end','reject','accept','appeal','lobby','review','confirmReview','challenge','debate','vote'].includes(command.action))throw new Error('คำสั่งไม่ถูกต้อง');
    if(command.action==='create') {
      const names=command.mode==='shared'&&Array.isArray(command.names)?command.names:[command.name];
      if(names.some(n=>typeof n!=='string'))throw new Error('กรุณาใส่ชื่อผู้เล่น');
      for(let i=0;i<8;i++){
        const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const bytes=crypto.getRandomValues(new Uint8Array(6));const code=Array.from(bytes,b=>alphabet[b%alphabet.length]).join('');
        const game=createGame(code,command.mode==='shared'?'shared':'online',names as string[],hash,typeof command.seconds==='number'?command.seconds:30,now,command.setsPerRound===undefined?5:command.setsPerRound);
        if(await this.store.insert(game))return publicGame(game,0,game.hostId,now);
      }
      throw new Error('สร้างรหัสห้องไม่ได้ กรุณาลองอีกครั้ง');
    }
    const code=String(command.code??'').toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))throw new Error('รหัสห้องต้องมี 6 ตัว');
    if(command.action==='read'||command.action==='heartbeat'){
      let row=await this.store.read(code);if(!row)throw new RoomUnavailableError();
      const player=row.game.players.find(p=>p.tokenHash===hash);if(!player)throw new Error('คุณไม่ได้อยู่ในห้องนี้ กรุณาเข้าห้องอีกครั้ง');
      if(command.action==='heartbeat'&&!await this.store.touch(code,now))throw new RoomUnavailableError();
      if((row.game.submission&&now>=row.game.submission.until)||(row.game.continuation&&now>=row.game.continuation.at)||(row.game.status==='playing'&&((row.game.challenge?.deadline!==null&&row.game.challenge?.deadline!==undefined&&now>=row.game.challenge.deadline)||(row.game.deadline!==null&&now>=row.game.deadline)))){const updated=await this.mutate(code,g=>{advanceContinuation(g,now);advanceChallenge(g,now);advanceTimeout(g,now);});row={game:updated.game,revision:updated.revision};}
      return publicGame(row.game,row.revision,player.id,now);
    }
    if(typeof command.commandId!=='string'||command.commandId.length<8||command.commandId.length>80)throw new Error('ไม่พบรหัสคำสั่ง กรุณาลองอีกครั้ง');
    if(command.action==='confirmReview')return this.confirmReview(code,hash,command);
    if(command.action==='submit')return this.submitCommand(code,hash,command);
    // Cache hits are independent of model readiness, cooldown and in-flight jobs.
    let opening:{text:string;analysis:WordAnalysis}|null=null;
    let openingRoundId:string|undefined;
    if(command.action==='start'&&command.manual!==true){
      const row=await this.store.read(code);if(!row)throw new RoomUnavailableError();
      if(row.game.players.find(p=>p.tokenHash===hash)?.id!==row.game.hostId)throw new Error('คำสั่งนี้สำหรับเจ้าของห้องเท่านั้น');
      if(row.game.continuation)throw new Error('กำลังนับถอยหลัง เล่นต่ออัตโนมัติได้เลย');
      openingRoundId=row.game.roundId;
      opening=await this.store.randomNoun();if(!opening)throw new Error('ฐานคำยังไม่มีคำนามที่ใช้ได้ เลือกให้ผู้เล่นตั้งคำแรกหรือเพิ่มคำนามในฐานก่อน');
    }
    const updated=await this.mutate(code,game=>{
      expireSubmission(game,now);
      if(game.submission&&['pass','challenge','accept','reject','appeal'].includes(command.action))throw new Error('กำลังส่งคำ กรุณารอผลก่อน');
      let player=game.players.find(p=>p.tokenHash===hash);
      if(command.action==='join'){
        if(player)return player.id;
        if(game.mode!=='online'||game.status!=='lobby'||(game.competition&&!game.competition.setComplete))throw new Error('ห้องเริ่มเล่นแล้ว หรือไม่เปิดให้เข้าร่วม');
        if(game.players.length>=8)throw new Error('ห้องเต็มแล้ว (8 คน)');
        const name=validateName(command.name);if(game.players.some(p=>p.name===name))throw new Error('มีผู้เล่นใช้ชื่อนี้แล้ว');
        player={id:crypto.randomUUID(),name,tokenHash:hash};game.players.push(player);game.processed.push(command.commandId!);return player.id;
      }
      if(!player)throw new Error('คุณไม่ได้อยู่ในห้องนี้');
      if(game.processed.includes(command.commandId!))return player.id;
      if(game.continuation&&['start','lobby','review','confirmReview'].includes(command.action))throw new Error('กำลังนับถอยหลัง เล่นต่ออัตโนมัติได้เลย');
      advanceContinuation(game,now);
      if(['start','lobby'].includes(command.action)&&Object.values(game.reviews??{}).some(r=>r.status==='confirming'&&(r.leaseUntil??0)>now))throw new Error('กำลังบันทึกฐานคำ กรุณารอสักครู่');
      advanceChallenge(game,now);
      const host=player.id===game.hostId;
      const actor=game.mode==='shared'&&host&&typeof command.actorId==='string'?command.actorId:player.id;
      if(['debate','vote'].includes(command.action)&&(!game.challenge||game.challenge.id!==command.challengeId))throw new Error('ชาเลนจ์เปลี่ยนแล้ว กรุณารอข้อมูลล่าสุด');
      if(command.action==='challenge'){if(game.deadline!==null&&now>=game.deadline)throw new Error('หมดเวลาแล้ว กรุณารอผลเซ็ต');openChallenge(game,actor,String(command.wordId),Number(command.turn),command.reason,now);}
      if(command.action==='debate')debate(game,actor,command.text,command.finish===true,now);
      if(command.action==='vote')castVote(game,actor,command.connected,now);
      if(['start','retry','end','reject','accept','appeal','lobby','confirmReview'].includes(command.action)&&!host)throw new Error('คำสั่งนี้สำหรับเจ้าของห้องเท่านั้น');
      if(['reject','accept'].includes(command.action)){const word=game.chain.find(w=>w.id===command.wordId);if((word?.phaseId&&word.phaseId!==game.roundId)||(word?.playerId&&game.competition&&!game.competition.activeIds.includes(word.playerId)))throw new Error('คำจากช่วงก่อนหน้าให้ตรวจทานตอนจบเซ็ต');}
      if(command.action==='pass')skipTurn(game,player.id,now,Number(command.turn));
      if(command.action==='start'){
        if(openingRoundId&&game.roundId!==openingRoundId)throw new Error('การเริ่มเกมถูกยกเลิกหรือห้องเปลี่ยนแล้ว');
        if(game.status!=='lobby'&&game.status!=='ended')throw new Error('เกมเริ่มแล้ว');
        if(game.players.length<2)throw new Error('รอผู้เล่นอย่างน้อย 2 คน');
        game.manual=command.manual===true;
        if(game.manual){const text=validateWord(command.text);startRound(game,{text,syllables:[text.replace(/[^\p{L}\p{M}\p{N}]/gu,'')]},now);game.chain[0].manual=true;game.chain[0].syllables=null;}
        else {startRound(game,{text:opening!.text,syllables:opening!.analysis.syllables},now);game.chain[0].analysis=opening!.analysis;game.chain[0].analysisSource='database';}
      }
      if(command.action==='retry'){game.aiError=null;game.nextCheckAt=0;for(const w of roundWords(game))if(w.check==='error')w.check='pending';}
      if(command.action==='end'){game.submission=null;if(game.status!=='playing')throw new Error('ยังไม่ได้เริ่มเล่น');if(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase)){game.challenge.phase='cancelled';game.challenge.deadline=null;}game.status='ended';game.deadline=null;}
      if(command.action==='lobby'){game.submission=null;if(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase))game.challenge.phase='cancelled';game.roundId=crypto.randomUUID();game.status='lobby';game.deadline=null;game.lease=null;game.aiError=null;game.nextCheckAt=0;}
      if(command.action==='reject'){if(game.status!=='playing')throw new Error('รอบนี้จบแล้ว');if(!game.chain.some(w=>w.id===command.wordId&&w.playerId))throw new Error('ไม่พบคำที่ต้องการยกเลิก');rollback(game,String(command.wordId),'human',[],now);}
      if(command.action==='accept'){if(game.status!=='playing')throw new Error('รอบนี้จบแล้ว');resolveManually(game,String(command.wordId),now,Array.isArray(command.syllables)?command.syllables as string[]:undefined);}
      if(command.action==='appeal'){if(game.status!=='playing')throw new Error('รอบนี้จบแล้ว ให้ตรวจทานฐานคำแทน');appealReset(game,String(command.eventId),now);}
      if(command.action==='review'){
        if(game.status!=='ended')throw new Error('ตรวจทานคำได้หลังจบรอบเท่านั้น');
        const word=roundWords(game).find(w=>w.id===command.wordId);if(!word)throw new Error('ไม่พบคำนี้ในรอบ');
        const analysis=validateAnalysis(word.text,command.analysis);
        if(game.reviews?.[word.id]?.status==='confirming'&&(game.reviews[word.id].leaseUntil??0)>now)throw new Error('กำลังบันทึกคำนี้ กรุณารอสักครู่');
        game.reviews??={};game.reviews[word.id]={id:crypto.randomUUID(),wordId:word.id,playerId:player.id,analysis,status:'draft'};
      }
      game.processed=[...game.processed,command.commandId!].slice(-300);return player.id;
    });
    if(!await this.store.touch(code,now))throw new RoomUnavailableError();
    return publicGame(updated.game,updated.revision,updated.value,now);
  }
  async submitCommand(code:string,hash:string,command:Command){
    const id=command.commandId!,text=validateWord(command.text),turn=Number(command.turn),receivedAt=this.clock();
    const claimed=await this.mutate(code,game=>{
      const player=game.players.find(p=>p.tokenHash===hash);if(!player)throw new Error('คุณไม่ได้อยู่ในห้องนี้');
      if(!game.processed.includes(id))reserveSubmission(game,player.id,text,turn,id,receivedAt);
      return player.id;
    });
    if(claimed.game.processed.includes(id))return publicGame(claimed.game,claimed.revision,claimed.value,this.clock());
    const reservationUntil=claimed.game.submission!.until;
    try{
      const cached=claimed.game.manual?undefined:(await this.store.analyses(this.provider.model,[text]))[text];
      if(!await this.store.touch(code,this.clock()))throw new RoomUnavailableError();
      const saved=await this.mutate(code,game=>{
        const player=game.players.find(p=>p.tokenHash===hash);if(!player)throw new Error('คุณไม่ได้อยู่ในห้องนี้');
        if(game.processed.includes(id))return player.id;
        const completedAt=this.clock();expireSubmission(game,completedAt);
        const pending=game.submission;
        if(!pending||pending.id!==id||pending.actorId!==player.id||pending.turn!==turn||pending.roundId!==game.roundId||pending.text!==text||pending.until!==reservationUntil)throw new Error('คำขอส่งหมดอายุหรือตาเปลี่ยนแล้ว กรุณาตรวจสถานะล่าสุด');
        game.submission=null;
        const word=submitWord(game,player.id,text,completedAt,turn);
        if(cached&&!game.manual){word.analysisSource='database';applyAnalyses(game,game.roundId,[{id:word.id,analysis:cached}],completedAt);}
        game.processed=[...game.processed,id].slice(-300);return player.id;
      });
      return publicGame(saved.game,saved.revision,saved.value,this.clock());
    }catch(error){
      // Release only our reservation. A lost connection may already have committed it.
      try{await this.mutate(code,game=>{if(game.submission?.until===reservationUntil&&game.submission.roundId===claimed.game.roundId)releaseSubmission(game,id,this.clock());});}catch{/* The bounded lease recovers if the database is unavailable. */}
      throw error;
    }
  }
  async hydrateCached(code:string,hash:string){
    const row=await this.store.read(code);if(!row)throw new RoomUnavailableError();
    if(!row.game.players.some(p=>p.tokenHash===hash))throw new Error('คุณไม่ได้อยู่ในห้องนี้');
    if(row.game.manual||!['playing','ended'].includes(row.game.status))return;
    const words=analysisCandidates(row.game).slice(0,100);
    const verify=requiresVerification(row.game);
    if(!words.length&&!verify)return;
    const entries=await this.store.analyses(this.provider.model,[...new Set(words.map(w=>w.text))]);
    const hits=words.filter(w=>Object.hasOwn(entries,w.text));if(!hits.length&&!verify)return;
    await this.mutate(code,game=>{
      if(game.roundId!==row.game.roundId)return;
      const current=roundWords(game);
      const usable=hits.filter(w=>current.some(x=>x.id===w.id&&!x.analysis&&!x.manual));
      for(const hit of usable)current.find(w=>w.id===hit.id)!.analysisSource='database';
      applyAnalyses(game,game.roundId,usable.map(w=>({id:w.id,analysis:entries[w.text]})),this.clock());
    });
  }
  async review(code:string,token:string,wordId:string,proposalId:string){
    const hash=await tokenHash(token),requestId=crypto.randomUUID();let claimed=false;
    const state=await this.mutate(code,game=>{
      claimed=false;
      const player=game.players.find(p=>p.tokenHash===hash);if(!player)throw new Error('คุณไม่ได้อยู่ในห้องนี้');
      if(game.status!=='ended'||game.continuation)throw new Error('ขอตรวจใหม่ได้หลังจบเซ็ตหรือพักตรวจคำเท่านั้น');
      const proposal=game.reviews?.[wordId];if(!proposal||proposal.id!==proposalId)throw new Error('ข้อเสนอเปลี่ยนแล้ว กรุณาส่งใหม่');
      if(proposal.status==='answered'||proposal.status==='approved'||proposal.status==='confirming'||(proposal.status==='checking'&&(proposal.leaseUntil??0)>this.clock()))return player.id;
      if(!this.provider.configured)throw new Error('ยังไม่ได้ตั้งค่า Gemini API Key');
      proposal.status='checking';proposal.model=this.provider.model;proposal.requestId=requestId;proposal.leaseUntil=this.clock()+65000;proposal.error=undefined;claimed=true;return player.id;
    });
    if(!claimed)return publicGame(state.game,state.revision,state.value,this.clock());
    const proposal=state.game.reviews![wordId],word=roundWords(state.game).find(w=>w.id===wordId)!;
    try{
      const response=await this.provider.reviewAnalysis({word:word.text,original:word.analysis??null,proposal:proposal.analysis});
      const analysis=validateAnalysis(word.text,response.analysis);
      if(!['agree','revise','uncertain'].includes(response.verdict)||!response.reason?.trim()||response.reason.length>500)throw new Error('รูปแบบคำตอบตรวจทานไม่ถูกต้อง');
      const updated=await this.mutate(code,game=>{const r=game.reviews?.[wordId];if(game.roundId!==state.game.roundId||r?.id!==proposalId||r.requestId!==requestId)return;r.status='answered';r.response={...response,analysis};r.error=undefined;});
      return publicGame(updated.game,updated.revision,state.value,this.clock());
    }catch(error){
      const updated=await this.mutate(code,game=>{const r=game.reviews?.[wordId];if(game.roundId!==state.game.roundId||r?.id!==proposalId||r.requestId!==requestId)return;r.status='error';r.error=error instanceof Error?error.message:'ตรวจทานไม่สำเร็จ กรุณาลองใหม่';});
      return publicGame(updated.game,updated.revision,state.value,this.clock());
    }
  }
  async confirmReview(code:string,hash:string,command:Command){
    const wordId=String(command.wordId),proposalId=String(command.proposalId),useModel=command.useModel!==false;
    const state=await this.mutate(code,game=>{
      const player=game.players.find(p=>p.tokenHash===hash);if(player?.id!==game.hostId)throw new Error('คำสั่งนี้สำหรับเจ้าของห้องเท่านั้น');
      if(game.status!=='ended'||game.continuation)throw new Error('ยืนยันข้อมูลคำได้หลังจบเซ็ตหรือพักตรวจคำเท่านั้น');
      const r=game.reviews?.[wordId];if(!r||r.id!==proposalId)throw new Error('ข้อเสนอเปลี่ยนแล้ว กรุณาตรวจทานอีกครั้ง');
      if(r.approvedId===r.id)return player.id;
      if(r.status==='confirming'&&(r.leaseUntil??0)>this.clock())throw new Error('กำลังบันทึก กรุณารอสักครู่');
      if(r.status==='confirming')r.status='answered';
      if(r.status!=='answered'||!r.response)throw new Error('รอคำตอบจากโมเดลก่อนยืนยันฐานคำ');
      const word=roundWords(game).find(w=>w.id===wordId)!;
      if(useModel&&r.response.verdict==='uncertain')throw new Error('โมเดลยังไม่แน่ใจ ให้ตรวจข้อเสนอของผู้เล่นก่อนยืนยัน');
      const analysis=validateAnalysis(word.text,useModel?r.response.analysis:r.analysis);
      if(analysis.category==='uncertain')throw new Error('เลือกประเภทคำให้ชัดเจนก่อนบันทึก');
      r.approvedAnalysis=analysis;r.status='confirming';r.leaseUntil=this.clock()+90000;return player.id;
    });
    const r=state.game.reviews![wordId];if(r.approvedId===r.id)return publicGame(state.game,state.revision,state.value,this.clock());
    const word=roundWords(state.game).find(w=>w.id===wordId)!;
    try{
      await this.store.saveAnalyses(r.model??this.provider.model,{[word.text]:r.approvedAnalysis!},'players',{roomCode:code,playerId:state.value,proposalId});
      const updated=await this.mutate(code,game=>{const current=game.reviews?.[wordId];if(current?.id===proposalId){current.status='approved';current.approvedId=proposalId;}});
      await this.store.touch(code,this.clock());return publicGame(updated.game,updated.revision,state.value,this.clock());
    }catch(error){await this.mutate(code,game=>{const current=game.reviews?.[wordId];if(current?.id===proposalId&&current.status==='confirming')current.status='answered';});throw error;}
  }
  async check(code:string,token:string) {
    const hash=await tokenHash(token);const now=this.clock();
    let job:{id:string;roundId:string;seed:boolean;words:{id:string;text:string}[];judgeId?:string}|undefined;
    // No read-only busy request writes to the database. Claim only after finding actual work.
    await this.hydrateCached(code,hash);
    const existing=await this.store.read(code);if(!existing)throw new RoomUnavailableError();
    if(!existing.game.players.some(p=>p.tokenHash===hash))throw new Error('คุณไม่ได้อยู่ในห้องนี้');
    const ready=(g:Game)=>(g.status==='starting'||this.provider.configured)&&g.nextCheckAt<=now&&(!g.lease||g.lease.until<=now)&&((g.status==='playing'&&g.challenge?.phase==='judging')||(!g.manual&&(g.status==='starting'||(['playing','ended'].includes(g.status)&&analysisCandidates(g).some(needsAnalysis)))));
    if(!ready(existing.game))return {checked:false};
    await this.mutate(code,game=>{
      job=undefined;if(!ready(game))return;
      const id=crypto.randomUUID();game.lease={id,roundId:game.roundId,until:now+65000};
      job={id,roundId:game.roundId,seed:game.status==='starting',judgeId:game.challenge?.phase==='judging'?game.challenge.id:undefined,words:game.challenge?.phase==='judging'?[]:analysisCandidates(game).slice(0,6).map(w=>({id:w.id,text:w.text}))};
    });
    if(!job)return {checked:false};const claimed=job;
    try {
      if(claimed.judgeId){
        const state=await this.store.read(code),c=state?.game.challenge;
        if(!c||c.id!==claimed.judgeId||c.phase!=='judging')return {checked:false};
        const result=await this.provider.judgeConnection({previous:c.previous,word:c.word,opening:c.opening,ownerArgument:c.ownerArgument,challengerArgument:c.challengerArgument});
        await this.mutate(code,game=>{if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id)return;if(game.challenge?.id===claimed.judgeId)resolveChallenge(game,result.connected,'model',result.reason,this.clock());game.lease=null;game.aiError=null;});
      }else if(claimed.seed){
        const seed=await this.store.randomNoun();if(!seed)throw new Error('ฐานคำยังไม่มีคำนามที่ใช้ได้');
        await this.mutate(code,game=>{if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id||game.status!=='starting')return;startRound(game,{text:seed.text,syllables:seed.analysis.syllables},this.clock());game.chain[0].analysis=seed.analysis;game.chain[0].analysisSource='database';});
      } else {
        const words=[...new Set(claimed.words.map(w=>w.text))];
        const entries=await this.store.analyses(this.provider.model,words);
        // Apply every hit before making any slow external request.
        await this.mutate(code,game=>{
          if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id)return;
          applyAnalyses(game,claimed.roundId,claimed.words.filter(w=>Object.hasOwn(entries,w.text)).map(w=>({id:w.id,analysis:entries[w.text]})),this.clock());
        });
        const missing=words.filter(w=>!Object.hasOwn(entries,w));
        const owned=await this.store.claimAnalyses(missing,claimed.id,this.clock()+65000,this.clock());
        try{
          // Re-read after claiming: another room may have completed between lookup and claim.
          Object.assign(entries,await this.store.analyses(this.provider.model,owned));
          const freshWords=owned.filter(w=>!Object.hasOwn(entries,w));
          if(freshWords.length){
            await this.mutate(code,game=>{if(game.roundId===claimed.roundId&&game.lease?.id===claimed.id)for(const w of analysisCandidates(game))if(freshWords.includes(w.text))w.languageStatus='analyzing';});
            const fresh=await this.provider.analyze(freshWords);await this.store.saveAnalyses(this.provider.model,fresh);
          }
          // The database may now hold a human correction; never apply a stale model draft over it.
          Object.assign(entries,await this.store.analyses(this.provider.model,words));
          await this.mutate(code,game=>{
            if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id)return;
            for(const word of roundWords(game))if(claimed.words.some(w=>w.id===word.id)&&!word.analysis)word.analysisSource=freshWords.includes(word.text)?'model':'database';
            applyAnalyses(game,claimed.roundId,claimed.words.filter(w=>Object.hasOwn(entries,w.text)).map(w=>({id:w.id,analysis:entries[w.text]})),this.clock());
            game.lease=null;game.aiError=null;game.nextCheckAt=this.clock()+(words.some(w=>!Object.hasOwn(entries,w))?1000:4000);
          });
        }finally{await this.store.releaseAnalyses(owned,claimed.id);}

      }
      return {checked:true};
    }catch(error){
      const message=claimed.judgeId?'กรรมการโมเดลยังไม่พร้อม ชาเลนจ์ยังไม่ตัดสิน ให้เจ้าของห้องลองใหม่':error instanceof Error?error.message:'ตรวจคำไม่ได้ชั่วคราว';
      await this.mutate(code,game=>{
        if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id)return;
        game.lease=null;game.aiError=message;game.nextCheckAt=this.clock()+(error instanceof AiError?error.retryAfter:30000);
        for(const word of roundWords(game))if(claimed.words.some(w=>w.id===word.id)&&!word.manual&&!word.analysis){word.check='error';word.languageStatus='error';}
      });
      return {checked:false,error:message};
    }
  }
}
