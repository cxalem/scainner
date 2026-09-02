// Motion building blocks. Views compose these instead of touching
// framer-motion directly, so every appear/leave in the app uses the shared
// vocabulary from ./index.ts and the "no layout shift" rule is enforced by
// construction:
//
//   <Page>            the screen's stagger container; every direct child
//     <Block>         rises in on mount and SLIDES (never jumps) when a
//     <Block>         sibling above it appears or disappears
//     <Reveal when={x}>   a block that exists only while `when` is true —
//        …             rises in, fades out, and pushes siblings smoothly
//     </Reveal>
//   </Page>
//
//   <Swap k={state}>  the same slot showing different content per state
//                     (idle → running → done) — cross-fades instead of cutting
//
//   <Grow when={x}>   a group that OPENS: it grows from nothing to whatever
//                     its content measures, and keeps following that
//                     measurement, so everything below it is pushed down by
//                     the growth itself instead of jumping out of the way
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  appearVariants,
  fadeVariants,
  growTransition,
  layoutTransition,
  pageBlock,
  pageContainer,
  staggerContainer,
  staggerItem,
} from "./index";

type DivProps = Omit<HTMLMotionProps<"div">, "variants" | "initial" | "animate" | "exit">;

/** The stagger container for one screen. Re-key it (`key={view}`) to replay
 *  the entrance when the screen changes. */
export function Page({ children, ...rest }: DivProps & { children: ReactNode }) {
  return (
    <motion.div initial="hidden" animate="visible" exit="exit" variants={pageContainer} {...rest}>
      {children}
    </motion.div>
  );
}

/** One top-level block of a screen. Rises in with the page's stagger; slides
 *  to its new place when siblings change (layout="position", never bare
 *  `layout`). */
export function Block({ children, ...rest }: DivProps & { children: ReactNode }) {
  return (
    <motion.div layout="position" transition={layoutTransition} variants={pageBlock} {...rest}>
      {children}
    </motion.div>
  );
}

/** Conditional content that animates in and out and pushes its siblings
 *  smoothly. Use for expanders, forms that open, results that land. */
export function Reveal({
  when,
  children,
  mode = "rise",
  ...rest
}: DivProps & { when: boolean; children: ReactNode; mode?: "rise" | "fade" }) {
  return (
    <AnimatePresence initial={false}>
      {when && (
        <motion.div
          layout="position"
          transition={layoutTransition}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={mode === "rise" ? appearVariants : fadeVariants}
          {...rest}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A group that opens by growing out of nothing, for the case <Reveal> does
 *  not cover: content that appears ABOVE a list the user is already looking
 *  at. Reveal fades a block in at its full height and lets the siblings
 *  below FLIP into their new places; Grow animates the box itself, so the
 *  rows below are carried down by ordinary layout — no `layout` prop on
 *  anything, no second measurement fighting the first.
 *
 *  It keeps measuring after it has opened, so a line inside it changing (a
 *  countdown becoming a result, a field opening on a row) resizes the group
 *  smoothly too instead of snapping.
 *
 *  Under prefers-reduced-motion it just cuts: MotionConfig's
 *  reducedMotion="user" only neutralises transforms, and height is not one.
 *
 *  `className` styles the measured content, not the animating box — put the
 *  group's own spacing there so it collapses with the group. */
export function Grow({
  when,
  children,
  className,
  ...rest
}: DivProps & { when: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {when && (
        <GrowBox className={className} {...rest}>
          {children}
        </GrowBox>
      )}
    </AnimatePresence>
  );
}

function GrowBox({
  children,
  className,
  ...rest
}: DivProps & { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  // Measured, never guessed: the content's own height is the target, read
  // before paint on mount and again whenever it changes.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    setHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      style={{ overflow: "hidden" }}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={reduced ? { duration: 0 } : growTransition}
      {...rest}
    >
      <div ref={inner} className={className}>
        {children}
      </div>
    </motion.div>
  );
}

/** One slot, many states: the child for the current `k` cross-fades in as
 *  the previous one fades out ("wait" mode, so the two never overlap). */
export function Swap({ k, children, ...rest }: DivProps & { k: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={k} initial="hidden" animate="visible" exit="exit" variants={appearVariants} {...rest}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** A list whose rows appear one after another. Pair with <Row>. */
export function Stagger({ children, ...rest }: DivProps & { children: ReactNode }) {
  return (
    <motion.div initial="hidden" animate="visible" variants={staggerContainer} {...rest}>
      {children}
    </motion.div>
  );
}
export function Row({ children, ...rest }: DivProps & { children: ReactNode }) {
  return (
    <motion.div variants={staggerItem} layout="position" transition={layoutTransition} {...rest}>
      {children}
    </motion.div>
  );
}

/** A list where items can be added/removed at runtime (scan results, log
 *  lines, cases): new items rise in, removed ones fade, the rest slide. */
export function List({ children, ...rest }: DivProps & { children: ReactNode }) {
  return (
    <motion.div layout="position" {...rest}>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </motion.div>
  );
}
export function Item({ children, ...rest }: DivProps & { children: ReactNode }) {
  return (
    <motion.div
      layout="position"
      transition={layoutTransition}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={staggerItem}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
