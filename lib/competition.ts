import type { Game } from './game.ts';

export type SetSummary={number:number;winnerId:string;eliminated:string[];points:Record<string,number>};
export type Competition={
  round:number;set:number;activeIds:string[];eliminated:string[];
  totals:Record<string,number>;roundPoints:Record<string,number>;setPoints:Record<string,number>;
  finalistsAwarded:boolean;setComplete:boolean;winnerId:string|null;completedSets:SetSummary[];
  history:{round:number;points:Record<string,number>;sets:SetSummary[]}[];
};
export function award(game:Game,ids:string[],points:number){
  const c=game.competition;if(!c)return;
  for(const id of ids){c.totals[id]=(c.totals[id]??0)+points;c.roundPoints[id]=(c.roundPoints[id]??0)+points;c.setPoints[id]=(c.setPoints[id]??0)+points;}
}
function finalists(game:Game){
  const c=game.competition!;
  if(!c.finalistsAwarded&&c.activeIds.length<=3){award(game,c.activeIds,1);c.finalistsAwarded=true;}
}
export function prepareCompetition(game:Game){
  if(!game.competition){
    game.competition={round:1,set:1,activeIds:game.players.map(p=>p.id),eliminated:[],totals:{},roundPoints:{},setPoints:{},finalistsAwarded:false,setComplete:false,winnerId:null,completedSets:[],history:[]};
    game.archiveWords=[];game.reviews={};finalists(game);return;
  }
  const c=game.competition;
  if(c.setComplete){
    if(c.set===(game.setsPerRound??5)){c.history.push({round:c.round,points:{...c.roundPoints},sets:structuredClone(c.completedSets)});c.round++;c.set=1;c.roundPoints={};c.completedSets=[];}
    else c.set++;
    c.activeIds=game.players.map(p=>p.id);c.eliminated=[];c.setPoints={};c.finalistsAwarded=false;c.setComplete=false;c.winnerId=null;
    game.archiveWords=[];game.reviews={};finalists(game);
  }
}
export function eliminate(game:Game,loserId:string){
  const c=game.competition;if(!c||!c.activeIds.includes(loserId)||c.setComplete)return;
  c.activeIds=c.activeIds.filter(id=>id!==loserId);c.eliminated.push(loserId);finalists(game);
  if(c.activeIds.length===1){
    c.winnerId=c.activeIds[0];award(game,[c.winnerId],2);c.setComplete=true;
    c.completedSets.push({number:c.set,winnerId:c.winnerId,eliminated:[...c.eliminated],points:{...c.setPoints}});
  }
}
export function activeIds(game:Game){return game.competition?.activeIds??game.players.map(p=>p.id);}
export function nextActiveIndex(game:Game,from:number){
  const active=activeIds(game);
  for(let i=1;i<=game.players.length;i++){const index=(from+i)%game.players.length;if(active.includes(game.players[index].id))return index;}
  return 0;
}
