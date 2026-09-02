import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  appearVariants,
  fadeVariants,
  growBoxStyle,
  growTransition,
  layoutTransition,
  pageBlock,
  pageContainer,
  staggerContainer,
  staggerItem,
} from "./index";

type DivProps = Omit<HTMLMotionProps<"div">, "variants" | "initial" | "animate" | "exit">;

export function Page({ children, ...rest }: DivProps & { children: ReactNode }) {
  return (
    <motion.div initial="hidden" animate="visible" exit="exit" variants={pageContainer} {...rest}>
      {children}
    </motion.div>
  );
}

export function Block({ children, ...rest }: DivProps & { children: ReactNode }) {
  return (
    <motion.div layout="position" transition={layoutTransition} variants={pageBlock} {...rest}>
      {children}
    </motion.div>
  );
}

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
      style={growBoxStyle}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      // MotionConfig reducedMotion="user" neutralises transforms but not height animation.
      transition={reduced ? { duration: 0 } : growTransition}
      {...rest}
    >
      <div ref={inner} className={className}>
        {children}
      </div>
    </motion.div>
  );
}

export function Swap({ k, children, ...rest }: DivProps & { k: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={k} initial="hidden" animate="visible" exit="exit" variants={appearVariants} {...rest}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

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
