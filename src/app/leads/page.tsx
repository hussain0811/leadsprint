import { Suspense } from "react";
import { Page } from "@/components/page";
import { LeadsClient } from "./leads-client";

export default function LeadsPage() {
  return (
    <Page title="Leads" arabic="العملاء المحتملون" intro="People who contacted you, and how ready they are to buy or rent.">
      {/* The filters live in the URL, which is only known in the browser. */}
      <Suspense fallback={<p className="mt-8 text-muted">Loading your leads…</p>}>
        <LeadsClient />
      </Suspense>
    </Page>
  );
}
