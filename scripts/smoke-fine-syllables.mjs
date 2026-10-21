import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {createProvider} from '../lib/gemini.ts';
if(!process.argv.includes('--allow-model-call'))throw new Error('Use --allow-model-call for one explicit two-word live prompt check; no dictionary writes.');
nextEnv.loadEnvConfig(process.cwd());const provider=createProvider(process.env.GEMINI_API_KEY,process.env.GEMINI_MODEL);
const words=['กรุงเทพมหานคร','มหาสมุทร'],result=await provider.analyze(words);
assert.deepEqual(result[words[0]].syllables,['กรุง','เทพ','ม','หา','น','คร']);assert.deepEqual(result[words[1]].syllables,['ม','หา','ส','มุทร']);assert.equal(result[words[0]].category,'noun');assert.equal(result[words[1]].category,'noun');
console.log(JSON.stringify({model:provider.model,words:words.map(word=>({word,syllables:result[word].syllables,category:result[word].category})),dictionaryWrites:0,result:'PASS'}));
