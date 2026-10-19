import { ComingInStep, Page } from "@/components/page";

export default function ChatTesterPage() {
  return (
    <Page title="Chat tester" arabic="تجربة المحادثة" intro="Chat with your bot the way a lead would on WhatsApp.">
      <ComingInStep
        step={8}
        what="the WhatsApp-style chat tester"
        points={[
          "A phone view that follows WhatsApp's rules: buttons, lists and the 24-hour window",
          "The scripted bot without an AI key, and the AI agent with one",
          "A side panel showing what the bot decided and why: answers saved, documents used, topic checks",
        ]}
      />
    </Page>
  );
}
