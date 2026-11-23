import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabaseServer } from "@/lib/supabase/server";
import { ProjectView } from "@/components/ProjectView";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const { data: project } = await supabaseServer().from("projects").select("id,title,duration_seconds").eq("id", params.id).maybeSingle();
  if (!project) notFound();
  return (
    <div>
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-white"><ArrowLeft className="h-4 w-4" /> Projects</Link>
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">{project.title}</h1>
        <DeleteProjectButton id={project.id} title={project.title} redirectTo="/projects" />
      </div>
      <ProjectView projectId={project.id} />
    </div>
  );
}
