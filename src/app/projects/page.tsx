import { ComingInStep, Page } from "@/components/page";

export default function ProjectsPage() {
  return (
    <Page title="Projects" arabic="المشاريع" intro="Your projects, units, prices and viewing slots.">
      <ComingInStep
        step={9}
        what="projects and units"
        points={[
          "Project details the bot can quote: community, handover, payment plan, permit number",
          "Units and prices, imported from Excel or CSV",
          "Viewing slots leads can book",
        ]}
      />
    </Page>
  );
}
