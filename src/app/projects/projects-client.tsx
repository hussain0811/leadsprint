"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Section } from "@/components/ui";
import { apiFetch } from "@/lib/api-client";
import { PROJECT_STATUS_LABEL, type ProjectDetail, type ProjectSummary, type UnitView } from "@/lib/projects/types";
import { ImportUnits } from "./import-units";
import { ProjectForm } from "./project-form";
import { count, errorText, projectPath } from "./shared";
import { Slots } from "./slots";
import { Units } from "./units";

const NEW = "new";

// The open project is kept in the address (?project=…), so a reload or a shared link opens it again.
function readSelection() {
  return new URLSearchParams(window.location.search).get("project");
}

function writeSelection(id: string | null) {
  const url = new URL(window.location.href);
  if (id && id !== NEW) url.searchParams.set("project", id);
  else url.searchParams.delete("project");
  window.history.replaceState(window.history.state, "", url);
}

export function ProjectsClient() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const latestList = useRef(0);
  const latestDetail = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  const reloadList = useCallback(async () => {
    const request = ++latestList.current;
    try {
      const res = await apiFetch<{ projects: ProjectSummary[] }>("/api/projects");
      if (request !== latestList.current) return null;
      setProjects(res.projects);
      setListError(null);
      return res.projects;
    } catch (err) {
      if (request === latestList.current) setListError(errorText(err));
      return null;
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const request = ++latestDetail.current;
    try {
      const next = await apiFetch<ProjectDetail>(projectPath(id));
      if (request !== latestDetail.current) return;
      setDetail(next);
      setDetailError(null);
    } catch (err) {
      if (request === latestDetail.current) setDetailError(errorText(err));
    }
  }, []);

  const open = useCallback(
    (id: string | null) => {
      latestDetail.current++; // a slower load for the previous project mustn't land here
      setSelected(id);
      setDetail(null);
      setDetailError(null);
      writeSelection(id);
      if (id && id !== NEW) void loadDetail(id);
    },
    [loadDetail],
  );

  // First load: open the project named in the address, else the first one, else a blank form.
  const firstLoad = useCallback(() => {
    const request = ++latestList.current;
    apiFetch<{ projects: ProjectSummary[] }>("/api/projects").then(
      ({ projects: list }) => {
        if (request !== latestList.current) return;
        setProjects(list);
        setListError(null);
        const wanted = readSelection();
        const found = wanted && list.some((p) => p.id === wanted);
        open(found ? wanted : (list[0]?.id ?? NEW));
      },
      (err: unknown) => {
        if (request === latestList.current) setListError(errorText(err));
      },
    );
  }, [open]);

  useEffect(() => {
    firstLoad();
  }, [firstLoad]);

  function openAndFocus(id: string) {
    open(id);
    // Move to the project's heading once it renders, so keyboard and screen reader users land on it.
    requestAnimationFrame(() => detailHeading.current?.focus());
  }

  // After any change: show it straight away, then refresh the totals in the list.
  const changed = useCallback(
    (next: ProjectDetail) => {
      setDetail(next);
      void reloadList();
    },
    [reloadList],
  );

  const refresh = useCallback(() => {
    if (selected && selected !== NEW) void loadDetail(selected);
    void reloadList();
  }, [selected, loadDetail, reloadList]);

  function created(next: ProjectDetail) {
    setSelected(next.project.id);
    writeSelection(next.project.id);
    changed(next);
    // The new-project form is replaced by the full editor; land on its heading.
    requestAnimationFrame(() => detailHeading.current?.focus());
  }

  function deleted(id: string) {
    const rest = (projects ?? []).filter((p) => p.id !== id);
    setProjects(rest);
    open(rest[0]?.id ?? NEW);
    void reloadList();
  }

  function unitsChanged(units: UnitView[]) {
    setDetail((d) => d && { ...d, units, related: { ...d.related, units: units.length } });
    void reloadList();
  }

  if (!projects) {
    if (!listError) return <p className="mt-8 text-muted">Loading your projects…</p>;
    return (
      <div className="mt-8 grid justify-items-start gap-3">
        <p className="text-bad">Couldn&apos;t load your projects: {listError}</p>
        <Button variant="secondary" onClick={firstLoad}>
          Try again
        </Button>
      </div>
    );
  }

  const project = detail?.project;

  return (
    <div>
      <p role="status" className={listError ? "mt-6 text-[14px] text-bad" : "sr-only"}>
        {listError && `Couldn't refresh the project list: ${listError}`}
      </p>

      <Section
        title="Your projects"
        intro="Pick a project to edit its details, units and viewing slots."
        aside={
          <Button variant="secondary" onClick={() => openAndFocus(NEW)} disabled={selected === NEW}>
            New project
          </Button>
        }
      >
        {projects.length === 0 ? (
          <p className="text-[15px] leading-relaxed text-muted">
            No projects yet. Add your first one below; the bot can then quote its prices and book viewings.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line" aria-label="Projects">
            {projects.map((p) => {
              const current = p.id === selected;
              const place = [p.community, p.city].filter(Boolean).join(", ");
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => openAndFocus(p.id)}
                    aria-current={current ? "true" : undefined}
                    className={`grid w-full gap-1 border-l-2 py-3.5 pr-2 pl-4 text-left transition-colors hover:bg-panel ${
                      current ? "border-brass bg-panel" : "border-transparent"
                    }`}
                  >
                    <span dir="auto" className="font-medium leading-snug wrap-break-word">
                      {p.name}
                    </span>
                    <span className="text-[13px] leading-relaxed text-muted">
                      {place && (
                        <>
                          <bdi>{place}</bdi>
                          {" · "}
                        </>
                      )}
                      {PROJECT_STATUS_LABEL[p.status]}
                      {p.handover && (
                        <>
                          {", "}
                          <bdi>{p.handover}</bdi>
                        </>
                      )}
                      {" · "}
                      {count(p.units, "unit")} ({formatAvailable(p.availableUnits)})
                      {" · "}
                      {count(p.freeSlots, "free slot")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {selected && (
        <div className="pt-9">
          <h2 ref={detailHeading} tabIndex={-1} dir="auto" className="text-[1.375rem] font-semibold leading-tight wrap-break-word">
            {selected === NEW ? "New project" : (project?.name ?? "Loading…")}
          </h2>
          {selected !== NEW && !detail && (
            <div className="mt-4 grid justify-items-start gap-3">
              {detailError ? (
                <>
                  <p className="text-bad">Couldn&apos;t load this project: {detailError}</p>
                  <Button variant="secondary" onClick={() => void loadDetail(selected)}>
                    Try again
                  </Button>
                </>
              ) : (
                <p className="text-muted">Loading the project…</p>
              )}
            </div>
          )}
          {selected === NEW && <ProjectForm key={NEW} detail={null} onSaved={created} onDeleted={deleted} />}
          {detail && (
            <>
              <p role="status" className={detailError ? "mt-3 text-[14px] text-bad" : "sr-only"}>
                {detailError && `Couldn't refresh this project: ${detailError}`}
              </p>
              <ProjectForm key={detail.project.id} detail={detail} onSaved={changed} onDeleted={deleted} />
              <Units key={`units-${detail.project.id}`} projectId={detail.project.id} units={detail.units} onChange={unitsChanged} />
              <ImportUnits key={`import-${detail.project.id}`} projectId={detail.project.id} onImported={refresh} />
              <Slots key={`slots-${detail.project.id}`} projectId={detail.project.id} slots={detail.slots} onChanged={refresh} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatAvailable(n: number) {
  return `${n} available`;
}
