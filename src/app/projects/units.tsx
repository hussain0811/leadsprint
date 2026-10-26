import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button, Field, Input, Section, Select, StatusMark, TextButton } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import {
  UNIT_STATUS_LABEL,
  UNIT_STATUSES,
  UNIT_TYPE_LABEL,
  UNIT_TYPES,
  type UnitFields,
  type UnitStatus,
  type UnitType,
  type UnitView,
} from "@/lib/projects/types";
import {
  bedroomsText,
  count,
  errorText,
  formatNumber,
  NoticeLine,
  projectPath,
  readAmount,
  restoreFocus,
  STATUS_TONE,
  type Notice,
} from "./shared";

type Draft = {
  unitNo: string;
  type: UnitType;
  bedrooms: string;
  sizeSqft: string;
  price: string;
  status: UnitStatus;
  floor: string;
  view: string;
};

const EMPTY: Draft = { unitNo: "", type: "apartment", bedrooms: "1", sizeSqft: "", price: "", status: "available", floor: "", view: "" };
const BEDROOM_CHOICES = Array.from({ length: 11 }, (_, i) => i);

function toDraft(u: UnitView): Draft {
  return {
    unitNo: u.unitNo,
    type: u.type,
    bedrooms: String(u.bedrooms),
    sizeSqft: u.sizeSqft === null ? "" : String(u.sizeSqft),
    price: String(u.price),
    status: u.status,
    floor: u.floor ?? "",
    view: u.view ?? "",
  };
}

// Checks what can be checked here; the server checks everything again.
function fromDraft(d: Draft): { unit: UnitFields } | { error: string } {
  if (!d.unitNo.trim()) return { error: "Enter the unit number." };
  const price = readAmount(d.price);
  if (price === null || price <= 0) return { error: "Enter the price in AED, for example 1,450,000." };
  const size = d.sizeSqft.trim() ? readAmount(d.sizeSqft) : null;
  if (d.sizeSqft.trim() && (size === null || size <= 0)) return { error: "Enter the size as a number of square feet, or leave it blank." };
  return {
    unit: {
      unitNo: d.unitNo.trim(),
      type: d.type,
      bedrooms: Number(d.bedrooms),
      sizeSqft: size,
      price,
      status: d.status,
      floor: d.floor.trim() || null,
      view: d.view.trim() || null,
    },
  };
}

function unitPath(projectId: string, unitId: string) {
  return projectPath(projectId, `/units/${encodeURIComponent(unitId)}`);
}

function BedroomOptions({ current }: { current?: number }) {
  const choices = current !== undefined && current > 10 ? [...BEDROOM_CHOICES, current] : BEDROOM_CHOICES;
  return choices.map((n) => (
    <option key={n} value={n}>
      {n === 0 ? "Studio" : n}
    </option>
  ));
}

export function Units({
  projectId,
  units,
  onChange,
}: {
  projectId: string;
  units: UnitView[];
  onChange: (units: UnitView[]) => void;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [listNotice, setListNotice] = useState<Notice>(null);
  const unitNoRef = useRef<HTMLInputElement>(null);
  const listNoticeRef = useRef<HTMLParagraphElement>(null);

  const byStatus = UNIT_STATUSES.map((s) => [s, units.filter((u) => u.status === s).length] as const).filter(([, n]) => n > 0);

  function edit<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const checked = fromDraft(draft);
    if ("error" in checked) {
      setNotice({ tone: "bad", text: checked.error });
      return;
    }
    setSaving(true);
    setNotice(null);
    setListNotice(null);
    try {
      const res = await apiFetch<{ unit: UnitView }>(projectPath(projectId, "/units"), { method: "POST", json: checked.unit });
      onChange(sortUnits([...units, res.unit]));
      // Keep type and bedrooms: units are often added in runs of the same kind.
      setDraft((d) => ({ ...EMPTY, type: d.type, bedrooms: d.bedrooms }));
      setNotice({ tone: "ok", text: `Added unit ${res.unit.unitNo}.` });
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    } finally {
      flushSync(() => setSaving(false));
      restoreFocus(unitNoRef.current);
    }
  }

  function saved(unit: UnitView) {
    onChange(sortUnits(units.map((u) => (u.id === unit.id ? unit : u))));
    setNotice(null); // an earlier "Added unit…" no longer describes the latest change
    setListNotice({ tone: "ok", text: `Saved unit ${unit.unitNo}.` });
  }

  function deleted(unit: UnitView) {
    onChange(units.filter((u) => u.id !== unit.id));
    setNotice(null);
    setListNotice({ tone: "ok", text: `Deleted unit ${unit.unitNo}.` });
    listNoticeRef.current?.focus();
  }

  const id = (name: string) => `${uid}-${name}`;

  return (
    <Section
      title="Units"
      intro="Each unit the bot may offer. It only suggests available ones, and quotes their prices in AED."
      aside={
        units.length > 0 && (
          <div className="grid gap-1 text-[14px]">
            <p>{count(units.length, "unit")}</p>
            {byStatus.map(([status, n]) => (
              <StatusMark key={status} tone={STATUS_TONE[status]}>
                {formatNumber(n)} {UNIT_STATUS_LABEL[status].toLowerCase()}
              </StatusMark>
            ))}
          </div>
        )
      }
    >
      <form onSubmit={add} aria-label="Add a unit" className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Unit number" htmlFor={id("unitNo")}>
            <Input
              ref={unitNoRef}
              id={id("unitNo")}
              dir="auto"
              placeholder="A-0701"
              value={draft.unitNo}
              onChange={(e) => edit("unitNo", e.target.value)}
              required
              maxLength={40}
            />
          </Field>
          <Field label="Type" htmlFor={id("type")}>
            <Select id={id("type")} value={draft.type} onChange={(e) => edit("type", e.target.value as UnitType)}>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {UNIT_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bedrooms" htmlFor={id("bedrooms")}>
            <Select id={id("bedrooms")} value={draft.bedrooms} onChange={(e) => edit("bedrooms", e.target.value)}>
              <BedroomOptions />
            </Select>
          </Field>
          <Field label="Status" htmlFor={id("status")}>
            <Select id={id("status")} value={draft.status} onChange={(e) => edit("status", e.target.value as UnitStatus)}>
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {UNIT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Price (AED)" htmlFor={id("price")}>
            <Input
              id={id("price")}
              inputMode="decimal"
              placeholder="1,450,000"
              value={draft.price}
              onChange={(e) => edit("price", e.target.value)}
              required
            />
          </Field>
          <Field label="Size (sq ft)" htmlFor={id("size")}>
            <Input id={id("size")} inputMode="decimal" value={draft.sizeSqft} onChange={(e) => edit("sizeSqft", e.target.value)} />
          </Field>
          <Field label="Floor" htmlFor={id("floor")}>
            <Input id={id("floor")} dir="auto" value={draft.floor} onChange={(e) => edit("floor", e.target.value)} maxLength={20} />
          </Field>
          <Field label="View" htmlFor={id("view")}>
            <Input
              id={id("view")}
              dir="auto"
              placeholder="Marina"
              value={draft.view}
              onChange={(e) => edit("view", e.target.value)}
              maxLength={100}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={saving || !draft.unitNo.trim() || !draft.price.trim()}>
            {saving ? "Adding…" : "Add unit"}
          </Button>
        </div>
        <NoticeLine notice={notice} />
      </form>

      <NoticeLine ref={listNoticeRef} notice={listNotice} reserve={false} className={listNotice ? "mt-3" : ""} />
      {units.length === 0 ? (
        <p className="mt-5 text-[15px] leading-relaxed text-muted">
          No units yet. Add them one by one above, or import your price list below.
        </p>
      ) : (
        <div className="relative mt-5 overflow-x-auto border-y border-line">
          <table className="w-full min-w-[42rem] border-collapse text-left text-[14px]">
            <caption className="sr-only">Units in this project</caption>
            <thead>
              <tr className="border-b border-line text-[13px] text-muted">
                <th scope="col" className="py-2.5 pr-3 font-medium">Unit</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Type</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Beds</th>
                <th scope="col" className="py-2.5 pr-3 text-right font-medium">Size (sq ft)</th>
                <th scope="col" className="py-2.5 pr-3 text-right font-medium">Price (AED)</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">Floor</th>
                <th scope="col" className="py-2.5 pr-3 font-medium">View</th>
                <th scope="col" className={`py-2.5 font-medium ${ACTIONS}`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {units.map((unit) => (
                <UnitRow key={unit.id} projectId={projectId} unit={unit} onSaved={saved} onDeleted={deleted} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function sortUnits(units: UnitView[]) {
  return [...units].sort((a, b) => a.unitNo.localeCompare(b.unitNo, "en", { numeric: true, sensitivity: "base" }));
}

const CELL = "py-2.5 pr-3 align-top";
// Edit and Delete stay in view while the rest of a wide table scrolls sideways.
const ACTIONS = "sticky right-0 bg-glass pr-0 pl-3 shadow-[-1px_0_0_var(--line)]";

function UnitRow({
  projectId,
  unit,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  unit: UnitView;
  onSaved: (unit: UnitView) => void;
  onDeleted: (unit: UnitView) => void;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);

  function edit<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((d) => d && { ...d, [field]: value });
  }

  // Close the editor, then put focus back on the Edit button it replaced.
  function stopEdit() {
    flushSync(() => {
      setDraft(null);
      setBusy(null);
    });
    editButton.current?.focus();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const checked = fromDraft(draft);
    if ("error" in checked) {
      setNotice({ tone: "bad", text: checked.error });
      return;
    }
    // Send only what changed.
    const changes = Object.fromEntries(
      (Object.keys(checked.unit) as (keyof UnitFields)[])
        .filter((k) => checked.unit[k] !== unit[k])
        .map((k) => [k, checked.unit[k]]),
    );
    if (Object.keys(changes).length === 0) {
      stopEdit();
      return;
    }
    setBusy("save");
    setNotice(null);
    try {
      const res = await apiFetch<{ unit: UnitView }>(unitPath(projectId, unit.id), { method: "PATCH", json: changes });
      onSaved(res.unit);
      stopEdit();
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(saveButton.current);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete unit ${unit.unitNo}? The bot stops offering it. This can't be undone.`)) return;
    setBusy("delete");
    setNotice(null);
    try {
      await apiFetch<{ ok: true }>(unitPath(projectId, unit.id), { method: "DELETE" });
      onDeleted(unit);
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(null);
      });
      restoreFocus(deleteButton.current);
    }
  }

  const noticeRow = (
    <NoticeLine notice={notice} reserve={false} className={notice ? "pb-2.5" : "sr-only"} />
  );

  const field = (name: string) => `${uid}-${name}`;

  if (draft) {
    // The editor spans the whole row, so every field is readable and the buttons stay in view at any width.
    return (
      <tr key="editing" className="bg-panel">
        <td colSpan={9} className="px-3 py-4">
          <form onSubmit={save} aria-label={`Edit unit ${unit.unitNo}`} className="grid gap-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Field label="Unit number" htmlFor={field("unitNo")}>
                <Input
                  id={field("unitNo")}
                  dir="auto"
                  value={draft.unitNo}
                  onChange={(e) => edit("unitNo", e.target.value)}
                  required
                  maxLength={40}
                  autoFocus
                />
              </Field>
              <Field label="Type" htmlFor={field("type")}>
                <Select id={field("type")} value={draft.type} onChange={(e) => edit("type", e.target.value as UnitType)}>
                  {UNIT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {UNIT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Bedrooms" htmlFor={field("bedrooms")}>
                <Select id={field("bedrooms")} value={draft.bedrooms} onChange={(e) => edit("bedrooms", e.target.value)}>
                  <BedroomOptions current={unit.bedrooms} />
                </Select>
              </Field>
              <Field label="Status" htmlFor={field("status")}>
                <Select id={field("status")} value={draft.status} onChange={(e) => edit("status", e.target.value as UnitStatus)}>
                  {UNIT_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {UNIT_STATUS_LABEL[st]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Price (AED)" htmlFor={field("price")}>
                <Input id={field("price")} inputMode="decimal" value={draft.price} onChange={(e) => edit("price", e.target.value)} required />
              </Field>
              <Field label="Size (sq ft)" htmlFor={field("size")}>
                <Input id={field("size")} inputMode="decimal" value={draft.sizeSqft} onChange={(e) => edit("sizeSqft", e.target.value)} />
              </Field>
              <Field label="Floor" htmlFor={field("floor")}>
                <Input id={field("floor")} dir="auto" value={draft.floor} onChange={(e) => edit("floor", e.target.value)} maxLength={20} />
              </Field>
              <Field label="View" htmlFor={field("view")}>
                <Input id={field("view")} dir="auto" value={draft.view} onChange={(e) => edit("view", e.target.value)} maxLength={100} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button key="save" ref={saveButton} type="submit" disabled={busy !== null}>
                {busy === "save" ? "Saving…" : "Save unit"}
              </Button>
              <Button key="cancel" variant="secondary" onClick={() => stopEdit()} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
            {noticeRow}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr key="showing">
      <th scope="row" className={`${CELL} font-medium`}>
        <bdi>{unit.unitNo}</bdi>
        {noticeRow}
      </th>
      <td className={CELL}>{UNIT_TYPE_LABEL[unit.type] ?? unit.type}</td>
      <td className={CELL}>{bedroomsText(unit.bedrooms)}</td>
      <td className={`${CELL} text-right tabular-nums`}>{unit.sizeSqft === null ? "–" : formatNumber(unit.sizeSqft)}</td>
      <td className={`${CELL} text-right tabular-nums`}>{formatNumber(unit.price)}</td>
      <td className={CELL}>
        <StatusMark tone={STATUS_TONE[unit.status] ?? "muted"}>{UNIT_STATUS_LABEL[unit.status] ?? unit.status}</StatusMark>
      </td>
      <td className={CELL}>
        <bdi>{unit.floor ?? "–"}</bdi>
      </td>
      <td className={CELL} dir="auto">
        {unit.view ?? "–"}
      </td>
      <td className={`${CELL} ${ACTIONS}`}>
        <div className="flex items-center gap-x-4 whitespace-nowrap">
          <TextButton
            key="edit"
            ref={editButton}
            onClick={(event) => {
              // Never let this click reach a form; the editor's Save button replaces this one.
              event.preventDefault();
              setDraft(toDraft(unit));
              setNotice(null);
            }}
            disabled={busy !== null}
            aria-label={`Edit unit ${unit.unitNo}`}
          >
            Edit
          </TextButton>
          <TextButton key="delete" ref={deleteButton} tone="bad" onClick={remove} disabled={busy !== null} aria-label={`Delete unit ${unit.unitNo}`}>
            {busy === "delete" ? "Deleting…" : "Delete"}
          </TextButton>
        </div>
      </td>
    </tr>
  );
}
