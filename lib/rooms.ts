import { advanceChallenge,openChallenge,debate,castVote,resolveChallenge } from './challenge.ts';
import { validateAnalysis } from './word-analysis.ts';
import type { WordAnalysis } from './word-analysis.ts';
import { createGame, startRound, submitWord, skipTurn, advanceTimeout, publicGame, validateName, validateWord, applyAnalyses, needsAnalysis, roundWords, rollback, resolveManually, appealReset } from './game.ts';
import type { Game } from './game.ts';
import { AiError } from './gemini.ts';
import type { LanguageProvider } from './gemini.ts';

export interface RoomStore {
  read(code:string):Promise<{game:Game;revision:number}|null>;
  insert(game:Game):Promise<boolean>;
  write(code:string,revision:number,game:Game):Promise<boolean>;
  analyses(model:string,words:string[]):Promise<Record<string,WordAnalysis>>;
  saveAnalyses(model:string,entries:Record<string,WordAnalysis>,source?:'model'|'players'):Promise<void>;
  cached(model:string,words:string[]):Promise<Record<string,string[]>>;
  cache(model:string,entries:Record<string,string[]>):Promise<void>;
}
export type Command={action:string;code?:string;token?:string;commandId?:string;name?:unknown;names?:unknown;mode?:unknown;seconds?:unknown;text?:unknown;turn?:unknown;wordId?:unknown;eventId?:unknown;manual?:unknown;syllables?:unknown;analysis?:unknown;proposalId?:unknown;actorId?:unknown;reason?:unknown;finish?:unknown;connected?:unknown;challengeId?:unknown};
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
      const row=await this.store.read(code);if(!row)throw new Error('ไม่พบห้องนี้ ตรวจรหัสห้องอีกครั้ง');
      const value=fn(row.game);
      if(await this.store.write(code,row.revision,row.game))return {value,game:row.game,revision:row.revision+1};
    }
    throw new Error('ห้องกำลังอัปเดต กรุณาลองอีกครั้ง');
  }
  async command(command:Command) {
    const hash=await tokenHash(command.token);const now=this.clock();
    if(!['create','join','read','submit','pass','start','retry','end','reject','accept','appeal','lobby','review','confirmReview','challenge','debate','vote'].includes(command.action))throw new Error('คำสั่งไม่ถูกต้อง');
    if(command.action==='create') {
      const names=command.mode==='shared'&&Array.isArray(command.names)?command.names:[command.name];
      if(names.some(n=>typeof n!=='string'))throw new Error('กรุณาใส่ชื่อผู้เล่น');
      for(let i=0;i<8;i++){
        const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const bytes=crypto.getRandomValues(new Uint8Array(6));const code=Array.from(bytes,b=>alphabet[b%alphabet.length]).join('');
        const game=createGame(code,command.mode==='shared'?'shared':'online',names as string[],hash,typeof command.seconds==='number'?command.seconds:30,now);
        if(await this.store.insert(game))return publicGame(game,0,game.hostId,now);
      }
      throw new Error('สร้างรหัสห้องไม่ได้ กรุณาลองอีกครั้ง');
    }
    const code=String(command.code??'').toUpperCase();if(!/^[A-Z2-9]{6}$/.test(code))throw new Error('รหัสห้องต้องมี 6 ตัว');
    if(command.action==='read'){
      let row=await this.store.read(code);if(!row)throw new Error('ไม่พบห้องนี้ ตรวจรหัสห้องอีกครั้ง');
      const player=row.game.players.find(p=>p.tokenHash===hash);if(!player)throw new Error('คุณไม่ได้อยู่ในห้องนี้ กรุณาเข้าห้องอีกครั้ง');
      if(row.game.status==='playing'&&((row.game.challenge?.deadline!==null&&row.game.challenge?.deadline!==undefined&&now>=row.game.challenge.deadline)||(row.game.deadline!==null&&now>=row.game.deadline))){const updated=await this.mutate(code,g=>{advanceChallenge(g,now);advanceTimeout(g,now);});row={game:updated.game,revision:updated.revision};}
      return publicGame(row.game,row.revision,player.id,now);
    }
    if(typeof command.commandId!=='string'||command.commandId.length<8||command.commandId.length>80)throw new Error('ไม่พบรหัสคำสั่ง กรุณาลองอีกครั้ง');
    let confirmed:import('./game.ts').Review|undefined;
    if(command.action==='confirmReview'){
      const row=await this.store.read(code);const g=row?.game;
      if(!g||g.players.find(p=>p.tokenHash===hash)?.id!==g.hostId)throw new Error('คำสั่งนี้สำหรับเจ้าของห้องเท่านั้น');
      if(g.status!=='ended')throw new Error('ยืนยันข้อมูลคำได้หลังจบรอบเท่านั้น');
      confirmed=g.reviews?.[String(command.wordId)];
      const word=roundWords(g).find(w=>w.id===command.wordId);
      if(!confirmed||!word||confirmed.id!==command.proposalId)throw new Error('ข้อเสนอเปลี่ยนแล้ว กรุณาตรวจทานอีกครั้ง');
      const analysis=validateAnalysis(word.text,confirmed.analysis);
      if(analysis.category==='uncertain')throw new Error('เลือกประเภทคำให้ชัดเจนก่อนบันทึก');
      await this.store.saveAnalyses(this.provider.model,{[word.text]:analysis},'players');
    }
    const updated=await this.mutate(code,game=>{
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
      advanceChallenge(game,now);
      const host=player.id===game.hostId;
      const actor=game.mode==='shared'&&host&&typeof command.actorId==='string'?command.actorId:player.id;
      if(['debate','vote'].includes(command.action)&&(!game.challenge||game.challenge.id!==command.challengeId))throw new Error('ชาเลนจ์เปลี่ยนแล้ว กรุณารอข้อมูลล่าสุด');
      if(command.action==='challenge'){if(game.deadline!==null&&now>=game.deadline)throw new Error('หมดเวลาแล้ว กรุณารอผลเซ็ต');openChallenge(game,actor,String(command.wordId),Number(command.turn),command.reason,now);}
      if(command.action==='debate')debate(game,actor,command.text,command.finish===true,now);
      if(command.action==='vote')castVote(game,actor,command.connected,now);
      if(['start','retry','end','reject','accept','appeal','lobby','confirmReview'].includes(command.action)&&!host)throw new Error('คำสั่งนี้สำหรับเจ้าของห้องเท่านั้น');
      if(command.action==='submit')submitWord(game,player.id,command.text,now,Number(command.turn));
      if(command.action==='pass')skipTurn(game,player.id,now,Number(command.turn));
      if(command.action==='start'){
        if(game.status!=='lobby'&&game.status!=='ended')throw new Error('เกมเริ่มแล้ว');
        if(game.players.length<2)throw new Error('รอผู้เล่นอย่างน้อย 2 คน');
        game.manual=command.manual===true;
        if(game.manual){const text=validateWord(command.text);startRound(game,{text,syllables:[text.replace(/[^\p{L}\p{M}\p{N}]/gu,'')]},now);game.chain[0].manual=true;game.chain[0].syllables=null;}
        else {if(!this.provider.configured)throw new Error('ยังไม่ได้ตั้งค่า Gemini API Key ที่เซิร์ฟเวอร์');game.roundId=crypto.randomUUID();game.status='starting';game.deadline=null;game.lease=null;game.aiError=null;game.nextCheckAt=0;}
      }
      if(command.action==='retry'){game.aiError=null;game.nextCheckAt=0;for(const w of roundWords(game))if(w.check==='error')w.check='pending';}
      if(command.action==='end'){if(game.status!=='playing')throw new Error('ยังไม่ได้เริ่มเล่น');if(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase)){game.challenge.phase='cancelled';game.challenge.deadline=null;}game.status='ended';game.deadline=null;}
      if(command.action==='lobby'){if(game.challenge&&!['resolved','cancelled'].includes(game.challenge.phase))game.challenge.phase='cancelled';game.roundId=crypto.randomUUID();game.status='lobby';game.deadline=null;game.lease=null;game.aiError=null;game.nextCheckAt=0;}
      if(command.action==='reject'){if(game.status!=='playing')throw new Error('รอบนี้จบแล้ว');if(!game.chain.some(w=>w.id===command.wordId&&w.playerId))throw new Error('ไม่พบคำที่ต้องการยกเลิก');rollback(game,String(command.wordId),'human',[],now);}
      if(command.action==='accept'){if(game.status!=='playing')throw new Error('รอบนี้จบแล้ว');resolveManually(game,String(command.wordId),now,Array.isArray(command.syllables)?command.syllables as string[]:undefined);}
      if(command.action==='appeal'){if(game.status!=='playing')throw new Error('รอบนี้จบแล้ว ให้ตรวจทานฐานคำแทน');appealReset(game,String(command.eventId),now);}
      if(command.action==='review'){
        if(game.status!=='ended')throw new Error('ตรวจทานคำได้หลังจบรอบเท่านั้น');
        const word=roundWords(game).find(w=>w.id===command.wordId);if(!word)throw new Error('ไม่พบคำนี้ในรอบ');
        const analysis=validateAnalysis(word.text,command.analysis);
        game.reviews??={};game.reviews[word.id]={id:crypto.randomUUID(),wordId:word.id,playerId:player.id,analysis};
      }
      if(command.action==='confirmReview'&&confirmed){
        const proposal=game.reviews?.[confirmed.wordId];
        if(proposal?.id===confirmed.id)proposal.approvedId=confirmed.id;
      }
      game.processed=[...game.processed,command.commandId!].slice(-300);return player.id;
    });
    return publicGame(updated.game,updated.revision,updated.value,now);
  }
  async check(code:string,token:string) {
    const hash=await tokenHash(token);const now=this.clock();
    let job:{id:string;roundId:string;seed:boolean;words:{id:string;text:string}[];judgeId?:string}|undefined;
    // No read-only busy request writes to the database. Claim only after finding actual work.
    const existing=await this.store.read(code);if(!existing)throw new Error('ไม่พบห้องนี้');
    if(!existing.game.players.some(p=>p.tokenHash===hash))throw new Error('คุณไม่ได้อยู่ในห้องนี้');
    const ready=(g:Game)=>this.provider.configured&&g.nextCheckAt<=now&&(!g.lease||g.lease.until<=now)&&((g.status==='playing'&&g.challenge?.phase==='judging')||(!g.manual&&(g.status==='starting'||(['playing','ended'].includes(g.status)&&roundWords(g).some(needsAnalysis)))));
    if(!ready(existing.game))return {checked:false};
    await this.mutate(code,game=>{
      job=undefined;if(!ready(game))return;
      const id=crypto.randomUUID();game.lease={id,roundId:game.roundId,until:now+65000};
      job={id,roundId:game.roundId,seed:game.status==='starting',judgeId:game.challenge?.phase==='judging'?game.challenge.id:undefined,words:game.challenge?.phase==='judging'?[]:roundWords(game).filter(needsAnalysis).slice(0,6).map(w=>({id:w.id,text:w.text}))};
    });
    if(!job)return {checked:false};const claimed=job;
    try {
      if(claimed.judgeId){
        const state=await this.store.read(code),c=state?.game.challenge;
        if(!c||c.id!==claimed.judgeId||c.phase!=='judging')return {checked:false};
        const result=await this.provider.judgeConnection({previous:c.previous,word:c.word,opening:c.opening,ownerArgument:c.ownerArgument,challengerArgument:c.challengerArgument});
        await this.mutate(code,game=>{if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id)return;if(game.challenge?.id===claimed.judgeId)resolveChallenge(game,result.connected,'model',result.reason,this.clock());game.lease=null;game.aiError=null;});
      }else if(claimed.seed){
        const seed=await this.provider.seed();
        const analysis=validateAnalysis(seed.text,{syllables:seed.syllables,category:'noun',nounType:'common',reason:'คำนามตั้งต้นจากชุดคำที่กำหนด',suggestions:[],titleContext:''});
        await this.store.saveAnalyses(this.provider.model,{[seed.text]:analysis});
        await this.mutate(code,game=>{if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id||game.status!=='starting')return;startRound(game,seed,this.clock());game.chain[0].analysis=analysis;});
      } else {
        const words=[...new Set(claimed.words.map(w=>w.text))];
        const entries=await this.store.analyses(this.provider.model,words);const missing=words.filter(w=>!Object.hasOwn(entries,w));
        if(missing.length){const fresh=await this.provider.analyze(missing);await this.store.saveAnalyses(this.provider.model,fresh);Object.assign(entries,fresh);}
        await this.mutate(code,game=>{
          if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id)return;
          applyAnalyses(game,claimed.roundId,claimed.words.map(w=>({id:w.id,analysis:entries[w.text]})),this.clock());
          game.lease=null;game.aiError=null;game.nextCheckAt=this.clock()+4000;
        });
      }
      return {checked:true};
    }catch(error){
      const message=claimed.judgeId?'กรรมการโมเดลยังไม่พร้อม ชาเลนจ์ยังไม่ตัดสิน ให้เจ้าของห้องลองใหม่':error instanceof Error?error.message:'ตรวจคำไม่ได้ชั่วคราว';
      await this.mutate(code,game=>{
        if(game.roundId!==claimed.roundId||game.lease?.id!==claimed.id)return;
        game.lease=null;game.aiError=message;game.nextCheckAt=this.clock()+(error instanceof AiError?error.retryAfter:30000);
        for(const word of roundWords(game))if(claimed.words.some(w=>w.id===word.id)&&!word.manual)word.check='error';
      });
      return {checked:false,error:message};
    }
  }
}
