import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AccountMenu } from "@/app/AccountMenu";
import { api, type Session, type UserDocument, type Watcher } from "@/app/data";
import { useStartWork } from "@/app/use-start-work";
import { useT } from "@/app/i18n";

/**
 * Desktop top bar, inside the main column rather than the sidebar.
 *
 * Search and New belong to the work, not to navigation — putting them here
 * keeps the sidebar purely about where you are.
 *
 * The `/` hint is shown only because the key actually focuses this input and
 * the input actually filters. A kbd that does neither is the Recents-bug class
 * of chrome: it looks finished and is not.
 */
export function AppTopBar() {
  const { pathname } = useLocation();
  const { startWork, starting } = useStartWork();
  const onWork = pathname === "/app/work" || pathname.startsWith("/app/work/");

  return (
    <div className="mb-6 hidden items-center gap-3 lg:flex">
      {onWork ? <WorkSearch /> : <div className="min-w-0 flex-1" />}

      <div className="ml-auto flex items-center gap-3">
        <Button variant="brand" size="lg" disabled={starting} onClick={() => void startWork()}>
          <Plus />
          New
        </Button>
        <AccountMenu />
      </div>
    </div>
  );
}

type Catalogue = {
  sessions: Session[];
  watchers: Watcher[];
  documents: UserDocument[];
};

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

function WorkSearch() {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  async function ensureCatalogue() {
    if (catalogue) return catalogue;
    const [sessions, watchers, docs] = await Promise.all([
      api.sessions(),
      api.watchers(),
      api.documents(),
    ]);
    const next = { sessions, watchers, documents: docs.documents };
    setCatalogue(next);
    return next;
  }

  const needle = query.trim().toLowerCase();
  const sessions =
    catalogue && needle
      ? catalogue.sessions.filter((s) => matches(s.title, needle))
      : [];
  const watchers =
    catalogue && needle
      ? catalogue.watchers.filter(
          (w) => matches(w.name, needle) || matches(w.instruction, needle) || matches(w.trigger, needle),
        )
      : [];
  const documents =
    catalogue && needle
      ? catalogue.documents.filter((d) => matches(d.title, needle))
      : [];
  const total = sessions.length + watchers.length + documents.length;
  const showResults = open && needle.length > 0;

  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 sm:max-w-sm"
      onSubmit={(event) => event.preventDefault()}
    >
      <label htmlFor="app-search" className="sr-only">
        {t("search.placeholder")}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id="app-search"
        type="search"
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={showResults ? listId : undefined}
        aria-expanded={showResults}
        placeholder={t("search.placeholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          setOpen(true);
          void ensureCatalogue();
        }}
        onBlur={() => {
          // Delay so a mousedown on a result can navigate before the list unmounts.
          window.setTimeout(() => setOpen(false), 120);
        }}
        className="w-full rounded-brand border bg-card py-2.5 pr-10 pl-9 text-[14px] outline-none placeholder:text-muted-foreground"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
        /
      </kbd>

      {showResults ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1.5 max-h-80 w-full overflow-y-auto rounded-brand border bg-card p-1.5 shadow-e2"
        >
          {total === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground">{t("search.noResults")}</p>
          ) : (
            <ul className="flex flex-col">
              {sessions.map((s) => (
                <li key={`s-${s.id}`}>
                  <Link
                    role="option"
                    to={`/app/work/${s.id}`}
                    className="block truncate rounded-[6px] px-2.5 py-1.5 text-[13px] hover:bg-muted"
                  >
                    <span className="text-muted-foreground">{t("search.work")} · </span>
                    {s.title}
                  </Link>
                </li>
              ))}
              {watchers.map((w) => (
                <li key={`w-${w.id}`}>
                  <Link
                    role="option"
                    to="/app/watchers"
                    className="block truncate rounded-[6px] px-2.5 py-1.5 text-[13px] hover:bg-muted"
                  >
                    <span className="text-muted-foreground">{t("search.watchers")} · </span>
                    {w.name}
                  </Link>
                </li>
              ))}
              {documents.map((d) => (
                <li key={`d-${d.id}`}>
                  <Link
                    role="option"
                    to="/app/you#documents"
                    className="block truncate rounded-[6px] px-2.5 py-1.5 text-[13px] hover:bg-muted"
                  >
                    <span className="text-muted-foreground">{t("search.documents")} · </span>
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </form>
  );
}
