"use client";

import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { HabitData } from "@/lib/parse/habit";
import { Chip, Field, Missing, Placeholder } from "./shared";
import { Repeat } from "lucide-react";
import type { CardProps } from "./types";

const WEEK = [
  { i: 1, l: "Po", n: "Pondělí" },
  { i: 2, l: "Út", n: "Úterý" },
  { i: 3, l: "St", n: "Středa" },
  { i: 4, l: "Čt", n: "Čtvrtek" },
  { i: 5, l: "Pá", n: "Pátek" },
  { i: 6, l: "So", n: "Sobota" },
  { i: 0, l: "Ne", n: "Neděle" },
];

export function HabitCard({ data, interactive }: CardProps<HabitData>) {
  const [days, setDays] = useState<string[] | null>(null);
  const key = data.days.join(",");
  const [prev, setPrev] = useState(key);
  if (prev !== key) {
    setPrev(key);
    setDays(null);
  }
  const value = days ?? data.days.map(String);

  return (
    <div className="flex flex-col gap-3">
      <Field index={0} className="flex flex-wrap items-center justify-between gap-3">
        {data.title ? <h2 className="text-[17px] leading-6 font-[550] text-balance">{data.title}</h2> : <Missing>Návyk bez názvu</Missing>}
        {data.label ? <Chip icon={Repeat}>{data.label}</Chip> : <Placeholder insert=" každý den">Přidat, jak často</Placeholder>}
      </Field>
      <Field index={1}>
        <ToggleGroup
          type="multiple"
          value={value}
          onValueChange={setDays}
          disabled={!interactive}
          className="flex-wrap gap-1.5"
          aria-label="Dny v týdnu"
        >
          {WEEK.map((d) => (
            <ToggleGroupItem
              key={d.i}
              value={String(d.i)}
              aria-label={d.n}
              className="size-9 rounded-full! border border-border text-[13px] font-medium text-muted-foreground data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
            >
              {d.l}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
    </div>
  );
}
