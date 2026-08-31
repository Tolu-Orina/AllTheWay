import { useState } from "react";
import { Check, Keyboard, Mic, Plus, Sparkles, SquarePen } from "lucide-react";

import { useT } from "@/app/i18n";
import { useAsync } from "@/app/use-async";
import { api } from "@/app/data";
import { useCompanionThread } from "@/app/companion-thread";
import { useVoice } from "@/app/use-voice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function StartTodoModal({
  open,
  onOpenChange,
  onNeedAccounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNeedAccounts: () => void;
}) {
  const t = useT();
  const { send, openCompanion } = useCompanionThread();
  const voice = useVoice();
  const connectors = useAsync(
    () => api.connectors(),
    [open],
  );
  const [task, setTask] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const connected = connectors.state.status === "ready"
    ? connectors.state.data.connectors.filter((c) => c.connected).map((c) => c.id)
    : [];
  const canGenerate =
    connected.includes("google_calendar") || connected.includes("google_gmail");

  function finish() {
    setTask("");
    setAdded([]);
    onOpenChange(false);
  }

  async function addManual() {
    const trimmed = task.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await api.createTask(trimmed);
      setAdded((prev) => [...prev, trimmed]);
      setTask("");
    } finally {
      setSaving(false);
    }
  }

  function speak() {
    finish();
    if (voice.status === "idle" || voice.status === "error") voice.start();
  }

  function generate() {
    if (connectors.state.status === "loading") return;
    if (!canGenerate) {
      onOpenChange(false);
      onNeedAccounts();
      return;
    }
    openCompanion();
    send(t("todo.generatePrompt"));
    finish();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(40rem,90dvh)] max-w-4xl overflow-y-auto p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <span className="grid size-10 place-items-center rounded-brand bg-navy-deep text-white">
            <SquarePen className="size-5" aria-hidden="true" />
          </span>
          <DialogTitle className="mt-4 text-[22px] font-bold tracking-[-0.02em] sm:text-[24px]">
            {t("todo.howToStart")}
          </DialogTitle>
          <DialogDescription className="mt-2 max-w-md">
            {t("todo.howToStartHint")}
          </DialogDescription>
        </div>

        <ul className="mt-8 grid gap-4 sm:grid-cols-3">
          <li className="flex flex-col rounded-brand-lg border bg-card p-5 shadow-e1">
            <span className="grid size-9 place-items-center rounded-brand bg-muted">
              <Keyboard className="size-4 text-foreground" aria-hidden="true" />
            </span>
            <p className="mt-4 text-[16px] font-semibold">{t("todo.manualEntry")}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {t("todo.manualEntryHint")}
            </p>
            {added.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1">
                {added.map((text, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px]">
                    <Check className="size-3.5 shrink-0 text-green-500" aria-hidden="true" />
                    <span className="truncate">{text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <form
              className="mt-5 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addManual();
              }}
            >
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder={t("todo.addANewTask")}
                className="min-w-0 flex-1 rounded-brand border bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
                aria-label={t("todo.addANewTask")}
              />
              <button
                type="submit"
                disabled={!task.trim() || saving}
                aria-label={t("todo.addANewTask")}
                className="grid size-9 shrink-0 place-items-center rounded-brand bg-navy-deep text-white transition-opacity disabled:opacity-40"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </form>
          </li>

          <li>
            <button
              type="button"
              onClick={speak}
              className="flex h-full w-full flex-col items-center rounded-brand-lg border bg-card p-5 text-center shadow-e1 transition-colors hover:border-primary/40"
            >
              <span className="grid size-16 place-items-center rounded-full bg-muted">
                <Mic className="size-7 text-navy-deep dark:text-blue-bright" aria-hidden="true" />
              </span>
              <p className="mt-4 text-[16px] font-semibold">{t("todo.speakToAllTheWay")}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {t("todo.speakHint")}
              </p>
            </button>
          </li>

          <li className="flex flex-col rounded-brand-lg border bg-card p-5 shadow-e1">
            <span className="grid size-9 place-items-center rounded-full bg-violet/15">
              <Sparkles className="size-4 text-violet" aria-hidden="true" />
            </span>
            <p className="mt-4 text-[16px] font-semibold">{t("todo.generateFromConnections")}</p>
            <p className="mt-1 flex-1 text-[13px] leading-relaxed text-muted-foreground">
              {t("todo.generateFromConnectionsHint")}
            </p>
            <button
              type="button"
              onClick={generate}
              disabled={connectors.state.status === "loading"}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-brand border px-3 py-2.5 text-[12px] font-semibold tracking-[0.08em] uppercase transition-colors hover:border-primary/40 disabled:opacity-50"
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              {t("todo.generateList")}
            </button>
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
