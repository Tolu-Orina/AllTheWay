import { useState } from "react";
import { useT } from "@/app/i18n";
import type { Hat, Person, Place, Rhythm } from "@alltheway/contracts";

import { Button } from "@/components/ui/button";
import { api } from "@/app/data";

const DAYS: Array<{ n: number; label: string }> = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 0, label: "Sun" },
];

export function RhythmsSheet({
  people,
  places,
  rhythms,
  onChange,
}: {
  people: Person[];
  places: Place[];
  rhythms: Rhythm[];
  onChange: () => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState({ name: "", relation: "" });
  const [place, setPlace] = useState({ label: "", bufferMinutes: 15 });
  const [rhythm, setRhythm] = useState({
    title: "",
    hat: "home" as Hat,
    weekdays: [1, 2, 3, 4, 5],
    time: "08:10",
    personId: "",
    placeId: "",
  });
  const [saving, setSaving] = useState<string | null>(null);

  async function addPerson() {
    if (!person.name.trim()) return;
    setSaving("person");
    setError(null);
    try {
      await api.createPerson({ name: person.name, relation: person.relation });
      setPerson({ name: "", relation: "" });
      onChange();
    } catch {
      setError(t("life.couldNotSave"));
    } finally {
      setSaving(null);
    }
  }

  async function addPlace() {
    if (!place.label.trim()) return;
    setSaving("place");
    setError(null);
    try {
      await api.createPlace({ label: place.label, bufferMinutes: place.bufferMinutes, hat: "home" });
      setPlace({ label: "", bufferMinutes: 15 });
      onChange();
    } catch {
      setError(t("life.couldNotSave"));
    } finally {
      setSaving(null);
    }
  }

  async function addRhythm() {
    if (!rhythm.title.trim()) return;
    setSaving("rhythm");
    setError(null);
    try {
      await api.createRhythm({
        title: rhythm.title,
        hat: rhythm.hat,
        weekdays: rhythm.weekdays,
        time: rhythm.time,
        personId: rhythm.personId || undefined,
        placeId: rhythm.placeId || undefined,
      });
      setRhythm((prev) => ({ ...prev, title: "" }));
      onChange();
    } catch {
      setError(t("life.couldNotSave"));
    } finally {
      setSaving(null);
    }
  }

  async function seed(kind: "school" | "church") {
    setSaving(kind);
    setError(null);
    try {
      await api.createRhythm(
        kind === "school"
          ? { title: t("life.schoolRun"), hat: "home", weekdays: [1, 2, 3, 4, 5], time: "08:10" }
          : { title: t("life.sundayChurch"), hat: "church", weekdays: [0], time: "10:00" },
      );
      onChange();
    } catch {
      setError(t("life.couldNotSave"));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="text-[16px] font-semibold">{t("life.whoWeLookAfter")}</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{t("life.whoHint")}</p>
      </header>

      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void seed("school")} disabled={saving !== null}>
          {t("life.schoolRun")}
        </Button>
        <Button type="button" variant="outline" onClick={() => void seed("church")} disabled={saving !== null}>
          {t("life.sundayChurch")}
        </Button>
      </div>

      {rhythms.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("life.noRhythms")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-brand-lg border bg-card shadow-e1">
          {rhythms.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block text-[14px] font-medium">{row.title}</span>
                <span className="text-[12.5px] text-muted-foreground">
                  {row.time} · {t(`life.hat${row.hat[0]!.toUpperCase()}${row.hat.slice(1)}`)}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void api.deleteRhythm(row.id).then(onChange)}
              >
                {t("life.dismiss")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void addPerson();
        }}
      >
        <p className="text-[14px] font-medium">{t("life.addPerson")}</p>
        <input
          value={person.name}
          onChange={(e) => setPerson((p) => ({ ...p, name: e.target.value }))}
          placeholder={t("life.personPlaceholder")}
          className="rounded-brand border bg-background px-3 py-2 text-[14px]"
          aria-label={t("life.personName")}
        />
        <input
          value={person.relation}
          onChange={(e) => setPerson((p) => ({ ...p, relation: e.target.value }))}
          placeholder={t("life.relationPlaceholder")}
          className="rounded-brand border bg-background px-3 py-2 text-[14px]"
          aria-label={t("life.relation")}
        />
        <Button type="submit" variant="brand" disabled={saving !== null || !person.name.trim()}>
          {t("life.save")}
        </Button>
      </form>

      {people.length > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {people.map((p) => p.name).join(" · ")}
        </p>
      ) : null}

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void addPlace();
        }}
      >
        <p className="text-[14px] font-medium">{t("life.addPlace")}</p>
        <input
          value={place.label}
          onChange={(e) => setPlace((p) => ({ ...p, label: e.target.value }))}
          placeholder={t("life.placePlaceholder")}
          className="rounded-brand border bg-background px-3 py-2 text-[14px]"
          aria-label={t("life.placeLabel")}
        />
        <label className="text-[13px] text-muted-foreground">
          {t("life.buffer")}
          <input
            type="number"
            min={0}
            max={180}
            value={place.bufferMinutes}
            onChange={(e) => setPlace((p) => ({ ...p, bufferMinutes: Number(e.target.value) || 15 }))}
            className="ml-2 w-20 rounded-brand border bg-background px-2 py-1 text-[14px]"
          />
        </label>
        <Button type="submit" variant="outline" disabled={saving !== null || !place.label.trim()}>
          {t("life.save")}
        </Button>
      </form>

      {places.length > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {places.map((p) => p.label).join(" · ")}
        </p>
      ) : null}

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void addRhythm();
        }}
      >
        <p className="text-[14px] font-medium">{t("life.addRhythm")}</p>
        <input
          value={rhythm.title}
          onChange={(e) => setRhythm((p) => ({ ...p, title: e.target.value }))}
          placeholder={t("life.rhythmPlaceholder")}
          className="rounded-brand border bg-background px-3 py-2 text-[14px]"
          aria-label={t("life.rhythmTitle")}
        />
        <fieldset>
          <legend className="text-[13px] text-muted-foreground">{t("life.weekdays")}</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {DAYS.map((day) => {
              const on = rhythm.weekdays.includes(day.n);
              return (
                <button
                  key={day.n}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setRhythm((p) => ({
                      ...p,
                      weekdays: on ? p.weekdays.filter((n) => n !== day.n) : [...p.weekdays, day.n],
                    }))
                  }
                  className={
                    on
                      ? "rounded-full bg-primary px-2.5 py-1 text-[12px] text-primary-foreground"
                      : "rounded-full bg-muted px-2.5 py-1 text-[12px] text-muted-foreground"
                  }
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="text-[13px] text-muted-foreground">
          {t("life.time")}
          <input
            type="time"
            value={rhythm.time}
            onChange={(e) => setRhythm((p) => ({ ...p, time: e.target.value }))}
            className="ml-2 rounded-brand border bg-background px-2 py-1 text-[14px]"
          />
        </label>
        {people.length > 0 ? (
          <select
            value={rhythm.personId}
            onChange={(e) => setRhythm((p) => ({ ...p, personId: e.target.value }))}
            className="rounded-brand border bg-background px-3 py-2 text-[14px]"
            aria-label={t("life.personName")}
          >
            <option value="">{t("life.personName")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
        {places.length > 0 ? (
          <select
            value={rhythm.placeId}
            onChange={(e) => setRhythm((p) => ({ ...p, placeId: e.target.value }))}
            className="rounded-brand border bg-background px-3 py-2 text-[14px]"
            aria-label={t("life.placeLabel")}
          >
            <option value="">{t("life.placeLabel")}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        ) : null}
        <Button type="submit" variant="brand" disabled={saving !== null || !rhythm.title.trim() || rhythm.weekdays.length === 0}>
          {t("life.save")}
        </Button>
      </form>
    </section>
  );
}
