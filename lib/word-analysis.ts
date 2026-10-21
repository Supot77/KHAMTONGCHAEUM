import { validateSyllables } from './game.ts';

// Change this when classification or spelling policy changes; old cache stays intact.
export const ANALYSIS_POLICY = 'thai-noun-titles-v2-fine-syllables';
export const CATEGORIES = ['noun','verb','adjective','adverb','sentence','phrase','other','uncertain'] as const;
export const NOUN_TYPES = ['common','proper','nominalized','song','movie','series','none'] as const;
export type WordAnalysis = {
  syllables:string[];
  category:typeof CATEGORIES[number];
  nounType:typeof NOUN_TYPES[number];
  reason:string;
  suggestions:string[];
  titleContext:string;
};
export function validateAnalysis(word:string,input:unknown):WordAnalysis {
  const a=input as WordAnalysis;
  if(!a || !CATEGORIES.includes(a.category) || !NOUN_TYPES.includes(a.nounType) ||
    typeof a.reason!=='string' || !a.reason.trim() || a.reason.length>500 ||
    !Array.isArray(a.suggestions) || a.suggestions.length>3 || a.suggestions.some(s=>typeof s!=='string'||!s||s.length>200) ||
    typeof a.titleContext!=='string' || a.titleContext.length>300 ||
    (a.category==='noun' && a.nounType==='none') || (a.category!=='noun' && a.nounType!=='none') ||
    (['song','movie','series'].includes(a.nounType) && !a.titleContext.trim())) {
    throw new Error('ผลจัดประเภทคำไม่ครบหรือขัดแย้งกัน กรุณาลองตรวจใหม่');
  }
  return {syllables:validateSyllables(word,a.syllables),category:a.category,nounType:a.nounType,reason:a.reason,suggestions:[...a.suggestions],titleContext:a.titleContext};
}
// The model supplies linguistic facts; the application decides admissibility.
export function nounDecision(a:WordAnalysis):'accept'|'reject'|'review' {
  if(a.category==='uncertain')return 'review';
  return a.category==='noun' ? 'accept':'reject';
}
