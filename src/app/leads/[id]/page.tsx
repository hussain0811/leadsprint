import Link from "next/link";
import { Suspense } from "react";
import { Page } from "@/components/page";
import { LeadDetailClient } from "./lead-detail-client";

async function LeadDetailForParams({ params }: { params: PageProps<"/leads/[id]">["params"] }) {
  const { id } = await params;
  return <LeadDetailClient id={id} />;
}

export default function LeadPage({ params }: PageProps<"/leads/[id]">) {
  return (
    <Page title="Lead" arabic="العميل" intro="Everything the bot learned from this person, and what's booked.">
      <p className="mt-5 text-[14px]">
        <Link href="/leads" className="text-marina underline underline-offset-2">
          Back to all leads
        </Link>
      </p>
      <Suspense fallback={<p className="mt-8 text-muted">Loading this lead…</p>}>
        <LeadDetailForParams params={params} />
      </Suspense>
    </Page>
  );
}
