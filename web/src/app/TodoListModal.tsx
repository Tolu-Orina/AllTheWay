import { useState } from "react";
import { Check, CheckCircle2, ListTodo, Plus, Trash2 } from "lucide-react";
import type { Task } from "@alltheway/contracts";

import { useT } from "@/app/i18n";
import { useAsync } from "@/app/use-async";
import { api } from "@/app/data";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export function TodoListModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { state, reload } = useAsync(() => api.tasks(), [open]);
  const [newTask, setNewTask] = useState("");
  const [adding, setAdding] = useState(false);

  const tasks: Task[] = state.status === "ready" ? state.data : [];
  const pending = tasks.filter((task) => task.completedAt === null);
  const done = tasks.filter((task) => task.completedAt !== null);

  async function addTask() {
    const trimmed = newTask.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await api.createTask(trimmed);
      setNewTask("");
      reload();
    } finally {
      setAdding(false);
    }
  }

  async function complete(id: string) {
    await api.completeTask(id);
    reload();
  }

  async function remove(id: string) {
    await api.deleteTask(id);
    reload();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(40rem,90dvh)] max-w-lg overflow-y-auto p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-brand bg-navy-deep text-white">
            <ListTodo className="size-5" aria-hidden="true" />
          </span>
          <DialogTitle className="text-[20px] font-bold tracking-[-0.02em]">
            {t("todo.yourTodos")}
          </DialogTitle>
        </div>

        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addTask();
          }}
        >
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder={t("todo.addANewTask")}
            className="min-w-0 flex-1 rounded-brand border bg-background px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!newTask.trim() || adding}
            aria-label={t("todo.addANewTask")}
            className="grid size-9 shrink-0 place-items-center rounded-brand bg-navy-deep text-white transition-opacity disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </form>

        {pending.length > 0 ? (
          <ul className="mt-4 flex flex-col divide-y">
            {pending.map((task) => (
              <li key={task.id} className="flex items-center gap-2 py-2.5">
                <button
                  type="button"
                  onClick={() => void complete(task.id)}
                  aria-label={t("todo.complete")}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-green-500"
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                </button>
                <span className="flex-1 text-[14px]">{task.text}</span>
                <button
                  type="button"
                  onClick={() => void remove(task.id)}
                  aria-label={t("todo.delete")}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-[14px] text-muted-foreground">{t("todo.allDone")}</p>
        )}

        {done.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer select-none text-[12px] font-medium text-muted-foreground">
              {t("todo.completedCount", { n: done.length })}
            </summary>
            <ul className="mt-2 flex flex-col divide-y">
              {done.map((task) => (
                <li key={task.id} className="flex items-center gap-2 py-2 opacity-50">
                  <Check className="size-4 shrink-0 text-green-500" aria-hidden="true" />
                  <span className="flex-1 text-[13px] line-through">{task.text}</span>
                  <button
                    type="button"
                    onClick={() => void remove(task.id)}
                    aria-label={t("todo.delete")}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
