import { Page } from "@/components/page";
import { ChatClient } from "./chat-client";

export default function ChatTesterPage() {
  return (
    <Page
      title="Chat tester"
      arabic="تجربة المحادثة"
      intro="Chat with your bot the way a lead would on WhatsApp, and see who answered each message and why. The phone is a simulation that follows WhatsApp's rules."
    >
      <ChatClient />
    </Page>
  );
}
