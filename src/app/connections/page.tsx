import { Page } from "@/components/page";
import { ConnectionsClient } from "./connections-client";

export default function ConnectionsPage() {
  return (
    <Page
      title="Connections"
      arabic="الربط"
      intro="Connect your own accounts. LeadSprint never pays for or resells AI or messaging: each service bills you directly."
    >
      <ConnectionsClient />
    </Page>
  );
}
