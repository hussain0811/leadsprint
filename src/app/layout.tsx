import type { Metadata } from "next";
import { Readex_Pro } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
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
        <div className="min-h-screen md:flex">
          <Sidebar />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
