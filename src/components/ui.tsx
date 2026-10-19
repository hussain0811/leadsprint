import type { ComponentProps, ReactNode } from "react";

export type Tone = "ok" | "warn" | "bad" | "muted";

const BUTTON_STYLES = {
  primary: "bg-marina text-on-marina hover:bg-marina-strong",
  secondary: "border border-line bg-panel text-ink hover:border-marina",
  danger: "text-bad underline-offset-4 hover:underline",
} as const;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof BUTTON_STYLES }) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-[4px] px-4 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

const FIELD = "h-9 w-full rounded-[4px] border border-line bg-panel px-3 text-[14px] text-ink placeholder:text-muted focus:border-marina";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${FIELD} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select className={`${FIELD} ${className}`} {...props} />;
}

export function Field({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[14px] font-medium">
        {label}
      </label>
      {children}
      {help && <div className="text-[13px] leading-snug text-muted">{help}</div>}
    </div>
  );
}

const DOT = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", muted: "bg-muted/50" } as const;

export function StatusMark({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[14px]">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}
