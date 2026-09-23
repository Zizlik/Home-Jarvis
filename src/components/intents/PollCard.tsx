"use client";

import { motion, useReducedMotion } from "motion/react";
import { Progress } from "@/components/ui/progress";
import type { PollData } from "@/lib/parse/poll";
import { spring, tween } from "@/lib/motion";
import { Field, Placeholder } from "./shared";
import type { CardProps } from "./types";

export function PollCard({ data, signals }: CardProps<PollData>) {
  const reduce = useReducedMotion();
  const options = data.options.length ? data.options : signals.hasExplicitOptions ? [] : ["", ""];

  return (
    <div className="flex flex-col gap-2">
      <Field index={0}>
        <h2 className="text-[17px] leading-6 font-[550] text-balance">{data.title || "Zeptejte se skupiny"}</h2>
      </Field>
      <div className="flex flex-col">
        {options.map((o, i) => (
          <motion.div
            key={`${i}-${o}`}
            layout="position"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={reduce ? tween.fade : { ...spring.settle, delay: 0.06 + i * 0.04 }}
            className="flex min-h-10 flex-col justify-center gap-1.5 py-1"
          >
            <div className="flex items-center justify-between text-[15px] leading-5">
              <span className={o ? "" : "text-muted-foreground"}>{o || `Možnost ${i + 1}`}</span>
              <span className="text-[13px] font-medium text-muted-foreground tabular-nums">0 %</span>
            </div>
            <Progress value={0} className="h-1 bg-secondary" aria-label={`Hlasy: ${o || `možnost ${i + 1}`}`} />
          </motion.div>
        ))}
      </div>
      <div className="flex h-10 items-center">
        <Placeholder insert=" nebo ">Přidat možnost</Placeholder>
      </div>
    </div>
  );
}
