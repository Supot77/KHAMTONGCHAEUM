import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'คำต้องเชื่อม — ชวนเพื่อนมาต่อคำ',description:'เกมต่อคำนามกับเพื่อน เล่นเครื่องเดียวหรือห้องออนไลน์ ส่งคำแล้วเล่นต่อได้ทันที พร้อมตรวจพยางค์ซ้ำย้อนหลัง',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="th"><body>{children}</body></html>;}
