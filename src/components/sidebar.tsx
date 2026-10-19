"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, CONNECTIONS_CHANGED } from "@/lib/api-client";
import type { ConnectionsResponse } from "@/lib/connections";
import { StatusMark, type Tone } from "./ui";

type NavItem = { href: string; label: string; arabic: string };

// Two floors on the board: everyday work, then setup.
const FLOORS: NavItem[][] = [
  [
    { href: "/", label: "Dashboard", arabic: "لوحة التحكم" },
    { href: "/chat", label: "Chat tester", arabic: "تجربة المحادثة" },
    { href: "/inbox", label: "Inbox", arabic: "صندوق الوارد" },
    { href: "/leads", label: "Leads", arabic: "العملاء المحتملون" },
  ],
  [
    { href: "/knowledge", label: "Knowledge", arabic: "قاعدة المعرفة" },
    { href: "/projects", label: "Projects", arabic: "المشاريع" },
    { href: "/flows", label: "Flows", arabic: "مسارات المحادثة" },
    { href: "/connections", label: "Connections", arabic: "الربط" },
    { href: "/settings", label: "Settings", arabic: "الإعدادات" },
  ],
];

const AI_STATUS: Record<string, [Tone, string]> = {
  ok: ["ok", "Ready"],
  warning: ["warn", "Not ready"],
  error: ["bad", "Not working"],
  untested: ["muted", "Not tested"],
};

const STORAGE_STATUS: Record<string, [Tone, string]> = {
  ok: ["ok", "Ready"],
  error: ["bad", "Not working"],
  untested: ["muted", "Not tested"],
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function useConnectionStatus() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  useEffect(() => {
    const load = () =>
      apiFetch<ConnectionsResponse>("/api/connections")
        .then(setData)
        .catch(() => setData(null));
    load();
    window.addEventListener(CONNECTIONS_CHANGED, load);
    return () => window.removeEventListener(CONNECTIONS_CHANGED, load);
  }, []);
  return data;
}

function Wordmark() {
  return (
    <Link href="/" className="block">
      <span className="block text-[1.35rem] font-semibold leading-none" style={{ fontVariationSettings: '"HEXP" 100' }}>
        LeadSprint
      </span>
      <span className="mt-1.5 block text-[13px] text-board-muted">Local build</span>
    </Link>
  );
}

function Board({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const status = useConnectionStatus();
  const [aiTone, aiText] = status?.ai ? (AI_STATUS[status.ai.status] ?? AI_STATUS.untested) : ["muted" as Tone, "Not connected"];
  const [fileTone, fileText] = status?.storage
    ? (STORAGE_STATUS[status.storage.status] ?? STORAGE_STATUS.untested)
    : ["muted" as Tone, "Not connected"];

  return (
    <div className="flex h-full flex-col bg-board text-board-ink">
      <div className="px-6 pb-6 pt-7">
        <Wordmark />
      </div>

      <nav aria-label="Sections" className="flex-1">
        {FLOORS.map((floor, i) => (
          <ul key={i} className={i > 0 ? "mt-3 border-t border-board-hi pt-3" : ""}>
            {floor.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-baseline justify-between gap-3 px-6 py-2.5 text-[15px] transition-colors hover:bg-board-hi ${
                      active ? "bg-board-hi text-board-brass" : ""
                    }`}
                  >
                    {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] bg-board-brass" />}
                    <span>{item.label}</span>
                    <span lang="ar" dir="rtl" className={`text-[14px] ${active ? "text-board-brass" : "text-board-muted"}`}>
                      {item.arabic}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </nav>

      <Link
        href="/connections"
        onClick={onNavigate}
        className="mx-3 mb-5 mt-6 grid gap-2 rounded-[4px] px-3 py-3 text-[13px] hover:bg-board-hi"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="text-board-muted">AI model</span>
          <StatusMark tone={aiTone}>{aiText}</StatusMark>
        </span>
        <span className="flex items-center justify-between gap-3">
          <span className="text-board-muted">File storage</span>
          <StatusMark tone={fileTone}>{fileText}</StatusMark>
        </span>
      </Link>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 md:block">
        <Board />
      </aside>

      {/* Small screens: a top bar that opens the same board. */}
      <div className="sticky top-0 z-20 flex items-center justify-between bg-board px-5 py-3 text-board-ink md:hidden">
        <span className="text-[1.1rem] font-semibold" style={{ fontVariationSettings: '"HEXP" 100' }}>
          LeadSprint
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-[4px] px-3 py-1.5 text-[14px] hover:bg-board-hi"
          aria-expanded={open}
          aria-controls="mobile-board"
        >
          Menu
        </button>
      </div>
      {open && (
        <div id="mobile-board" className="fixed inset-0 z-30 md:hidden" role="dialog" aria-modal="true" aria-label="Sections">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative h-full w-[85%] max-w-80">
            <Board onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
