import { useLoading } from "@/hooks/useLoading";

/**
 * YouTube/GitHub-style top progress bar.
 *
 * Shows whenever any HTTP request is in flight. The animation is purely
 * indeterminate (we don't know the response duration), but the gradient
 * sweep gives the user reliable feedback that work is happening.
 *
 * The bar is fixed at z-[100] so it sits above the header (z-20),
 * popovers (z-[70]), and even the card-detail drawer (z-[90]).
 */
export function GlobalProgress() {
  const { anyInFlight } = useLoading();
  return (
    <div
      aria-hidden={!anyInFlight}
      className={`fixed top-0 left-0 right-0 z-[100] h-[2px] pointer-events-none
                  transition-opacity duration-200
                  ${anyInFlight ? "opacity-100" : "opacity-0"}`}
    >
      <div
        className="h-full bg-gradient-to-r from-violet-600 via-fuchsia-400 to-violet-600
                   bg-[length:200%_100%] animate-progress-sweep"
      />
    </div>
  );
}
