import { useCallback, useEffect, useRef, useState } from "react";

const GLYPHS = "█▓▒░<>/\\|=+*#@$%&0123456789";

/**
 * Sci-fi text decode effect: characters churn through glyph noise and lock
 * into place left-to-right. Fires on mount and re-arms on hover.
 */
export function ScrambleText({
  text,
  as: Tag = "span",
  className,
  rearmOnHover = true,
  speed = 28,
}: {
  text: string;
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  rearmOnHover?: boolean;
  speed?: number;
}) {
  const [display, setDisplay] = useState(text);
  const frame = useRef<number | null>(null);
  const running = useRef(false);

  const scramble = useCallback(() => {
    if (running.current) return;
    running.current = true;
    const start = performance.now();
    const total = text.length * speed + 220;
    const step = (now: number) => {
      const t = now - start;
      const locked = Math.floor((t / total) * text.length * 1.4);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === " " || i < locked) out += ch;
        else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setDisplay(out);
      if (locked < text.length) {
        frame.current = requestAnimationFrame(step);
      } else {
        setDisplay(text);
        running.current = false;
      }
    };
    frame.current = requestAnimationFrame(step);
  }, [text, speed]);

  useEffect(() => {
    setDisplay(text);
    scramble();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      running.current = false;
    };
  }, [text, scramble]);

  return (
    <Tag
      className={className}
      onMouseEnter={rearmOnHover ? scramble : undefined}
      aria-label={text}
    >
      {display}
    </Tag>
  );
}
