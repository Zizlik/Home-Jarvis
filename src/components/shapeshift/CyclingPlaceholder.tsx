"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { tween } from "@/lib/motion";

const EXAMPLES = [
  "večeře s Petrem v pátek v 8 večer přes zoom",
  "koupit mléko, vejce a chleba",
  "25 minut soustředění",
  "teplá oranžová jako západ slunce",
  "rozděl 2400 Kč mezi 3",
  "kolik je 18 % z 3450",
  "5 mil na km",
  "utratil jsem 450 za taxi",
  "posilovna 3x týdně",
  "let do Barcelony příští víkend",
  "pizza nebo burgery na pátek?",
  "kolik dní do Vánoc",
  "15:00 v Praze kolik je v Tokiu",
  "hoď 2 kostkami",
  "přečíst 12 knih letos, 4 hotové",
  "připomeň mi zaplatit nájem zítra",
];

export function CyclingPlaceholder() {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    // Auto-rotating text is autoplay: reduced motion keeps the first example still.
    if (reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % EXAMPLES.length), 2800);
    return () => clearInterval(id);
  }, [reduce]);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 start-5 end-5 flex items-center overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.span
          key={i}
          className="absolute truncate text-[22px] leading-8 font-[450] tracking-[-0.01em] text-muted-foreground"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, filter: "blur(4px)" }}
          transition={reduce ? tween.fade : tween.crossfade}
        >
          {EXAMPLES[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
