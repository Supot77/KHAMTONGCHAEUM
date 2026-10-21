import {createDictionaryStore} from './dictionary.ts';
import { ROOM_IDLE_MS,ROOM_ACTIVITY_SQL,DELETE_EXPIRED_ROOMS_SQL } from './room-lifecycle.ts';
import { ANALYSIS_POLICY,validateAnalysis } from './word-analysis.ts';
import type { Game } from './game.ts';
import type { RoomStore } from './rooms.ts';
export type SqlRow=Record<string,unknown>;
export type SqlExecute=(query:string,parameters:unknown[])=>Promise<SqlRow[]>;
export type SqlTransaction=<T>(work:(execute:SqlExecute)=>Promise<T>)=>Promise<T>;
const CACHE_VERSION='written-thai-v1';
export function createSqlStore(execute:SqlExecute,clock=()=>Date.now(),transaction?:SqlTransaction,dialect:'sqlite'|'postgres'='sqlite'):RoomStore {
  return {
    ...createDictionaryStore(execute,clock,transaction,dialect),
    async randomNoun(){
      const category=dialect==='postgres'?"(analysis::jsonb ->> 'category')":"json_extract(analysis,'$.category')";
      const [row]=await execute(`SELECT word,analysis FROM word_dictionary WHERE ${category} = 'noun' ORDER BY RANDOM() LIMIT 1`,[]);
      return row?{text:String(row.word),analysis:validateAnalysis(String(row.word),JSON.parse(String(row.analysis)))}:null;
    },
    async read(code){const [row]=await execute(`SELECT data, revision FROM rooms WHERE code = ? AND ${ROOM_ACTIVITY_SQL} > ?`,[code,clock()-ROOM_IDLE_MS]);return row?{game:JSON.parse(String(row.data)) as Game,revision:Number(row.revision)}:null;},
    async insert(game){const rows=await execute('INSERT INTO rooms (code,data,revision,updated_at,last_active_at) VALUES (?,?,0,?,?) ON CONFLICT (code) DO NOTHING RETURNING code',[game.code,JSON.stringify(game),clock(),clock()]);return rows.length===1;},
    async write(code,revision,game){const rows=await execute(`UPDATE rooms SET data = ?, revision = revision + 1, updated_at = ? WHERE code = ? AND revision = ? AND ${ROOM_ACTIVITY_SQL} > ? RETURNING code`,[JSON.stringify(game),clock(),code,revision,clock()-ROOM_IDLE_MS]);return rows.length===1;},
    async remove(code,revision){const rows=await execute('DELETE FROM rooms WHERE code = ? AND revision = ? RETURNING code',[code,revision]);return rows.length===1;},
    async touch(code,now){const rows=await execute(`UPDATE rooms SET last_active_at = ? WHERE code = ? AND ${ROOM_ACTIVITY_SQL} > ? RETURNING code`,[now,code,now-ROOM_IDLE_MS]);return rows.length===1;},
    async pruneExpired(now){return (await execute(DELETE_EXPIRED_ROOMS_SQL,[now-ROOM_IDLE_MS])).length;},
    async analyses(_model,words){
      if(!words.length)return {};
      const rows=await execute(`SELECT word,analysis FROM word_dictionary WHERE word IN (${words.map(()=>'?').join(',')})`,words);
      // Rolling deployments can still add words through the previous app version.
      const missing=words.filter(word=>!rows.some(row=>row.word===word));
      if(missing.length)rows.push(...await execute(`SELECT word,analysis FROM (SELECT word,analysis,ROW_NUMBER() OVER(PARTITION BY word ORDER BY CASE WHEN source='players' THEN 0 ELSE 1 END,updated_at DESC,model,policy) AS rank FROM word_analysis_cache WHERE word IN (${missing.map(()=>'?').join(',')})) AS legacy WHERE rank=1`,missing));
      return Object.fromEntries(rows.map(r=>[String(r.word),validateAnalysis(String(r.word),JSON.parse(String(r.analysis)))]));
    },
    async saveAnalyses(model,entries,source='model',metadata={}){
      const items=Object.entries(entries).map(([word,a])=>[word,validateAnalysis(word,a)] as const);if(!items.length)return;
      const at=clock();
      const save=async(exec:SqlExecute)=>{
        const changed=await exec(`INSERT INTO word_dictionary (word,analysis,source,model,policy,updated_at) VALUES ${items.map(()=>'(?,?,?,?,?,?)').join(',')} ON CONFLICT(word) DO UPDATE SET analysis=excluded.analysis,source=excluded.source,model=excluded.model,policy=excluded.policy,updated_at=excluded.updated_at WHERE word_dictionary.source != 'players' OR excluded.source = 'players' RETURNING word,analysis,source,model,policy,updated_at`,items.flatMap(([word,analysis])=>[word,JSON.stringify(analysis),source,model,ANALYSIS_POLICY,at]));
        for(const row of changed)await exec('INSERT INTO word_analysis_history(id,word,analysis,source,model,policy,updated_at,metadata) VALUES(?,?,?,?,?,?,?,?)',[crypto.randomUUID(),row.word,row.analysis,row.source,row.model,row.policy,row.updated_at,JSON.stringify(metadata)]);
      };
      if(transaction)await transaction(save);else await save(execute);
    },
    async claimAnalyses(words,leaseId,until,now){
      const claimed:string[]=[];
      for(const word of words){const rows=await execute('INSERT INTO word_analysis_jobs(word,lease_id,lease_until) VALUES(?,?,?) ON CONFLICT(word) DO UPDATE SET lease_id=excluded.lease_id,lease_until=excluded.lease_until WHERE word_analysis_jobs.lease_until <= ? RETURNING word',[word,leaseId,until,now]);if(rows.length)claimed.push(word);}
      return claimed;
    },
    async releaseAnalyses(words,leaseId){if(words.length)await execute(`DELETE FROM word_analysis_jobs WHERE lease_id=? AND word IN (${words.map(()=>'?').join(',')}) RETURNING word`,[leaseId,...words]);},
    async cached(model,words){if(!words.length)return {};const rows=await execute(`SELECT word,syllables FROM syllable_cache WHERE model = ? AND word IN (${words.map(()=>'?').join(',')})`,[`${CACHE_VERSION}:${model}`,...words]);return Object.fromEntries(rows.map(r=>[String(r.word),JSON.parse(String(r.syllables)) as string[]]));},
    async cache(model,entries){const items=Object.entries(entries);if(!items.length)return;await execute(`INSERT INTO syllable_cache (model,word,syllables) VALUES ${items.map(()=>'(?,?,?)').join(',')} ON CONFLICT (model,word) DO UPDATE SET syllables = excluded.syllables`,items.flatMap(([word,syllables])=>[`${CACHE_VERSION}:${model}`,word,JSON.stringify(syllables)]));}
  };
}
export function postgresPlaceholders(query:string){let index=0;return query.replace(/\?/g,()=>`$${++index}`);}
