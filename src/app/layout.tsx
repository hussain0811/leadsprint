import type { Metadata } from "next";
import { Readex_Pro } from "next/font/google";
import { Suspense } from "react";
import { Sidebar, SidebarFallback } from "@/components/sidebar";
import "./globals.css";

// One family for English and Arabic, so bilingual screens read as one voice.
const readex = Readex_Pro({
  variable: "--font-readex",
  subsets: ["latin", "arabic"],
  axes: ["HEXP"],
});

export const metadata: Metadata = {
  title: "LeadSprint (local)",
  description: "AI lead-qualifying agent: local test build",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${readex.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[4px] focus:bg-panel focus:px-4 focus:py-2 focus:text-[14px] focus:font-medium focus:text-ink focus:shadow"
        >
          Skip to content
        </a>
        <div className="min-h-screen md:flex">
          {/* The sidebar reads the current path, which needs a Suspense boundary; the fallback is the same board. */}
          <Suspense fallback={<SidebarFallback />}>
            <Sidebar />
          </Suspense>
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
