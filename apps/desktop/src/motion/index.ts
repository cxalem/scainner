import type { Transition, Variants } from "framer-motion";

export const DURATION = {
  fast: 0.15,
  base: 0.22,
  slow: 0.32,
  page: 0.36,
} as const;

export const EASE_OUT: Transition["ease"] = [0.2, 0.8, 0.2, 1];

export const fadeTransition: Transition = { duration: DURATION.fast, ease: "easeOut" };
export const settleTransition: Transition = { duration: DURATION.base, ease: EASE_OUT };
export const riseTransition: Transition = { duration: DURATION.slow, ease: EASE_OUT };
export const pageTransition: Transition = { duration: DURATION.page, ease: EASE_OUT };
export const layoutTransition: Transition = { duration: 0.34, ease: EASE_OUT };
export const growTransition: Transition = {
  height: { duration: DURATION.slow, ease: EASE_OUT },
  opacity: { duration: DURATION.base, ease: EASE_OUT },
};
// Non-visible overflow makes the flex auto-minimum zero, so flexShrink: 0 keeps the box from collapsing.
export const growBoxStyle = { overflow: "hidden", flexShrink: 0 } as const;

export const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: fadeTransition },
  exit: { opacity: 0, transition: fadeTransition },
};
export const modalPanelVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, transition: fadeTransition },
};

export const appearVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: riseTransition },
  exit: { opacity: 0, y: 4, transition: fadeTransition },
};

export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: settleTransition },
  exit: { opacity: 0, transition: fadeTransition },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: fadeTransition },
  exit: { opacity: 0, transition: fadeTransition },
};

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


export const screenVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: "easeOut" } },
};
