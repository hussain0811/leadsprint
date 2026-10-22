import { Page } from "@/components/page";
import { SettingsClient } from "./settings-client";

export default function SettingsPage() {
  return (
    <Page title="Settings" arabic="الإعدادات" intro="Limits that keep the AI on topic and protect your AI key from being drained.">
      <SettingsClient />
    </Page>
  );
}
