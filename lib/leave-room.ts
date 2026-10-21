import {finishRound} from './game.ts';
import type {Game} from './game.ts';
import {eliminate,nextActiveIndex} from './competition.ts';

// The service deletes empty/shared rooms directly using a revision guard.
export function removeRoomPlayer(game:Game,playerId:string,now:number){
  const leaving=game.players.find(p=>p.id===playerId);if(!leaving)return;
  const currentId=game.players[game.turnIndex]?.id;
  const wasHost=game.hostId===playerId,c=game.competition;
  if(c&&!c.setComplete&&c.activeIds.includes(playerId)){
    if(game.status==='playing')finishRound(game,playerId,'leave',now);
    else eliminate(game,playerId);
  }
  if(game.continuation){
    if(c?.setComplete)game.continuation=null;
    else if(game.continuation.starterId===playerId){
      const next=nextActiveIndex(game,game.players.findIndex(p=>p.id===playerId));game.continuation.starterId=game.players[next].id;
    }
  }
  game.departedPlayers??=[];game.departedPlayers.push({id:leaving.id,name:leaving.name});
  game.players=game.players.filter(p=>p.id!==playerId);
  if(c)c.activeIds=c.activeIds.filter(id=>id!==playerId);
  if(wasHost)game.hostId=game.players[0]?.id??'';
  const nextId=game.players.some(p=>p.id===currentId)?currentId:game.continuation?.starterId??c?.activeIds[0]??game.players[0]?.id;
  game.turnIndex=Math.max(0,game.players.findIndex(p=>p.id===nextId));
  if(c?.setComplete&&game.status!=='lobby'){game.status='ended';game.deadline=null;game.continuation=null;}
  game.notice=`${leaving.name} ออกจากห้องแล้ว${wasHost&&game.players[0]?` · ${game.players[0].name} เป็นเจ้าของห้องคนใหม่`:''}`;
}
