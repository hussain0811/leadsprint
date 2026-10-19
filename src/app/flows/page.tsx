import { ComingInStep, Page } from "@/components/page";

export default function FlowsPage() {
  return (
    <Page title="Flows" arabic="مسارات المحادثة" intro="The questions the bot asks when no AI model is connected.">
      <ComingInStep
        step={8}
        what="the scripted flow"
        points={[
          "Ready-made English and Arabic flows with buttons and lists",
          "Edit questions, options and scoring rules",
        ]}
      />
    </Page>
  );
}
