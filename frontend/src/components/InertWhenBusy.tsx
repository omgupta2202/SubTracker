import { useLoading } from "@/hooks/useLoading";

/**
 * Wraps the app and applies the HTML `inert` attribute on its container
 * whenever a write request is in flight.
 *
 * `inert` makes the subtree non-interactive — clicks, focus, keyboard
 * input are all suppressed — but scrolling still works. This is exactly
 * what we want when, e.g., a payment is being recorded: the user can keep
 * reading the dashboard but can't double-submit by tapping again.
 *
 * Reads do NOT trigger inert; only writes (POST/PUT/DELETE/PATCH).
 */
export function InertWhenBusy({ children }: { children: React.ReactNode }) {
  const { blocking } = useLoading();
  // The `inert` prop on a div sets the HTML attribute when truthy.
  // React 19 understands it as a boolean prop; React 18 with TS may need
  // the cast, hence the `as any`.
  const inertProp: any = blocking ? { inert: "" } : {};
  return (
    <div {...inertProp} aria-busy={blocking}>
      {children}
    </div>
  );
}
