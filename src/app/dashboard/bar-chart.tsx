import { useId } from "react";
import type { Bucket } from "@/lib/dashboard/types";

// A plain bar chart for leads per hour or day: bars only, labels in HTML so they never scale with the SVG.
// The table under it is the text alternative and is open to everyone, not just screen readers.
export function BarChart({ buckets, unit, caption }: { buckets: Bucket[]; unit: "hour" | "day"; caption: string }) {
  const uid = useId();
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const busiest = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]);
  const width = buckets.length * 10;
  const height = 100;
  const gap = buckets.length > 20 ? 2 : 3;
  const summary = `${caption}: ${total} in total, most on ${busiest.label} with ${busiest.count}.`;

  return (
    <figure className="grid gap-2">
      <figcaption className="flex items-baseline justify-between gap-4 text-[13px] text-muted">
        <span>{caption}</span>
        <span aria-hidden>
          Most in one {unit}: {max}
        </span>
      </figcaption>
      <svg
        role="img"
        aria-labelledby={`${uid}-title`}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-28 w-full"
      >
        <title id={`${uid}-title`}>{summary}</title>
        {buckets.map((b, i) => {
          const h = b.count === 0 ? 0 : Math.max(2, (b.count / max) * (height - 2));
          return (
            <rect key={b.start} x={i * 10 + gap / 2} y={height - h} width={10 - gap} height={h} className="fill-marina">
              <title>{`${b.label}: ${b.count}`}</title>
            </rect>
          );
        })}
        <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div aria-hidden className="flex justify-between gap-4 text-[12px] text-muted tabular-nums">
        <span>{buckets[0].label}</span>
        <span>{buckets[buckets.length - 1].label}</span>
      </div>
      <details className="text-[13px]">
        <summary className="w-fit cursor-pointer text-marina underline-offset-4 hover:underline">Show as a table</summary>
        <table className="mt-2 w-full max-w-sm text-left text-[13px] tabular-nums">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">
                {unit === "hour" ? "Hour" : "Day"}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                New leads
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line">
            {buckets.map((b) => (
              <tr key={b.start}>
                <td className="py-1">{b.label}</td>
                <td className="py-1 text-right">{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
