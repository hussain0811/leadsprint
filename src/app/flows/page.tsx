import { Page } from "@/components/page";
import { FlowsClient } from "./flows-client";

export default function FlowsPage() {
  return (
    <Page
      title="Flows"
      arabic="مسارات المحادثة"
      intro="The questions the bot asks, in English and Arabic. It follows this flow when no AI model is connected, when you choose scripted only, and whenever the AI can't be used."
    >
      <FlowsClient />
    </Page>
  );
}
