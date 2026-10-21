type Roster={players:{id:string;name:string}[];departedPlayers?:{id:string;name:string}[]};
export function playerName(game:Roster,id:string|null|undefined):string{
  if(!id)return 'คำตั้งต้น';
  return game.players.find(p=>p.id===id)?.name??game.departedPlayers?.find(p=>p.id===id)?.name??'ผู้เล่นที่ออกจากห้อง';
}
