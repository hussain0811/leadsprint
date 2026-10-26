import Link from "next/link";
import { Suspense } from "react";
import { Page } from "@/components/page";
import { LeadDetailRoute } from "./lead-detail-client";

export default function LeadPage() {
  return (
    <Page title="Lead" arabic="العميل" intro="Everything the bot learned from this person, and what's booked.">
      <p className="mt-5 text-[14px]">
        <Link href="/leads" className="text-marina underline underline-offset-2">
          Back to all leads
        </Link>
      </p>
      {/* The lead id is read in the browser (useParams), so the page shell never waits on the server for it. */}
      <Suspense fallback={<p className="mt-8 text-muted">Loading this lead…</p>}>
        <LeadDetailRoute />
      </Suspense>
    </Page>
  );
}
