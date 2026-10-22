"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Button, Field, Input, NoticeLine, Section, Switch, Textarea, type Notice } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { DEFAULT_SETTINGS, type OrgSettings } from "@/lib/chat/types";

type NumberKey = { [K in keyof OrgSettings]: OrgSettings[K] extends number ? K : never }[keyof OrgSettings];
type ListKey = "allowedLinkDomains" | "allowedPhones";

// What the form edits: numbers and lists as the text the admin types.
type Draft = Record<NumberKey, string> & Record<ListKey, string> & { scopeCheck: boolean };

const NUMBER_FIELDS: Record<NumberKey, { label: string; help: string; unit: string; min: number }> = {
  maxMessageChars: {
    label: "Longest message from a lead",
    help: "Longer messages get a polite request to keep it short, without calling the AI.",
    unit: "characters",
    min: 50,
  },
  leadMessagesPerMinute: {
    label: "Messages per minute from one lead",
    help: "Extra messages are held back, so one lead can't run up your AI bill.",
    unit: "messages",
    min: 1,
  },
  strikeLimit: {
    label: "Strikes before the AI stops",
    help: "A strike is a clear abuse attempt: asking it to ignore its instructions, code, huge pastes or role-play. After this many, the scripted flow or a person takes over that lead.",
    unit: "strikes",
    min: 1,
  },
  offTopicStreakForStrike: {
    label: "Off-topic messages in a row that make a strike",
    help: "Ordinary off-topic questions are just steered back to property. Only this many in a row counts as one strike.",
    unit: "messages",
    min: 1,
  },
  leadTokenBudget: {
    label: "AI tokens per lead",
    help: "For the lead's whole conversation. When it's used up, the scripted flow takes over for that lead.",
    unit: "tokens",
    min: 1000,
  },
  monthlyTokenBudget: {
    label: "AI tokens per month",
    help: "For all leads together, each calendar month. When it's used up, the scripted flow takes over until the next month.",
    unit: "tokens",
    min: 1000,
  },
  maxReplyChars: {
    label: "Longest AI reply",
    help: "Longer replies are blocked and written again, so answers stay WhatsApp-length.",
    unit: "characters",
    min: 50,
  },
};

function toDraft(s: OrgSettings): Draft {
  return {
    maxMessageChars: String(s.maxMessageChars),
    leadMessagesPerMinute: String(s.leadMessagesPerMinute),
    strikeLimit: String(s.strikeLimit),
    offTopicStreakForStrike: String(s.offTopicStreakForStrike),
    leadTokenBudget: String(s.leadTokenBudget),
    monthlyTokenBudget: String(s.monthlyTokenBudget),
    maxReplyChars: String(s.maxReplyChars),
    scopeCheck: s.scopeCheck,
    allowedLinkDomains: s.allowedLinkDomains.join("\n"),
    allowedPhones: s.allowedPhones.join("\n"),
  };
}

function lines(text: string) {
  return [...new Set(text.split(/[\n,]/).map((l) => l.trim()).filter(Boolean))];
}

function numberError(key: NumberKey, value: string): string | null {
  const text = value.replace(/[,\s_]/g, "");
  if (!/^\d+$/.test(text)) return "Enter a whole number.";
  if (Number(text) < NUMBER_FIELDS[key].min) return `Use at least ${NUMBER_FIELDS[key].min.toLocaleString("en-US")}.`;
  return null;
}

function toSettings(d: Draft): OrgSettings {
  const n = (key: NumberKey) => Number(d[key].replace(/[,\s_]/g, ""));
  return {
    maxMessageChars: n("maxMessageChars"),
    leadMessagesPerMinute: n("leadMessagesPerMinute"),
    strikeLimit: n("strikeLimit"),
    offTopicStreakForStrike: n("offTopicStreakForStrike"),
    leadTokenBudget: n("leadTokenBudget"),
    monthlyTokenBudget: n("monthlyTokenBudget"),
    scopeCheck: d.scopeCheck,
    maxReplyChars: n("maxReplyChars"),
    allowedLinkDomains: lines(d.allowedLinkDomains),
    allowedPhones: lines(d.allowedPhones),
  };
}

function errorText(err: unknown) {
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return "Couldn't reach LeadSprint. Check the app is still running, then try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function SettingsClient() {
  const [saved, setSaved] = useState<OrgSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ settings: OrgSettings }>("/api/settings").then(
      (res) => setSaved(res.settings),
      (err: unknown) => setLoadError(errorText(err)),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!saved) {
    if (!loadError) return <p className="mt-8 text-muted">Loading your settings…</p>;
    return (
      <div className="mt-8 grid justify-items-start gap-3">
        <p className="text-bad">Couldn&apos;t load your settings: {loadError}</p>
        <Button
          variant="secondary"
          onClick={() => {
            setLoadError(null);
            load();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  return <SettingsForm saved={saved} onSaved={setSaved} />;
}

function SettingsForm({ saved, onSaved }: { saved: OrgSettings; onSaved: (s: OrgSettings) => void }) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [showErrors, setShowErrors] = useState(false);

  const errors = Object.fromEntries(
    (Object.keys(NUMBER_FIELDS) as NumberKey[]).map((key) => [key, numberError(key, draft[key])]),
  ) as Record<NumberKey, string | null>;
  const invalid = Object.values(errors).some(Boolean);
  const dirty = JSON.stringify(toDraft(saved)) !== JSON.stringify(draft);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (invalid) {
      setShowErrors(true);
      setNotice({ tone: "bad", text: "Not saved. Fix the fields marked below." });
      const first = (Object.keys(errors) as NumberKey[]).find((k) => errors[k]);
      if (first) document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ settings: OrgSettings }>("/api/settings", { method: "PUT", json: { settings: toSettings(draft) } });
      onSaved(res.settings);
      setDraft(toDraft(res.settings));
      setShowErrors(false);
      setNotice({ tone: "ok", text: "Saved. The new limits apply to the next message." });
    } catch (err) {
      setNotice({ tone: "bad", text: `Not saved: ${errorText(err)}` });
    } finally {
      setSaving(false);
    }
  }

  function numberField(key: NumberKey) {
    const f = NUMBER_FIELDS[key];
    const id = `${uid}-${key}`;
    const error = showErrors ? errors[key] : null;
    return (
      <Field
        label={f.label}
        htmlFor={id}
        help={
          <>
            {error && <span className="mb-0.5 block font-medium text-bad">{error}</span>}
            {f.help} Default: {DEFAULT_SETTINGS[key].toLocaleString("en-US")} {f.unit}.
          </>
        }
      >
        <Input
          id={id}
          inputMode="numeric"
          value={draft[key]}
          onChange={(e) => set(key, e.target.value)}
          aria-invalid={error ? true : undefined}
          className="max-w-[14rem] tabular-nums"
        />
      </Field>
    );
  }

  return (
    <form onSubmit={save} noValidate>
      <Section title="Messages from leads" intro="Free checks that run before any AI call, so they cost nothing.">
        <div className="grid gap-5">
          {numberField("maxMessageChars")}
          {numberField("leadMessagesPerMinute")}
        </div>
      </Section>

      <Section title="Strikes" intro="How the bot handles leads who try to misuse it. Strikes and the AI stop show in the chat tester.">
        <div className="grid gap-5">
          {numberField("strikeLimit")}
          {numberField("offTopicStreakForStrike")}
        </div>
      </Section>

      <Section title="Token budgets" intro="You pay your AI provider for every token. These caps stop one lead, or a busy month, draining your credit.">
        <div className="grid gap-5">
          {numberField("leadTokenBudget")}
          {numberField("monthlyTokenBudget")}
        </div>
      </Section>

      <Section title="AI replies" intro="What the AI may answer and what it may send. Replies are checked by free rules before they go out.">
        <div className="grid gap-5">
          <div className="grid gap-1.5">
            <Switch
              checked={draft.scopeCheck}
              onCheckedChange={(on) => set("scopeCheck", on)}
              aria-describedby={`${uid}-scope-help`}
              className="font-medium"
            >
              Check the topic before the AI replies
            </Switch>
            <p id={`${uid}-scope-help`} className="text-[13px] leading-snug text-muted">
              A quick check with a small model labels each message. Off-topic messages get a fixed reply and never reach the main AI.
              Turning it off saves one AI call per message; the main AI then turns down off-topic questions itself.
            </p>
          </div>
          {numberField("maxReplyChars")}
          <Field
            label="Websites the AI may link to"
            htmlFor={`${uid}-domains`}
            help="One per line, like yourcompany.ae. Replies with links to any other site are blocked."
          >
            <Textarea
              id={`${uid}-domains`}
              rows={3}
              value={draft.allowedLinkDomains}
              onChange={(e) => set("allowedLinkDomains", e.target.value)}
              spellCheck={false}
              dir="ltr"
              placeholder="yourcompany.ae"
            />
          </Field>
          <Field
            label="Phone numbers the AI may share"
            htmlFor={`${uid}-phones`}
            help="One per line, like your sales line. Replies with any other phone number are blocked."
          >
            <Textarea
              id={`${uid}-phones`}
              rows={3}
              value={draft.allowedPhones}
              onChange={(e) => set("allowedPhones", e.target.value)}
              spellCheck={false}
              dir="ltr"
              placeholder="+971 4 000 0000"
            />
          </Field>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3 py-6">
        <Button type="submit" disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {dirty && (
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(toDraft(saved));
              setShowErrors(false);
              setNotice({ tone: "ok", text: "Changes discarded." });
            }}
            disabled={saving}
          >
            Discard changes
          </Button>
        )}
        <Button
          variant="danger"
          className="ml-auto"
          onClick={() => {
            setDraft(toDraft(DEFAULT_SETTINGS));
            setNotice({ tone: "muted", text: "Defaults filled in. Save to use them." });
          }}
          disabled={saving}
        >
          Fill in the defaults
        </Button>
      </div>
      <NoticeLine notice={notice} className="-mt-3 pb-8" />
    </form>
  );
}
