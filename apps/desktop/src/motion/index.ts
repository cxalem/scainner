// One motion vocabulary, reused everywhere something appears, changes or
// leaves. Components never pick their own duration/easing — they use a
// variant from here (or a component from ./components.tsx), so the whole
// flow reads as one continuous motion rather than a set of unrelated cuts.
//
// The numbers mirror theme/tokens.css (--dur-*, --ease-out). Keep both in
// sync: CSS owns ambient/looping motion (spin, glow, sweep), framer-motion
// owns discrete appear/leave and layout motion because that needs real
// sequencing (stagger) and FLIP-style position tracking that CSS cannot do.
//
// Rules learned the hard way (docs/workflows/animation-system/plan.md):
// - `layout="position"` on the things that need to slide, never bare
//   `layout` on a container — bare `layout` interpolates the box SIZE too
//   and visibly stretches everything inside it.
// - Motion must never cause layout shift: things that appear push their
//   siblings smoothly (siblings carry layout="position"), they never jump.
// - `MotionConfig reducedMotion="user"` in main.tsx handles
//   prefers-reduced-motion for every motion.* element from one place.
import type { Transition, Variants } from "framer-motion";

export const DURATION = {
  fast: 0.15,
  base: 0.22,
  slow: 0.32,
  page: 0.36,
} as const;

/** The design's one easing: a soft decelerate. Content settles in. */
export const EASE_OUT: Transition["ease"] = [0.2, 0.8, 0.2, 1];

export const fadeTransition: Transition = { duration: DURATION.fast, ease: "easeOut" };
export const settleTransition: Transition = { duration: DURATION.base, ease: EASE_OUT };
export const riseTransition: Transition = { duration: DURATION.slow, ease: EASE_OUT };
export const pageTransition: Transition = { duration: DURATION.page, ease: EASE_OUT };
/** For `layout="position"` slides when a sibling mounts/unmounts. */
export const layoutTransition: Transition = { duration: 0.34, ease: EASE_OUT };
/** For a group that opens by GROWING (see <Grow>): the height carries the
 *  motion at a rise's pace, the opacity only takes the edge off it. Height
 *  is the one non-transform property this app animates — it is what moves
 *  the rows below out of the way, and no transform does that. */
export const growTransition: Transition = {
  height: { duration: DURATION.slow, ease: EASE_OUT },
  opacity: { duration: DURATION.base, ease: EASE_OUT },
};
/** The <Grow> box's own style. Both properties are load-bearing, and they
 *  are a pair.
 *
 *  `overflow: hidden` is what turns an animated height into a reveal instead
 *  of a squash. It is also what makes `flexShrink: 0` mandatory: a flex item
 *  whose overflow is not `visible` has an automatic minimum size of 0, so in
 *  a `flex flex-col` parent whose other children already fill it, flexbox is
 *  free to shrink the box from its measured height back to nothing. The
 *  animation still runs and the inline height is still right — there is
 *  simply nothing on screen. That is how the device screen lost its scanning
 *  row (Brief P, 2026-09-02); grow.test.ts pins it. */
export const growBoxStyle = { overflow: "hidden", flexShrink: 0 } as const;

// --- Modals -----------------------------------------------------------------
// Backdrop: fade only — the dimming is the cue, motion on it would be noise.
export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: fadeTransition },
  exit: { opacity: 0, transition: fadeTransition },
};
// Panel: a small rise instead of popping to 100% instantly.
export const modalPanelVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, transition: fadeTransition },
};

// --- Content appearing in place ---------------------------------------------
/** A block of content that just became available (a section resolving, a
 *  card mounting once its data is ready, an expander opening). Rise + fade
 *  in; fade out. */
export const appearVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: riseTransition },
  exit: { opacity: 0, y: 4, transition: fadeTransition },
};

/** Fade only — for a line of text or a chip swapping in place. */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: settleTransition },
  exit: { opacity: 0, transition: fadeTransition },
};

// --- Sequences ---------------------------------------------------------------
/** Wrap a list in staggerContainer, each item in staggerItem: a field-by-
 *  field reveal (discovery rows, scan steps, connection log lines). */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: fadeTransition },
  exit: { opacity: 0, transition: fadeTransition },
};

// --- Page / screen changes ---------------------------------------------------
/** A screen's top-level blocks rise in one after another when the screen
 *  mounts (tab switch, gate → shell). 40 ms apart, 360 ms each. */
export const pageContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
  exit: { transition: { staggerChildren: 0, when: "afterChildren" } },
};
export const pageBlock: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: pageTransition },
  exit: { opacity: 0, transition: fadeTransition },
};

// --- Messages over the layout ------------------------------------------------
/** A toast: it arrives from the edge it sits on and leaves the same way,
 *  with a hair of scale so it reads as landing rather than sliding past.
 *  Nothing under it moves — the whole point of a toast. */
export const toastVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: riseTransition },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: fadeTransition },
};

/** Full-screen gate ↔ gate ↔ shell handoff: cross-fade with a tiny rise. */
export const screenVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: "easeOut" } },
};
