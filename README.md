# คำต้องเชื่อม

เกมต่อคำนามสำหรับเพื่อน 2–8 คน เล่นเครื่องเดียวหรือเข้าห้องออนไลน์ได้ ใช้ Next.js บน Vercel และ Lakebase Postgres ผ่าน Neon

## กติกา

โมเดลเลือกคำตั้งต้นจากชุดคำนามพยางค์เดียว จากนั้นผู้เล่นผลัดกันส่งคำนามที่เชื่อมกับคำก่อนหน้า เรื่องคำนามและความเชื่อมโยงให้คนในวงตัดสินทั้งหมด

โมเดลแบ่งพยางค์ตามการอ่านไทยโดยคงรูปเขียนเดิม แล้วโค้ดเทียบพยางค์กับ **คำก่อนหน้าเท่านั้น** เช่น ปลา → ปลาดาว ซ้ำที่ “ปลา” ส่วน จันทร์ กับ จันทน์ เสียงเหมือนแต่เขียนต่างกันจึงใช้ได้

ส่งคำแล้วเปลี่ยนตาทันที นาฬิกาไม่หยุดรอผลตรวจ คะแนนที่มี ? เป็นคะแนนรอตรวจ หากพบคำผิดย้อนหลัง ระบบระบุชื่อคนส่ง คำก่อนหน้า และพยางค์ที่ซ้ำ จากนั้นย้อนสายคำ ยกเลิกคะแนนตั้งแต่คำผิด คืนตาให้คนส่งคำผิด และแสดงคำต่อท้ายที่ใช้ใหม่ได้

เจ้าของห้องแตะคำในประวัติเพื่อรับรองหรือยกเลิกคำได้ หากไม่เห็นด้วยกับผลตรวจ ให้รับรองคำที่ถูกยกเลิกก่อนมีคนส่งคำใหม่ การทบทวนคืนเฉพาะคำที่โต้แย้ง ส่วนคำต่อท้ายยังอยู่ในรายการรีเซ็ต

ตั้งเวลาได้ 15/30/45/60 วินาทีหรือปิดเวลา ค่าเริ่มต้น 30 วินาที หมดเวลาให้ข้ามตา คำที่ผ่านได้ 1 คะแนน เจ้าของห้องกดจบรอบได้ หากยังมีคำรอตรวจ ผลคะแนนยังเปลี่ยนได้

## รันในเครื่อง

ใช้ Node.js 24 โปรเจกต์อยู่ที่ `D:\KHAMTONGCHAEUM`

```powershell
Set-Location D:\KHAMTONGCHAEUM
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

คัดลอก `.env.example` เฉพาะครั้งแรก หากมี `.env.local` แล้วให้แก้ไฟล์เดิม เปิด `http://localhost:5173/`

ตัวแปรที่ใช้:

| ตัวแปร | หน้าที่ |
|---|---|
| `GEMINI_API_KEY` | คีย์จาก Google AI Studio เก็บที่เซิร์ฟเวอร์เท่านั้น |
| `GEMINI_MODEL` | ค่าเริ่มต้น `gemini-3.5-flash-lite` |
| `DATABASE_URL` | Neon pooled connection สำหรับคำขอของแอป |
| `DATABASE_URL_UNPOOLED` | Direct connection สำหรับตั้ง schema |

ถ้ายังไม่มี `DATABASE_URL` การรันบนคอมใช้ SQLite ถาวรใน `.data/game.sqlite` เพื่อพัฒนาได้ บน Vercel ต้องมี `DATABASE_URL` ระบบจะไม่ใช้ไฟล์หรือหน่วยความจำแทนฐานข้อมูลจริง

ไฟล์ `.env.local`, `.dev.vars`, `.neon` และ `.data/` ถูก ignore ไม่ให้ขึ้น GitHub ไฟล์ `.dev.vars` จากต้นแบบเดิมไม่ใช่ค่าที่ Next.js อ่าน ให้ใช้ `.env.local`

## ตั้งค่า Neon

Project ที่ผู้ใช้ระบุ: `lingering-hat-67473382` ใน org `org-calm-resonance-38081632` ใช้ branch `production` และบริการ Postgres เท่านั้น

```powershell
npm.cmd i -g neon@latest
neon login
neon init -y --agent codex --org-id org-calm-resonance-38081632 --project-id lingering-hat-67473382 --branch production --services postgres
neon config plan
neon deploy
npm.cmd run db:setup
```

`neon init` ติดตั้ง Neon plugin สำหรับ Codex พร้อม MCP/skills และสร้าง `neon.ts` คำสั่งแบบ `-y` อาจเขียน `.neon` แบบ offline ได้ จึงต้องตรวจว่า CLI ล็อกอินและยืนยัน project แล้วก่อนนับว่าตั้งค่าสำเร็จ หากลง CLI แบบ global ไม่สำเร็จ ให้ใช้ `npx.cmd neon@latest` แทน `neon`

`neon deploy` ตั้งบริการตาม `neon.ts` และดึงตัวแปรของ branch มาใส่ `.env.local` หรือ `.env` ที่มีอยู่แล้ว ค่าของ Gemini ต้องอยู่ต่อในไฟล์นั้น แอปไม่ใช้ Neon AI Gateway และไม่ย้ายระบบผู้เล่นไป Neon Auth

ไฟล์ `database/schema.sql` เก็บ schema ที่ตรวจสอบและใช้ซ้ำได้ `npm run db:setup` ใช้ direct connection เพื่อสร้างตาราง `rooms` กับ `syllable_cache` ภายใน transaction ตารางเดิมและข้อมูลเดิมจะไม่ถูกล้าง

ตัวเชื่อมฐานข้อมูลใช้ `pg` pool ร่วมกันในแต่ละ instance และ `attachDatabasePool` ของ Vercel ตาม Neon skill ใช้ parameterized SQL และ compare-and-swap เพื่อป้องกันคำสั่งชนกัน การส่งคำแยกจากการตรวจของโมเดล

## Deploy บน Vercel

1. Import [Supot77/KHAMTONGCHAEUM](https://github.com/Supot77/KHAMTONGCHAEUM) เลือก Framework **Next.js**, Root Directory เป็นราก repository และ Node.js **24.x**
2. ตั้ง `GEMINI_API_KEY`, `GEMINI_MODEL` และ `DATABASE_URL` ใน Environment Variables ของ Vercel โดยไม่ใช้คำนำหน้า `NEXT_PUBLIC_` หากใช้ Marketplace ให้เชื่อม **Neon project เดิม** ไม่สร้างอีก project โดยไม่จำเป็น
3. ให้ schema จากขั้นตอน Neon พร้อมก่อนเริ่มเล่น แล้ว Deploy คำสั่ง build คือ `npm run build` ไม่ตั้ง Output Directory เป็น `dist`
4. ทดสอบสร้างห้องและเข้าห้องจากสองอุปกรณ์ที่เปิด URL เดียวกัน

`neon deploy` ตั้ง backend ของ Neon ส่วนการเผยแพร่ frontend ทำผ่าน Vercel ตัวแปรใน `.env.local` ไม่ถูกส่งไป Vercel อัตโนมัติเพียงเพราะ push โค้ดขึ้น GitHub

## ทดสอบ

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```

ชุดทดสอบปกติไม่เรียก Gemini API ส่วนการทดสอบจริงต้องเปิดแอปก่อนแล้วสั่ง:

```powershell
node scripts/smoke-live.mjs --allow-live
```

คำสั่งนี้ใช้โควตาคีย์เพื่อให้โมเดลตั้งคำแรกหนึ่งครั้งและตรวจพยางค์หนึ่งชุด โดยทดสอบว่าระหว่างรอผลส่งคำต่อได้ ย้อนคำพร้อมคะแนนได้ และนำคำที่รีเซ็ตกลับมาใช้ได้ หากตั้ง `DATABASE_URL` แล้ว การทดสอบนี้จะผ่าน Neon จริง ผลที่ยืนยันแล้วอยู่ใน `docs/VERIFICATION.md`

## ข้อจำกัดที่ควรรู้

Gemini อาจแบ่งพยางค์ผิดได้ แม้ผลลัพธ์จะคงรูปเขียนครบ ผู้เล่นจึงทบทวนคำตัดสินได้ หากโควตาหมดหรือเรียกโมเดลไม่สำเร็จ คำจะยังรอตรวจ ไม่มีการย้ายไปโมเดลเสียเงินอัตโนมัติ โควตาและ Billing ขึ้นกับบัญชี Google ของเจ้าของคีย์

เซสชันผู้เล่นอยู่ใน sessionStorage ของแต่ละแท็บ รีเฟรชแท็บเดิมกลับเข้าห้องได้ แต่ถ้ากดกลับหน้าแรก เซสชันนั้นจะถูกล้าง หนึ่งรอบรองรับสายคำที่ยังใช้งานสูงสุด 1,000 คำ

## ไฟล์หลัก

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/game.ts` | กติกา ลำดับตา คะแนน และย้อนสายคำ |
| `lib/rooms.ts` | สิทธิ์ผู้เล่น คำสั่งซ้ำ และงานตรวจย้อนหลัง |
| `lib/gemini.ts` | คำเปิดเกมและการแบ่งพยางค์ |
| `lib/sql-store.ts`, `lib/storage.ts` | SQL adapter และ Neon/Vercel pool |
| `lib/storage-local.ts` | SQLite สำหรับพัฒนาในเครื่อง |
| `database/schema.sql`, `scripts/setup-db.mjs` | Schema และคำสั่งตั้งฐานข้อมูล |
| `app/components/` | เลือกโหมด ห้องรอ เกม คะแนน และรายการรีเซ็ต |
| `neon.ts`, `vercel.json` | การตั้งค่า backend และ host |

เอกสารต้นทาง: [Neon skill](https://neon.com/.well-known/agent-skills/neon/SKILL.md), [Neon Postgres skill](https://neon.com/.well-known/agent-skills/neon-postgres/SKILL.md), [Vercel pool management](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#attachdatabasepool), [Gemini Free Tier](https://ai.google.dev/gemini-api/docs/pricing)
