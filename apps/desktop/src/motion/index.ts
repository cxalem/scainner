// One motion vocabulary, reused everywhere something appears/changes,
// instead of each component picking its own duration/easing by hand — the
// gap named directly (docs/workflows/animation-system/plan.md): grepping
// the app before this file, `transition-`/`animate-` usage was all
// press-state work (active:scale) and skeleton pulses; zero enter/appear
// animation anywhere, so a resolved field or a newly-mounted card just
// hard-cut into place.
//
// framer-motion, not hand-rolled CSS: this app already had two working
// CSS-only examples (ScanConsole's fade-slide-in, the scan-sweep bar) and
// they're fine for a single isolated effect, but they don't compose — a
// staggered field-by-field reveal (DiscoveryFlow) or a layout-shift that
// should animate smoothly instead of jumping (a card mounting and pushing
// a sibling down) need either real JS-driven sequencing or FLIP-style
// layout animation, neither of which plain CSS transitions give you
// without a lot of hand-built plumbing. Real cost accepted, same as the
// Effect migration's own bundle tradeoff: framer-motion adds real bundle
// weight for real capability, not free.
import type { Transition, Variants } from "framer-motion";

export const DURATION = {
  fast: 0.15,
  base: 0.22,
  slow: 0.32,
} as const;

// A gentle decelerate — content settles in rather than snapping to a stop,
// which is most of what "continuity" actually means perceptually.
const EASE_OUT: Transition["ease"] = [0.16, 1, 0.3, 1];

export const fadeTransition: Transition = { duration: DURATION.fast, ease: "easeOut" };
export const settleTransition: Transition = { duration: DURATION.base, ease: EASE_OUT };

// Modal backdrop: fade only, no movement — the backdrop dimming is the
// "something changed" cue, motion on it would just be noise.
export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: fadeTransition },
  exit: { opacity: 0, transition: fadeTransition },
};

// Modal panel: the actual "when I open a modal everything happens
// suddenly" fix (Alejandro, 2026-08-21) — a small scale + rise instead of
// popping to 100% instantly.
export const modalPanelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: settleTransition },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: fadeTransition },
};

// Generic "this block of content just appeared" — a section resolving, a
// card mounting once its data is ready. Used with `layout` on the parent
// so siblings that get pushed around reposition smoothly instead of
// jumping (the DiscoveryFlow "everything moves up suddenly" complaint).
export const appearVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: settleTransition },
};

// Sequential reveal (DiscoveryFlow's field-by-field resolution): wrap the
// list in staggerContainer, each item in staggerItem.
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: fadeTransition },
};
