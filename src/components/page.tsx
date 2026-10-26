import type { ReactNode } from "react";

// Every page opens like the lobby sign it's named after: English on the left, Arabic on the right.
export function Page({
  title,
  arabic,
  intro,
  children,
}: {
  title: string;
  arabic: string;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-5 py-8 md:px-10 md:py-10">
      <div className="mx-auto max-w-[60rem]">
        <header className="flex items-end justify-between gap-6 border-b border-line pb-6">
          <div className="min-w-0">
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
            {intro && <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-muted">{intro}</p>}
          </div>
          <p lang="ar" dir="rtl" className="hidden shrink-0 text-[1.6rem] font-light leading-tight text-brass sm:block">
            {arabic}
          </p>
        </header>
        {children}
      </div>
    </div>
  );
}
