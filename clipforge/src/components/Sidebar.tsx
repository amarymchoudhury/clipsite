"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clapperboard, FolderOpen, Film, LayoutDashboard, LogOut, Scissors, Settings } from "lucide-react";
import clsx from "clsx";
import { supabaseBrowser } from "@/lib/supabase/client";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/create", label: "Create Clips", icon: Scissors },
  { href: "/projects", label: "My Projects", icon: FolderOpen },
  { href: "/library", label: "Clip Library", icon: Film },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ email }: { email: string }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-border bg-surface p-3 lg:w-60">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2 py-2 text-lg font-semibold">
        <Clapperboard className="h-5 w-5 shrink-0 text-accent-soft" />
        <span className="hidden lg:inline">ClipForge</span>
      </Link>
      <nav className="flex-1 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} title={label}
              className={clsx("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition", active ? "bg-card text-white" : "text-muted hover:bg-card hover:text-white")}>
              <Icon className={clsx("h-4 w-4 shrink-0", active && "text-accent-soft")} />
              <span className="hidden lg:inline">{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border pt-3">
        <p className="mb-2 hidden truncate px-2 text-xs text-muted lg:block">{email}</p>
        <button
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-card hover:text-white"
          onClick={async () => { await supabaseBrowser().auth.signOut(); router.replace("/login"); router.refresh(); }}
          title="Sign out"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
