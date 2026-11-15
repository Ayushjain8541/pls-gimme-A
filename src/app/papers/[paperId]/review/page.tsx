import { Review } from "@/features/review/components";
export default async function Page({
  params,
}: {
  params: Promise<{ paperId: string }>;
}) {
  const { paperId } = await params;
  return <Review paperId={paperId} />;
}
