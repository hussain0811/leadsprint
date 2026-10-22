import { cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";

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
  // The help text describes the control: link them so screen readers read it with the field.
  const helpId = `${htmlFor}-help`;
  const control =
    help && isValidElement<{ "aria-describedby"?: string }>(children)
      ? cloneElement(children, {
          "aria-describedby": [children.props["aria-describedby"], helpId].filter(Boolean).join(" "),
        })
      : children;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[14px] font-medium">
        {label}
      </label>
      {control}
      {help && (
        <div id={helpId} className="text-[13px] leading-snug text-muted">
          {help}
        </div>
      )}
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

const TEXTAREA =
  "block w-full resize-y rounded-[4px] border border-line bg-panel px-3 py-2 text-[14px] leading-relaxed text-ink placeholder:text-muted focus:border-marina";

export function Textarea({ className = "", rows = 4, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={`${TEXTAREA} ${className}`} {...props} />;
}

const TEXT_BUTTON_TONES = { marina: "text-marina", bad: "text-bad" } as const;

// A quiet action that reads like a link, for rows that carry several actions.
export function TextButton({
  tone = "marina",
  className = "",
  ...props
}: ComponentProps<"button"> & { tone?: keyof typeof TEXT_BUTTON_TONES }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-[2px] text-[14px] font-medium underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50 ${TEXT_BUTTON_TONES[tone]} ${className}`}
      {...props}
    />
  );
}
