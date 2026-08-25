import { Link } from "@/components/primitives/app-link";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Logo } from "@/components/primitives/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Voice", href: "#voice" },
  { label: "Watchers", href: "#watchers" },
  { label: "Memory", href: "#memory" },
  { label: "Pricing", href: "#pricing" },
];

export function SiteHeader() {
  const [lifted, setLifted] = useState(false);

  // The nav only earns its border once content sits behind it.
  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-colors duration-200",
        lifted ? "glass border-b" : "border-b border-transparent",
      )}
    >
      <div className="flex h-16 w-full items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="rounded-sm" aria-label="AllTheWay home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[15px] font-extrabold text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            render={<Link href="/login" />}
            variant="ghost"
            size="lg"
            className="hidden sm:inline-flex"
          >
            Log in
          </Button>
          <Button render={<Link href="/signup" />} variant="brand" size="lg">
            Start free
          </Button>

          <Sheet>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="md:hidden"
                  aria-label="Open menu"
                >
                  <Menu />
                </Button>
              }
            />
            <SheetContent side="right" className="w-[280px] p-6">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <nav aria-label="Mobile" className="mt-8 flex flex-col gap-1">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-brand px-3 py-3 text-lg font-medium transition-colors hover:bg-muted"
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href="/login"
                  className="rounded-brand px-3 py-3 text-lg font-medium transition-colors hover:bg-muted"
                >
                  Log in
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
