import { useId, useRef, useState, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import { Button, Section, TextButton } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import {
  IMPORT_FIELD_LABEL,
  UNIT_STATUS_LABEL,
  UNIT_TYPE_LABEL,
  type ImportField,
  type ImportPreview,
  type ImportResult,
  type ImportRow,
} from "@/lib/projects/types";
import { bedroomsText, count, errorText, formatNumber, listJoin, NoticeLine, projectPath, restoreFocus, type Notice } from "./shared";

// Long files show this many rows of each list; the import itself takes them all.
const SHOWN = 50;
const LINK = "text-marina underline underline-offset-2";

function fieldValue(row: ImportRow, field: ImportField): string {
  const value = row[field];
  if (value === undefined || value === null) return "–";
  switch (field) {
    case "type":
      return UNIT_TYPE_LABEL[row.type!];
    case "bedrooms":
      return bedroomsText(row.bedrooms!);
    case "status":
      return UNIT_STATUS_LABEL[row.status!];
    case "price":
    case "sizeSqft":
      return formatNumber(value as number);
    default:
      return String(value);
  }
}

export function ImportUnits({ projectId, onImported }: { projectId: string; onImported: () => void }) {
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"read" | "import" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy("read");
    setPreview(null);
    setNotice(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await apiFetch<{ preview: ImportPreview }>(projectPath(projectId, "/units/preview"), { method: "POST", body: form });
      flushSync(() => {
        setPreview(res.preview);
        setBusy(null);
      });
      summaryRef.current?.focus();
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(fileInput.current);
    } finally {
      // Choosing the same file again (after fixing it) should read it again.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function apply() {
    if (!preview || busy) return;
    setBusy("import");
    setNotice(null);
    try {
      const res = await apiFetch<ImportResult>(projectPath(projectId, "/units/import"), {
        method: "POST",
        json: { rows: preview.rows },
      });
      const done = [res.added && `added ${count(res.added, "unit")}`, res.updated && `updated ${count(res.updated, "unit")}`].filter(
        (x): x is string => Boolean(x),
      );
      const text = done.length ? `Imported: ${listJoin(done)}.` : "Nothing needed changing.";
      const skipped = res.errors.length ? ` ${count(res.errors.length, "unit")} couldn't be added: ${res.errors.map((e) => e.message).join(" ")}` : "";
      flushSync(() => {
        setPreview(null);
        setBusy(null);
        setNotice({ tone: res.errors.length ? "warn" : "ok", text: text + skipped });
      });
      fileInput.current?.focus();
      onImported();
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(importButton.current);
    }
  }

  function cancel() {
    flushSync(() => setPreview(null));
    fileInput.current?.focus();
  }

  const changing = preview ? preview.add.length + preview.update.length : 0;
  const missingColumns = preview
    ? (["type", "bedrooms", "price"] as const).filter((f) => !preview.columns.some((c) => c.field === f))
    : [];

  return (
    <Section
      title="Import units"
      intro={
        <>
          Add or update many units at once from your price list. Units are matched on their unit number: new numbers are added,
          known ones are updated. Blank cells leave a unit&apos;s current value as it is.
        </>
      }
      aside={
        <a href="/api/projects/units-template" download className={`text-[14px] font-medium ${LINK}`}>
          Download the template (CSV)
        </a>
      }
    >
      <div className="grid gap-1.5">
        <label htmlFor={`${uid}-file`} className="text-[14px] font-medium">
          Price list
        </label>
        <input
          ref={fileInput}
          id={`${uid}-file`}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={choose}
          disabled={busy !== null}
          aria-describedby={`${uid}-file-help`}
          className="block w-full max-w-md text-[14px] file:mr-3 file:h-9 file:cursor-pointer file:rounded-[4px] file:border file:border-line file:bg-panel file:px-4 file:text-[14px] file:font-medium file:text-ink hover:file:border-marina"
        />
        <p id={`${uid}-file-help`} className="text-[13px] leading-snug text-muted">
          A CSV or Excel (.xlsx) file up to 5 MB. Columns are found by their headings: unit, type, beds or bedrooms, size or sq ft,
          price, status, floor and view. You&apos;ll see what changes before anything is saved.
        </p>
      </div>
      <NoticeLine notice={busy === "read" ? { tone: "muted", text: "Reading the file…" } : notice} className="mt-3" />

      {preview && (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-5 border-t border-line pt-5">
          <div className="grid gap-2">
            <p ref={summaryRef} tabIndex={-1} className="text-[15px] font-medium leading-relaxed">
              <bdi>{preview.fileName}</bdi>
              {preview.sheet && (
                <>
                  , sheet “<bdi>{preview.sheet}</bdi>”
                </>
              )}
              : {count(preview.add.length, "new unit")}, {count(preview.update.length, "changed unit")}, {formatNumber(preview.unchanged)}{" "}
              unchanged
              {preview.errors.length > 0 && <>, {count(preview.errors.length, "row")} with problems</>}.
            </p>
            <p className="text-[13px] leading-relaxed text-muted">
              Columns used:{" "}
              {preview.columns.map((c, i) => (
                <span key={c.field}>
                  {i > 0 && ", "}
                  {IMPORT_FIELD_LABEL[c.field]} (“<bdi>{c.header}</bdi>”)
                </span>
              ))}
              .
              {preview.ignoredHeaders.length > 0 && (
                <>
                  {" "}
                  Not used:{" "}
                  {preview.ignoredHeaders.map((h, i) => (
                    <span key={`${h}-${i}`}>
                      {i > 0 && ", "}“<bdi>{h}</bdi>”
                    </span>
                  ))}
                  .
                </>
              )}
              {missingColumns.length > 0 &&
                ` There's no ${listJoin(missingColumns.map((f) => IMPORT_FIELD_LABEL[f].replace(/ \(.*\)$/, "").toLowerCase()))} column, so only units already in the list can be updated.`}
            </p>
          </div>

          {preview.errors.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold text-bad">Rows that won&apos;t be imported</h3>
              <ul className="mt-2 grid gap-1 text-[14px] leading-relaxed">
                {preview.errors.slice(0, SHOWN).map((e) => (
                  <li key={e.row} dir="auto">
                    <span className="font-medium">Row {e.row}:</span> {e.message}
                  </li>
                ))}
              </ul>
              {preview.errors.length > SHOWN && (
                <p className="mt-1 text-[13px] text-muted">And {count(preview.errors.length - SHOWN, "more row")}.</p>
              )}
            </div>
          )}

          {preview.add.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold">New units</h3>
              <div className="relative mt-2 overflow-x-auto border-y border-line">
                <table className="w-full min-w-[40rem] border-collapse text-left text-[13px]">
                  <caption className="sr-only">Units that will be added</caption>
                  <thead>
                    <tr className="border-b border-line text-muted">
                      {(["unitNo", "type", "bedrooms", "sizeSqft", "price", "status", "floor", "view"] as const).map((f) => (
                        <th key={f} scope="col" className="py-2 pr-3 font-medium">
                          {IMPORT_FIELD_LABEL[f]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.add.slice(0, SHOWN).map((row) => (
                      <tr key={row.unitNo}>
                        <th scope="row" className="py-2 pr-3 font-medium">
                          <bdi>{row.unitNo}</bdi>
                        </th>
                        {(["type", "bedrooms", "sizeSqft", "price", "status", "floor", "view"] as const).map((f) => (
                          <td key={f} className="py-2 pr-3" dir={f === "view" || f === "floor" ? "auto" : undefined}>
                            {f === "status" && row.status === undefined ? "Available" : fieldValue(row, f)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.add.length > SHOWN && (
                <p className="mt-1 text-[13px] text-muted">And {count(preview.add.length - SHOWN, "more unit")}.</p>
              )}
            </div>
          )}

          {preview.update.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold">Changes to existing units</h3>
              <ul className="mt-2 divide-y divide-line border-y border-line text-[14px]">
                {preview.update.slice(0, SHOWN).map(({ row, changes }) => (
                  <li key={row.unitNo} className="py-2 leading-relaxed">
                    <span className="font-medium">
                      <bdi>{row.unitNo}</bdi>
                    </span>
                    {": "}
                    {changes.map((f, i) => (
                      <span key={f}>
                        {i > 0 && "; "}
                        {IMPORT_FIELD_LABEL[f]} <bdi>{fieldValue(row, f)}</bdi>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
              {preview.update.length > SHOWN && (
                <p className="mt-1 text-[13px] text-muted">And {count(preview.update.length - SHOWN, "more unit")}.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button ref={importButton} onClick={apply} disabled={busy !== null || changing === 0}>
              {busy === "import" ? "Importing…" : changing === 0 ? "Nothing to import" : `Import ${count(changing, "unit")}`}
            </Button>
            <TextButton onClick={cancel} disabled={busy !== null}>
              Cancel
            </TextButton>
          </div>
        </div>
      )}
    </Section>
  );
}
