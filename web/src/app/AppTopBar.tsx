import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar } from "@/app/Avatar";

/**
 * Desktop top bar, inside the main column rather than the sidebar.
 *
 * Search and New belong to the work, not to navigation — putting them here
 * keeps the sidebar purely about where you are.
 */
export function AppTopBar() {
  return (
    <div className="mb-6 hidden items-center gap-3 lg:flex">
      <label htmlFor="app-search" className="sr-only">
        Search
      </label>
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id="app-search"
          type="search"
          placeholder="Search sessions, watchers, anything…"
          className="w-full rounded-brand border bg-card py-2.5 pr-10 pl-9 text-[14px] outline-none placeholder:text-muted-foreground"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
          /
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <Button variant="brand" size="lg">
          <Plus />
          New
        </Button>
        <Avatar />
      </div>
    </div>
  );
}
