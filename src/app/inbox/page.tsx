import { Suspense } from "react";
import { Page } from "@/components/page";
import { InboxClient } from "./inbox-client";

export default function InboxPage() {
  return (
    <Page
      title="Inbox"
      arabic="صندوق الوارد"
      intro="Every conversation in one place, newest first. Take over a chat to reply in person; the bot stays quiet for that lead until you hand back."
    >
      <Suspense fallback={<p className="mt-6 text-[14px] text-muted">Loading the inbox…</p>}>
        <InboxClient />
      </Suspense>
    </Page>
  );
}
