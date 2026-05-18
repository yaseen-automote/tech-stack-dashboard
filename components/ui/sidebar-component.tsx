"use client";

import { useState } from "react";
import { BellDot, Cpu, Globe, Network, Radar, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "subdomain" | "cname" | "reverse-dns" | "tech-stack" | "ct-monitor";

type LookupWorkspaceSidebarProps = {
  className?: string;
  activeTab?: TabId;
  onTabChange?: (tab: TabId) => void;
};

const navItems: { id: TabId; label: string; icon: typeof Radar }[] = [
  { id: "subdomain", label: "Domain & Subdomain Discovery", icon: Radar },
  { id: "cname", label: "CNAME Lookup", icon: Globe },
  { id: "reverse-dns", label: "Reverse DNS", icon: Network },
  { id: "tech-stack", label: "Tech Stack", icon: Cpu },
  { id: "ct-monitor", label: "CT Monitor", icon: BellDot },
];

export function LookupWorkspaceSidebar({
  className,
  activeTab = "subdomain",
  onTabChange,
}: LookupWorkspaceSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = navItems.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <aside
      className={cn(
        "flex w-60 shrink-0 flex-col border-r border-white/[0.08] bg-black",
        className,
      )}
      data-testid="lookup-sidebar"
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[0.08] px-5">
        <div className="flex size-6 items-center justify-center rounded-md bg-white/[0.05] border border-white/[0.1] text-white shadow-sm">
          <Radar className="size-3.5" aria-hidden="true" />
        </div>
        <span className="text-[14px] font-medium tracking-tight text-white">
          Automote
        </span>
      </div>

      <div className="px-4 pb-2 pt-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-2 size-3.5 text-neutral-500"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Filter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full rounded-md border border-white/[0.08] bg-transparent pl-9 pr-3 text-[13px] text-neutral-200 outline-none transition-colors placeholder:text-neutral-500 focus:border-white/[0.2] focus:bg-white/[0.02]"
          />
        </div>
      </div>

      <div className="px-5 pb-2 pt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500">
          Lookups
        </p>
      </div>

      <nav aria-label="Workspace sections" className="flex flex-col gap-0.5 px-3 pb-4">
        {filteredItems.length > 0 ? (
          filteredItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange?.(id)}
              aria-current={activeTab === id ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-all duration-200",
                activeTab === id
                  ? "bg-white/[0.08] font-medium text-white"
                  : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {label}
            </button>
          ))
        ) : (
          <div className="px-2.5 py-4 text-center">
            <p className="text-[12px] text-neutral-500">No results found</p>
          </div>
        )}
      </nav>
    </aside>
  );
}

export function Frame760() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <LookupWorkspaceSidebar className="h-full" />
    </div>
  );
}

export default Frame760;
