import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button, Field, Input, Section, Select, StatusMark, TextButton } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { addDays, dubaiClock, dubaiDate, isClockTime } from "@/lib/projects/dubai-time";
import { SLOT_KIND_LABEL, SLOT_KINDS, type SlotKind, type SlotView } from "@/lib/projects/types";
import { count, errorText, formatDubaiDay, listJoin, NoticeLine, projectPath, restoreFocus, type Notice } from "./shared";

const DURATIONS = [15, 30, 45, 60, 90, 120];
const MAX_TIMES = 12;
const MAX_REPEAT_DAYS = 60;

function endClock(slot: SlotView) {
  return dubaiClock(new Date(new Date(slot.startsAt).getTime() + slot.durationMin * 60_000));
}

export function Slots({ projectId, slots, onChanged }: { projectId: string; slots: SlotView[]; onChanged: () => void }) {
  const uid = useId();
  const [date, setDate] = useState(() => dubaiDate(new Date()));
  const [times, setTimes] = useState<string[]>(["10:00", "14:00"]);
  const [durationMin, setDurationMin] = useState(45);
  const [kind, setKind] = useState<SlotKind>("viewing");
  const [repeat, setRepeat] = useState("0");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [listNotice, setListNotice] = useState<Notice>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const listNoticeRef = useRef<HTMLParagraphElement>(null);
  const timeRefs = useRef<(HTMLInputElement | null)[]>([]);

  const today = dubaiDate(new Date());
  const repeatDays = /^\d+$/.test(repeat.trim()) ? Number(repeat.trim()) : NaN;
  const validTimes = [...new Set(times.filter(isClockTime))];
  const total = Number.isNaN(repeatDays) ? 0 : validTimes.length * (repeatDays + 1);
  const ready = Boolean(date) && validTimes.length === times.length && validTimes.length > 0 && !Number.isNaN(repeatDays) && repeatDays <= MAX_REPEAT_DAYS;

  function setTime(index: number, value: string) {
    setTimes((list) => list.map((t, i) => (i === index ? value : t)));
  }

  function addTime() {
    const last = times[times.length - 1];
    // Suggest an hour after the last time, as viewings are usually spaced out.
    const next = isClockTime(last ?? "") && Number(last.slice(0, 2)) < 23 ? `${String(Number(last.slice(0, 2)) + 1).padStart(2, "0")}${last.slice(2)}` : "10:00";
    flushSync(() => setTimes((list) => [...list, next]));
    timeRefs.current[times.length]?.focus();
  }

  function removeTime(index: number) {
    flushSync(() => setTimes((list) => list.filter((_, i) => i !== index)));
    timeRefs.current[Math.max(0, index - 1)]?.focus();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !ready) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ created: number; skippedPast: number; skippedExisting: number }>(projectPath(projectId, "/slots"), {
        method: "POST",
        json: { date, times: validTimes, durationMin, kind, repeatDays },
      });
      const skipped = [
        res.skippedExisting && `${count(res.skippedExisting, "time")} already had a slot`,
        res.skippedPast && `${count(res.skippedPast, "time")} had already passed`,
      ].filter((x): x is string => Boolean(x));
      const text = res.created
        ? `Added ${count(res.created, "slot")}.${skipped.length ? ` Skipped ${listJoin(skipped)}.` : ""}`
        : `No slots added: ${listJoin(skipped)}.`;
      setNotice({ tone: res.created ? "ok" : "warn", text });
      if (res.created) onChanged();
    } catch (err) {
      setNotice({ tone: "bad", text: errorText(err) });
    } finally {
      flushSync(() => setSaving(false));
      restoreFocus(submitRef.current);
    }
  }

  function deleted(slot: SlotView) {
    setNotice(null);
    setListNotice({ tone: "ok", text: `Deleted the ${formatDubaiDay(slot.startsAt)} ${dubaiClock(new Date(slot.startsAt))} slot.` });
    listNoticeRef.current?.focus();
    onChanged();
  }

  // Upcoming slots grouped by their day in Dubai.
  const days: { day: string; slots: SlotView[] }[] = [];
  for (const slot of slots) {
    const day = dubaiDate(new Date(slot.startsAt));
    const last = days[days.length - 1];
    if (last?.day === day) last.slots.push(slot);
    else days.push({ day, slots: [slot] });
  }
  const free = slots.filter((s) => !s.booking).length;
  const id = (name: string) => `${uid}-${name}`;

  return (
    <Section
      title="Viewing slots"
      intro="Times a lead can book for a viewing or a call. The bot offers the earliest free ones. All times are Dubai time (UTC+4)."
      aside={
        slots.length > 0 && (
          <div className="grid gap-1 text-[14px]">
            <p>{count(slots.length, "upcoming slot")}</p>
            <StatusMark tone="ok">{free} free</StatusMark>
            <StatusMark tone="warn">{slots.length - free} booked</StatusMark>
          </div>
        )
      }
    >
      <form onSubmit={add} aria-label="Add viewing slots" className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Date" htmlFor={id("date")}>
            <Input id={id("date")} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Length" htmlFor={id("duration")}>
            <Select id={id("duration")} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="min-w-0">
            <legend className="text-[14px] font-medium">For a</legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {SLOT_KINDS.map((k) => (
                <label key={k} className="flex min-h-7 cursor-pointer items-center gap-2.5 text-[14px]">
                  <input
                    type="radio"
                    name={id("kind")}
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                    className="accent-marina"
                  />
                  {SLOT_KIND_LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset className="min-w-0">
          <legend className="text-[14px] font-medium">Start times (Dubai time)</legend>
          <ul className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3">
            {times.map((time, index) => (
              <li key={index} className="flex items-center gap-2">
                <Input
                  ref={(el) => {
                    timeRefs.current[index] = el;
                  }}
                  type="time"
                  aria-label={`Start time ${index + 1}`}
                  value={time}
                  onChange={(e) => setTime(index, e.target.value)}
                  required
                  className="w-32"
                />
                {times.length > 1 && (
                  <TextButton tone="bad" onClick={() => removeTime(index)} aria-label={`Remove start time ${index + 1}`}>
                    Remove
                  </TextButton>
                )}
              </li>
            ))}
            {times.length < MAX_TIMES && (
              <li>
                <TextButton onClick={addTime}>Add a time</TextButton>
              </li>
            )}
          </ul>
        </fieldset>

        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field
            label="Also add the same times on the next … days"
            htmlFor={id("repeat")}
            help={`0 adds them on the chosen date only. Up to ${MAX_REPEAT_DAYS} days; times that already have a slot are skipped.`}
          >
            <Input
              id={id("repeat")}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_REPEAT_DAYS}
              step={1}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              className="w-28"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button ref={submitRef} type="submit" disabled={saving || !ready}>
            {saving ? "Adding…" : total > 0 ? `Add ${count(total, "slot")}` : "Add slots"}
          </Button>
          {ready && repeatDays > 0 && (
            <p className="text-[14px] text-muted">
              {formatDubaiDay(`${date}T08:00:00Z`)} to {formatDubaiDay(`${addDays(date, repeatDays)}T08:00:00Z`)}
            </p>
          )}
        </div>
        <NoticeLine notice={notice} />
      </form>

      <NoticeLine ref={listNoticeRef} notice={listNotice} reserve={false} className={listNotice ? "mt-3" : ""} />
      {slots.length === 0 ? (
        <p className="mt-5 text-[15px] leading-relaxed text-muted">
          No upcoming slots. Until you add some, the bot tells leads a colleague will arrange a time.
        </p>
      ) : (
        <div className="mt-5 grid gap-6">
          {days.map(({ day, slots: daySlots }) => (
            <div key={day}>
              <h3 className="text-[14px] font-semibold">{formatDubaiDay(daySlots[0].startsAt)}</h3>
              <ul className="mt-2 divide-y divide-line border-y border-line" aria-label={`Slots on ${formatDubaiDay(daySlots[0].startsAt)}`}>
                {daySlots.map((slot) => (
                  <SlotRow key={slot.id} projectId={projectId} slot={slot} onDeleted={deleted} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SlotRow({ projectId, slot, onDeleted }: { projectId: string; slot: SlotView; onDeleted: (slot: SlotView) => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const start = dubaiClock(new Date(slot.startsAt));

  async function remove() {
    setBusy(true);
    setNotice(null);
    try {
      await apiFetch<{ ok: true }>(projectPath(projectId, `/slots/${encodeURIComponent(slot.id)}`), { method: "DELETE" });
      onDeleted(slot);
    } catch (err) {
      flushSync(() => {
        setNotice({ tone: "bad", text: errorText(err) });
        setBusy(false);
      });
      restoreFocus(deleteButton.current);
    }
  }

  const booking = slot.booking;
  return (
    <li className="grid gap-1 py-2.5 sm:grid-cols-[7rem_5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <span className="font-medium tabular-nums">
        {start}–{endClock(slot)}
      </span>
      <span className="text-[14px] text-muted">{SLOT_KIND_LABEL[slot.kind] ?? slot.kind}</span>
      <span className="text-[14px]">
        {booking ? (
          <StatusMark tone="warn">
            <span>
              Booked{booking.leadName && <> by <bdi>{booking.leadName}</bdi></>}
              {booking.status !== "booked" && ` (${booking.status})`}
            </span>
          </StatusMark>
        ) : (
          <StatusMark tone="ok">Free</StatusMark>
        )}
      </span>
      <span>
        {!booking && (
          <TextButton
            ref={deleteButton}
            tone="bad"
            onClick={remove}
            disabled={busy}
            aria-label={`Delete the ${formatDubaiDay(slot.startsAt)} ${start} slot`}
          >
            {busy ? "Deleting…" : "Delete"}
          </TextButton>
        )}
      </span>
      <NoticeLine notice={notice} reserve={false} className={notice ? "sm:col-span-4" : "sr-only"} />
    </li>
  );
}
