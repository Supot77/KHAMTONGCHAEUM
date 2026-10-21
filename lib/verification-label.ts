import type { Word } from './game';
export function verificationLabel(word:Word|undefined):string{
  if(!word)return 'รอตรวจ';
  if(word.manual)return 'ผู้เล่นรับรอง';
  const status=word.verification?.status;
  if(status==='duplicate')return word.verification?.duplicateKind==='word'?'พบคำเต็มซ้ำ':'พบพยางค์ซ้ำ';
  if(status==='not_noun')return 'ไม่ใช่คำนาม';
  if(status==='waiting_previous')return 'ได้ผลแล้ว · รอข้อมูลคำก่อนหน้า';
  if(status==='review'||word.check==='review')return 'ยังไม่แน่ใจ · รอทบทวน';
  if(status==='valid'||word.check==='valid')return 'ตรวจชนิดคำและคำซ้ำแล้ว';
  if(word.languageStatus==='error'||word.check==='error')return 'วิเคราะห์ไม่สำเร็จ · รอลองใหม่';
  if(word.languageStatus==='analyzing')return 'กำลังรอโมเดลวิเคราะห์';
  return 'คำใหม่ · รอวิเคราะห์';
}
