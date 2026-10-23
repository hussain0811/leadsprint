import { Page } from "@/components/page";
import { ProjectsClient } from "./projects-client";

export default function ProjectsPage() {
  return (
    <Page
      title="Projects"
      arabic="المشاريع"
      intro="Your projects, units, prices and viewing slots. The bot quotes these details to leads and books viewings from the free slots."
    >
      <ProjectsClient />
    </Page>
  );
}
