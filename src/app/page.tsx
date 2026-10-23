import { Page } from "@/components/page";
import { DashboardClient } from "./dashboard/dashboard-client";

export default function DashboardPage() {
  return (
    <Page
      title="Dashboard"
      arabic="لوحة التحكم"
      intro="How fast your leads hear back, how many qualify and book a viewing, and what's left to set up."
    >
      <DashboardClient />
    </Page>
  );
}
