import type {Metadata} from 'next';import './globals.css';import 'katex/dist/katex.min.css';import {AppShell} from '@/components/AppShell';
export const metadata:Metadata={title:'Gimme A — Your practice space',description:'Your past papers. One question at a time. Immediate explanations and progress that stays with you.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;}
