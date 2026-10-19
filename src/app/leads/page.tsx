import { ComingInStep, Page } from "@/components/page";

export default function LeadsPage() {
  return (
    <Page title="Leads" arabic="العملاء المحتملون" intro="People who contacted you, and how ready they are to buy or rent.">
      <ComingInStep
        step={9}
        what="the leads list"
        points={["Each lead's answers, score and the reasons behind it", "Booked viewings and calls"]}
      />
    </Page>
  );
}
