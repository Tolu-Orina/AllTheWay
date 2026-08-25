import type { ComponentProps } from "react";
import { Link as RouterLink } from "react-router";

type Props = Omit<ComponentProps<"a">, "href"> & { href: string };

/**
 * One link primitive for the whole app.
 * In-page anchors and external URLs stay plain <a>; app routes go through the
 * router so navigation never does a full page load.
 */
export function Link({ href, ...props }: Props) {
  if (href.startsWith("/")) return <RouterLink to={href} {...props} />;
  return <a href={href} {...props} />;
}
