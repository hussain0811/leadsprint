"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

function Board({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
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
              const active = pathname !== null && isActive(pathname, item.href);
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

// Reads the current path. Rendered inside <Suspense> in the layout, with SidebarFallback shown meanwhile.
export function Sidebar() {
  return <SidebarView pathname={usePathname()} />;
}

// The same board with nothing marked as the current page, so it doesn't flash while the path is read.
export function SidebarFallback() {
  return <SidebarView pathname={null} />;
}

function SidebarView({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // When the menu opens, move keyboard focus into it.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) menuRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    // Keep Tab inside the open menu.
    if (event.key !== "Tab") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)") ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 md:block">
        <Board pathname={pathname} />
      </aside>

      {/* Small screens: a top bar that opens the same board. */}
      <div className="sticky top-0 z-20 flex items-center justify-between bg-board px-5 py-3 text-board-ink md:hidden">
        <span className="text-[1.1rem] font-semibold" style={{ fontVariationSettings: '"HEXP" 100' }}>
          LeadSprint
        </span>
        <button
          ref={menuRef}
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
        <div
          id="mobile-board"
          className="fixed inset-0 z-30 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Sections"
          onKeyDown={onKeyDown}
        >
          {/* Tapping outside closes the menu; keyboard users have Escape and the Close button. */}
          <div aria-hidden className="absolute inset-0 bg-black/40" onClick={() => close(false)} />
          <div ref={panelRef} className="relative h-full w-[85%] max-w-80">
            <Board pathname={pathname} onNavigate={() => close(false)} />
            <button
              type="button"
              onClick={() => close(true)}
              className="absolute right-3 top-6 rounded-[4px] px-2.5 py-1 text-[14px] text-board-ink hover:bg-board-hi"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
