import { ComingInStep, Page } from "@/components/page";

export default function InboxPage() {
  return (
    <Page title="Inbox" arabic="صندوق الوارد" intro="Every conversation in one place.">
      <ComingInStep
        step={9}
        what="the inbox"
        points={["All conversations, newest first", "Take over a chat and reply in person; the bot pauses for that lead"]}
      />
    </Page>
  );
}
