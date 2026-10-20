import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSqlStore } from './sql-store';
export function createLocalStore(){
  const directory=join(process.cwd(),'.data');mkdirSync(directory,{recursive:true});
  const db=new DatabaseSync(join(directory,'game.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(join(process.cwd(),'database','schema.sql'),'utf8'));
  return createSqlStore(async(query,parameters)=>db.prepare(query).all(...parameters as (string|number|null)[]) as Record<string,unknown>[]);
}
