import { HealthStatus } from "./health-status";

// Placeholder home page for the scaffold step; the dashboard replaces it later.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <p className="text-sm font-medium text-zinc-500">CyphronTech · local build</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">LeadSprint</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Scaffold is running. The chat tester, knowledge base, connections and dashboard come next.
        </p>
      </div>
      <HealthStatus />
    </main>
  );
}
