import { Page } from "@/components/page";
import { KnowledgeClient } from "./knowledge-client";

export default function KnowledgePage() {
  return (
    <Page
      title="Knowledge"
      arabic="قاعدة المعرفة"
      intro="What the AI may say about your projects. It answers only from these documents and your project data, and follows your rules on every reply."
    >
      <KnowledgeClient />
    </Page>
  );
}
