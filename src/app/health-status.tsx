"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; orgs: number; projects: number; units: number; slots: number };

const LABELS: Record<Exclude<keyof Health, "ok" | "orgs">, string> = {
  projects: "Projects",
  units: "Units",
  slots: "Viewing slots",
};

export function HealthStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <p className="text-bad">Couldn&apos;t read the local database ({error}).</p>;
  if (!health) return <p className="text-muted">Reading the local database…</p>;

  return (
    <dl className="flex flex-wrap gap-x-12 gap-y-4">
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
        <div key={key}>
          <dt className="text-[14px] text-muted">{LABELS[key]}</dt>
          <dd className="text-[2rem] font-semibold leading-tight tabular-nums">{health[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
