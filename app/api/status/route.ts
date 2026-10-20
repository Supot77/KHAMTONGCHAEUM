import { languageProvider } from '@/lib/storage';
import { json } from '@/lib/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){const p=languageProvider();return json({configured:p.configured,model:p.model,storage:process.env.DATABASE_URL||process.env.POSTGRES_URL?'neon':process.env.VERCEL?'missing':'local-sqlite'});}
