import { ComingInStep, Page } from "@/components/page";

export default function SettingsPage() {
  return (
    <Page title="Settings" arabic="الإعدادات" intro="Limits that keep the AI on topic and protect your AI key.">
      <ComingInStep
        step={8}
        what="settings"
        points={[
          "Message length and rate limits",
          "Strikes before the AI stops for a lead",
          "Token budgets per lead and per month",
        ]}
      />
    </Page>
  );
}
