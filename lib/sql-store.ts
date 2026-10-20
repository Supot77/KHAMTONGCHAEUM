import { ANALYSIS_POLICY,validateAnalysis } from './word-analysis.ts';
import type { Game } from './game.ts';
import type { RoomStore } from './rooms.ts';
export type SqlRow=Record<string,unknown>;
export type SqlExecute=(query:string,parameters:unknown[])=>Promise<SqlRow[]>;
const CACHE_VERSION='written-thai-v1';
export function createSqlStore(execute:SqlExecute):RoomStore {
  return {
    async read(code){const [row]=await execute('SELECT data, revision FROM rooms WHERE code = ?',[code]);return row?{game:JSON.parse(String(row.data)) as Game,revision:Number(row.revision)}:null;},
    async insert(game){const rows=await execute('INSERT INTO rooms (code,data,revision,updated_at) VALUES (?,?,0,?) ON CONFLICT (code) DO NOTHING RETURNING code',[game.code,JSON.stringify(game),Date.now()]);return rows.length===1;},
    async write(code,revision,game){const rows=await execute('UPDATE rooms SET data = ?, revision = revision + 1, updated_at = ? WHERE code = ? AND revision = ? RETURNING code',[JSON.stringify(game),Date.now(),code,revision]);return rows.length===1;},
    async analyses(model,words){
      if(!words.length)return {};
      const rows=await execute(`SELECT word,analysis FROM word_analysis_cache WHERE policy = ? AND model = ? AND word IN (${words.map(()=>'?').join(',')})`,[ANALYSIS_POLICY,model,...words]);
      return Object.fromEntries(rows.map(r=>[String(r.word),validateAnalysis(String(r.word),JSON.parse(String(r.analysis)))]));
    },
    async saveAnalyses(model,entries,source='model'){
      const items=Object.entries(entries).map(([word,a])=>[word,validateAnalysis(word,a)] as const);if(!items.length)return;
      await execute(`INSERT INTO word_analysis_cache (policy,model,word,analysis,source,updated_at) VALUES ${items.map(()=>'(?,?,?,?,?,?)').join(',')} ON CONFLICT (policy,model,word) DO UPDATE SET analysis = excluded.analysis, source = excluded.source, updated_at = excluded.updated_at WHERE word_analysis_cache.source != 'players' OR excluded.source = 'players'`,items.flatMap(([word,analysis])=>[ANALYSIS_POLICY,model,word,JSON.stringify(analysis),source,Date.now()]));
    },
    async cached(model,words){if(!words.length)return {};const rows=await execute(`SELECT word,syllables FROM syllable_cache WHERE model = ? AND word IN (${words.map(()=>'?').join(',')})`,[`${CACHE_VERSION}:${model}`,...words]);return Object.fromEntries(rows.map(r=>[String(r.word),JSON.parse(String(r.syllables)) as string[]]));},
    async cache(model,entries){const items=Object.entries(entries);if(!items.length)return;await execute(`INSERT INTO syllable_cache (model,word,syllables) VALUES ${items.map(()=>'(?,?,?)').join(',')} ON CONFLICT (model,word) DO UPDATE SET syllables = excluded.syllables`,items.flatMap(([word,syllables])=>[`${CACHE_VERSION}:${model}`,word,JSON.stringify(syllables)]));}
  };
}
export function postgresPlaceholders(query:string){let index=0;return query.replace(/\?/g,()=>`$${++index}`);}
