import {Player} from '@/features/practice/components';export default async function Page({params}:{params:Promise<{paperId:string}>}){const {paperId}=await params;return <Player paperId={paperId}/>;}
