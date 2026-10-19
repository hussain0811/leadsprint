import { ComingInStep, Page } from "@/components/page";
import { HealthStatus } from "./health-status";

export default function DashboardPage() {
  return (
    <Page title="Dashboard" arabic="لوحة التحكم" intro="How your leads are doing today. For now it shows what's in the local database.">
      <div className="mt-8">
        <HealthStatus />
      </div>
      <ComingInStep
        step={9}
        what="the dashboard"
        points={[
          "New, hot, warm and cold leads at a glance",
          "Response times and viewings booked",
          "Which connections need attention",
        ]}
      />
    </Page>
  );
}
