import { XIcon, Waypoints } from "lucide-react";

import { useT } from "@/app/i18n";
import { Async } from "@/app/async";
import {
  AccountList,
  ConnectOutcomeBanner,
  DraftsToggle,
  useGoogleConnect,
} from "@/app/Connections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Connect accounts without leaving Today.
 *
 * Google consent is still a full navigation — their screen will not render
 * in a popup — so this stays a modal until they tap Connect, then they come
 * back here with `?connected=` and the modal reopens on the outcome.
 */
export function ConnectToolsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { state, reload, drafts, setDrafts, starting, error, outcome, connect } =
    useGoogleConnect("/app");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(40rem,90dvh)] max-w-3xl overflow-hidden p-0"
      >
        <div className="grid max-h-[min(40rem,90dvh)] md:grid-cols-[15.5rem_1fr]">
          <aside className="flex flex-col justify-between bg-navy-deep px-6 py-7 text-white">
            <div>
              <DialogTitle className="text-[22px] font-bold tracking-[-0.02em] text-white">
                {t("connections.connectYourTools")}
              </DialogTitle>
              <DialogDescription className="mt-3 text-[13.5px] leading-relaxed text-navy-fg">
                {t("connections.connectYourToolsHint")}
              </DialogDescription>
            </div>
            <Waypoints
              className="mt-10 size-20 text-blue-bright/50 md:mt-16"
              aria-hidden="true"
            />
          </aside>

          <div className="relative min-h-0 overflow-y-auto bg-card px-5 py-6 pr-12 sm:px-6">
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-3 right-3 z-10"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogClose>
            <ConnectOutcomeBanner outcome={outcome} error={error} />

            <p className="text-[11px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
              {t("connections.permissions")}
            </p>
            <div className="mt-2">
              <DraftsToggle drafts={drafts} onDrafts={setDrafts} />
            </div>

            <p className="mt-6 text-[11px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
              {t("connections.accounts")}
            </p>
            <div className="mt-2">
              <Async state={state} reload={reload}>
                {(data) => (
                  <AccountList
                    connectors={data.connectors}
                    starting={starting}
                    onConnect={connect}
                    connectedAsStatus
                  />
                )}
              </Async>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
