import { useEffect, useState } from "react";
import { Loader2, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";

import { useT } from "@/app/i18n";
import { api } from "@/app/data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

type Template = {
  id: string;
  name: string;
  body: string;
};

const STORAGE_KEY = "alltheway:templates";

function loadTemplates(): Template[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Template[]) : [];
  } catch {
    return [];
  }
}

function persistTemplates(templates: Template[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // ignore storage errors
  }
}

export function MessageTemplatesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTemplates(loadTemplates());
  }, [open]);

  async function draft() {
    if (!name.trim() || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const result = await api.draftTemplate(name.trim());
      if (result.body) setBody(result.body);
      else setError(t("templates.draftFailed"));
    } catch {
      setError(t("templates.draftFailed"));
    } finally {
      setDrafting(false);
    }
  }

  function save() {
    const trimmedName = name.trim();
    const trimmedBody = body.trim();
    if (!trimmedName || !trimmedBody) return;
    const next = [
      ...templates,
      { id: crypto.randomUUID(), name: trimmedName, body: trimmedBody },
    ];
    persistTemplates(next);
    setTemplates(next);
    setName("");
    setBody("");
    setError(null);
  }

  function remove(id: string) {
    const next = templates.filter((tpl) => tpl.id !== id);
    persistTemplates(next);
    setTemplates(next);
  }

  function copy(template: Template) {
    void navigator.clipboard.writeText(template.body);
    setCopied(template.id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(44rem,92dvh)] max-w-lg overflow-y-auto p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-brand bg-navy-deep text-white">
            <MessageSquarePlus className="size-5" aria-hidden="true" />
          </span>
          <div>
            <DialogTitle className="text-[20px] font-bold tracking-[-0.02em]">
              {t("templates.title")}
            </DialogTitle>
            <p className="text-[13px] text-muted-foreground">{t("templates.hint")}</p>
          </div>
        </div>

        {templates.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {templates.map((tpl) => (
              <li
                key={tpl.id}
                className="rounded-brand border bg-card px-4 py-3 shadow-e1"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[14px] font-semibold">{tpl.name}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => copy(tpl)}
                      className="rounded px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted"
                    >
                      {copied === tpl.id ? t("templates.copied") : t("templates.copy")}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(tpl.id)}
                      aria-label={t("todo.delete")}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                  {tpl.body}
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 rounded-brand border bg-card p-4 shadow-e1">
          <p className="text-[14px] font-semibold">{t("templates.newTemplate")}</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("templates.namePlaceholder")}
            className="mt-3 w-full rounded-brand border bg-background px-3 py-2 text-[13.5px] outline-none placeholder:text-muted-foreground"
          />
          <div className="relative mt-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("templates.bodyPlaceholder")}
              rows={4}
              className="w-full resize-none rounded-brand border bg-background px-3 py-2 pb-8 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              disabled={!name.trim() || drafting}
              onClick={() => void draft()}
              className="absolute right-2 bottom-2 flex items-center gap-1 rounded-brand bg-navy-deep/10 px-2 py-1 text-[11.5px] font-semibold text-navy-deep transition-colors hover:bg-navy-deep/20 disabled:opacity-40 dark:bg-blue-bright/10 dark:text-blue-bright dark:hover:bg-blue-bright/20"
            >
              {drafting ? (
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Sparkles className="size-3" aria-hidden="true" />
              )}
              {t("templates.aiDraft")}
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-[12.5px] text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="brand"
            size="lg"
            className="mt-3 w-full"
            disabled={!name.trim() || !body.trim()}
            onClick={save}
          >
            {t("templates.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
