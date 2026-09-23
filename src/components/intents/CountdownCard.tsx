"use client";

import { CalendarDays } from "lucide-react";
import { capitalize, formatCs, formatNumber, plural } from "@/lib/i18n";
import type { CountdownData } from "@/lib/parse/countdown";
import { AnimatedNumber, Chip, Field, HeroNumber, Meta, Missing } from "./shared";
import type { CardProps } from "./types";

const long = (d: Date) => capitalize(formatCs(d, "EEEE d. MMMM yyyy"));

export function CountdownCard({ data }: CardProps<CountdownData>) {
  if (data.days === null || !data.date) {
    return (
      <Field index={0}>
        <Missing>Napište datum nebo svátek, třeba „kolik dní do Vánoc“</Missing>
      </Field>
    );
  }
  const past = data.days < 0;
  const n = Math.abs(data.days);
  const weeks = Math.floor(n / 7);

  return (
    <div className="flex flex-col gap-3">
      <Field index={0} className="flex flex-wrap items-end gap-x-3 gap-y-1">
        {data.days === 0 ? (
          <HeroNumber className="text-[44px] leading-[48px]">Dnes</HeroNumber>
        ) : (
          <>
            <HeroNumber className="text-[44px] leading-[48px]">
              <AnimatedNumber value={n} format={(v) => formatNumber(Math.round(v))} />
            </HeroNumber>
            <span className="pb-1.5 text-[17px] leading-6 font-[550] text-ink-2">
              {plural(n, "den", "dny", "dní")} {past ? "od" : "do"} {data.title || "termínu"}
            </span>
          </>
        )}
      </Field>
      <Field index={1} className="flex flex-wrap items-center gap-2">
        <Chip icon={CalendarDays}>{long(data.date)}</Chip>
        {weeks >= 2 && (
          <Meta>
            {weeks} {plural(weeks, "týden", "týdny", "týdnů")}{n % 7 ? `, ${n % 7} ${plural(n % 7, "den", "dny", "dní")}` : ""}
          </Meta>
        )}
      </Field>
    </div>
  );
}
