import { ComingInStep, Page } from "@/components/page";

export default function KnowledgePage() {
  return (
    <Page
      title="Knowledge"
      arabic="قاعدة المعرفة"
      intro="What the AI may say about your projects. It answers only from these documents and your project data."
    >
      <ComingInStep
        step={7}
        what="the knowledge base"
        points={[
          "Upload brochures, payment plans and FAQs (PDF, Word, Excel, text)",
          "Add web pages and question-and-answer pairs",
          "Mark rules documents, like terms and conditions, that the AI follows on every reply",
          "Try a question and see which passages the answer came from",
        ]}
      />
    </Page>
  );
}
