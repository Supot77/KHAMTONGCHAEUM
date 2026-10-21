// Uses a separately created Neon branch without changing any env file.
import nextEnv from '@next/env';
import {spawn} from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd());
const host=process.argv.find(a=>a.startsWith('--host='))?.slice(7);
const port=process.argv.find(a=>a.startsWith('--port='))?.slice(7)||'5174';
if(!host||!/^[a-z0-9.-]+\.neon\.tech$/.test(host)||!/^\d{4,5}$/.test(port))throw new Error('Supply the observed QA branch --host and optional --port.');
const url=new URL(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);if(url.hostname===host)throw new Error('QA host must differ from the configured application database.');url.hostname=host;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--port',port],{stdio:'inherit',env:{...process.env,DATABASE_URL:url.toString(),DATABASE_URL_UNPOOLED:url.toString()}});
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code??0));
