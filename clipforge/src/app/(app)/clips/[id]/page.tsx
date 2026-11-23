import { ClipEditor } from "@/components/ClipEditor";

export const dynamic = "force-dynamic";

export default function ClipPage({ params }: { params: { id: string } }) {
  return <ClipEditor clipId={params.id} />;
}
