"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; orgs: number; projects: number; units: number; slots: number };

export function HealthStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-600">Database check failed: {error}</p>;
  if (!health) return <p className="text-zinc-500">Checking the database…</p>;

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(["orgs", "projects", "units", "slots"] as const).map((key) => (
        <div key={key} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-xs uppercase tracking-wide text-zinc-500">{key}</dt>
          <dd className="text-2xl font-semibold">{health[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
