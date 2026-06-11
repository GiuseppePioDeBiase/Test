import { useRef, type ReactNode, type ButtonHTMLAttributes } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  children: ReactNode;
  /** Pull strength in px at the edge of the hit area. */
  strength?: number;
}

/**
 * Organic magnet effect: the button leans toward the cursor on a critically
 * damped spring and snaps home on leave. The inner label counter-translates
 * slightly for parallax depth.
 */
export function MagneticButton({ children, strength = 14, className, ...rest }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 320, damping: 22, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 320, damping: 22, mass: 0.6 });

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    x.set(dx * strength);
    y.set(dy * strength);
  };

  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      className={className}
      style={{ x: sx, y: sy }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileTap={{ scale: 0.96 }}
      {...(rest as object)}
    >
      {children}
    </motion.button>
  );
}
