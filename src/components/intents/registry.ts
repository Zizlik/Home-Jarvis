import {
  AlarmClock,
  CalendarClock,
  Dices,
  Globe,
  Target,
  Bell,
  Briefcase,
  CalendarDays,
  Calculator,
  CircleAlert,
  Coffee,
  Contact,
  Focus,
  Link2,
  ListChecks,
  Palette,
  Repeat,
  Ruler,
  ShoppingCart,
  StickyNote,
  Sun,
  Timer,
  Users,
  Vote,
  Wallet,
} from "lucide-react";
import type { CardIntent } from "@/lib/jev/types";
import { formatAmount } from "@/lib/parse/common";
import { UNIT_LABELS } from "@/lib/parse/convert";
import { formatClock } from "@/lib/parse/timer";
import { capitalize, count, formatNumber, formatTimeIn, unitLabel } from "@/lib/i18n";
import type { GatedSignals } from "@/lib/signals";
import { CalcCard } from "./CalcCard";
import { CountdownCard } from "./CountdownCard";
import { GoalCard } from "./GoalCard";
import { describeRandomCs, RandomCard } from "./RandomCard";
import { TimezoneCard } from "./TimezoneCard";
import { ColorPicker } from "./ColorPicker";
import { ContactCard } from "./ContactCard";
import { ConvertCard } from "./ConvertCard";
import { EventCard } from "./EventCard";
import { ExpenseRow } from "./ExpenseRow";
import { HabitCard } from "./HabitCard";
import { CATEGORY_ICON, TRANSPORT_ICON } from "./icons";
import { LinkCard } from "./LinkCard";
import { NoteCard } from "./NoteCard";
import { PollCard } from "./PollCard";
import { ReminderPill } from "./ReminderPill";
import { formatWhen } from "./shared";
import { SplitCard } from "./SplitCard";
import { TimerRing } from "./TimerRing";
import { TodoList } from "./TodoList";
import { TravelCard } from "./TravelCard";
import type { BadgeSpec, Registry } from "./types";

const repeats = (s: GatedSignals): BadgeSpec[] => (s.recurring ? [{ id: "repeat", label: "Opakuje se", icon: Repeat }] : []);
const urgent = (s: GatedSignals): BadgeSpec[] => (s.urgent ? [{ id: "urgent", label: "Urgentní", icon: CircleAlert, tone: "caution" }] : []);

const TONE_LABEL = {
  neutral: "Poznámka",
  positive: "Radostná poznámka",
  excited: "Nadšená poznámka",
  stressed: "Napjatá poznámka",
  reflective: "Zamyšlení",
} as const;

const TONE_EDGE = {
  neutral: null,
  positive: "var(--positive)",
  excited: "var(--brand)",
  stressed: "var(--caution)",
  reflective: "var(--line-strong)",
} as const;

/**
 * intent → everything needed to render it. Adding a UI type means one entry here,
 * one criterion in questions.ts, one parser and one component.
 */
export const registry: Registry = {
  event: {
    label: "Událost",
    example: "večeře s Petrem v pátek v 8 večer přes zoom",
    icon: CalendarDays,
    signals: ["eventMode", "recurring"],
    badges: repeats,
    summary: (d) => [d.title || "Událost", d.date && Object.values(formatWhen(d.date, d.hasTime)).filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    Component: EventCard,
  },
  reminder: {
    label: "Připomínka",
    example: "připomeň mi zaplatit nájem zítra",
    icon: Bell,
    signals: ["urgency", "recurring"],
    badges: (s) => [...urgent(s), ...repeats(s)],
    edge: (s) => (s.urgent ? "var(--caution)" : null),
    summary: (d) => [d.task || "Připomínka", d.when && formatWhen(d.when, d.hasTime).day].filter(Boolean).join(" · "),
    Component: ReminderPill,
  },
  todo: {
    label: "Seznam",
    example: "koupit mléko, vejce a chleba",
    icon: ListChecks,
    signals: ["isShoppingList", "urgency"],
    headerIcon: (s) => (s.isShoppingList ? ShoppingCart : ListChecks),
    headerLabel: (s) => (s.isShoppingList ? "Nákup" : "Seznam"),
    badges: urgent,
    summary: (d) => `${d.title ? `${d.title} · ` : ""}${count(d.items.length, "položka", "položky", "položek")} · ${d.items.slice(0, 3).join(", ")}`,
    Component: TodoList,
  },
  timer: {
    label: "Časovač",
    example: "25 minut soustředění",
    icon: Timer,
    signals: ["timerKind"],
    headerIcon: (s) => (s.timerKind === "focus" ? Focus : s.timerKind === "break" ? Coffee : s.timerKind === "stopwatch" ? AlarmClock : Timer),
    headerLabel: (s) => (s.timerKind === "focus" ? "Soustředění" : s.timerKind === "break" ? "Přestávka" : s.timerKind === "stopwatch" ? "Stopky" : "Časovač"),
    summary: (d) => [d.label || "Časovač", d.seconds && formatClock(d.seconds)].filter(Boolean).join(" · "),
    Component: TimerRing,
  },
  habit: {
    label: "Návyk",
    example: "posilovna 3x týdně",
    icon: Sun,
    signals: [],
    summary: (d) => [d.title || "Návyk", d.label].filter(Boolean).join(" · "),
    Component: HabitCard,
  },
  color: {
    label: "Barva",
    example: "#ff6b35",
    icon: Palette,
    signals: ["colorMood"],
    summary: (d) => [d.name ? capitalize(d.name) : "Barva", d.hex?.toUpperCase()].filter(Boolean).join(" · "),
    Component: ColorPicker,
  },
  split: {
    label: "Rozdělit",
    example: "rozděl 2400 Kč mezi 3",
    icon: Users,
    signals: [],
    summary: (d) =>
      d.total && d.people ? `${formatAmount(d.total, d.currency)} ÷ ${d.people} = ${formatAmount(d.total / d.people, d.currency)} na osobu` : "Rozdělit",
    Component: SplitCard,
  },
  expense: {
    label: "Výdaj",
    example: "utratil jsem 450 za taxi",
    icon: Wallet,
    signals: ["expenseCategory"],
    headerIcon: (s) => (s.expenseCategory ? CATEGORY_ICON[s.expenseCategory] : Wallet),
    summary: (d) => [d.amount !== null && formatAmount(d.amount, d.currency), d.item].filter(Boolean).join(" · ") || "Výdaj",
    Component: ExpenseRow,
  },
  convert: {
    label: "Převod",
    example: "5 mil na km",
    icon: Ruler,
    signals: [],
    summary: (d) =>
      d.value !== null && d.from && d.to && d.result !== null
        ? `${formatNumber(d.value)} ${unitLabel(d.from, UNIT_LABELS)} = ${formatNumber(Number(d.result.toFixed(2)))} ${unitLabel(d.to, UNIT_LABELS)}`
        : "Převod",
    Component: ConvertCard,
  },
  calc: {
    label: "Výpočet",
    example: "kolik je 18 % z 3450",
    icon: Calculator,
    signals: [],
    summary: (d) => (d.result !== null ? `${d.expression} = ${formatNumber(d.result)}` : d.expression),
    Component: CalcCard,
  },
  travel: {
    label: "Cesta",
    example: "let do Barcelony příští víkend",
    icon: TRANSPORT_ICON.flight,
    signals: ["transport", "tripType"],
    headerIcon: (s) => TRANSPORT_ICON[s.transport ?? "unspecified"],
    badges: (s) =>
      s.tripType === "work"
        ? [{ id: "work", label: "Pracovní", icon: Briefcase }]
        : s.tripType === "leisure"
          ? [{ id: "leisure", label: "Dovolená", icon: Sun }]
          : [],
    summary: (d) => (d.destination ? `Cesta: ${d.destination}` : "Cesta"),
    Component: TravelCard,
  },
  poll: {
    label: "Anketa",
    example: "pizza nebo burgery na pátek?",
    icon: Vote,
    signals: ["hasExplicitOptions"],
    summary: (d) => d.title || d.options.join(" / ") || "Anketa",
    Component: PollCard,
  },
  contact: {
    label: "Kontakt",
    example: "Petr 777 123 456 petr@email.cz",
    icon: Contact,
    signals: [],
    summary: (d) => [d.name || "Kontakt", d.phone ?? d.email].filter(Boolean).join(" · "),
    Component: ContactCard,
  },
  link: {
    label: "Záložka",
    example: "https://vercel.com/blog přečíst později",
    icon: Link2,
    signals: [],
    summary: (d) => [d.domain ?? "Odkaz", d.note].filter(Boolean).join(" · "),
    Component: LinkCard,
  },
  countdown: {
    label: "Odpočet",
    example: "kolik dní do Vánoc",
    icon: CalendarClock,
    signals: [],
    summary: (d) =>
      d.days === null
        ? d.title || "Odpočet"
        : d.days === 0
          ? `${d.title ? `${d.title}: ` : ""}dnes`
          : `${count(Math.abs(d.days), "den", "dny", "dní")} ${d.days < 0 ? "od" : "do"} ${d.title || "termínu"}`,
    Component: CountdownCard,
  },
  timezone: {
    label: "Časové pásmo",
    example: "15:00 v Praze kolik je v Tokiu",
    icon: Globe,
    signals: [],
    summary: (d) =>
      d.to && d.instant ? `${formatTimeIn(d.from.tz, d.instant)} ${d.from.label} → ${formatTimeIn(d.to.tz, d.instant)} ${d.to.label}` : "Časová pásma",
    Component: TimezoneCard,
  },
  random: {
    label: "Náhoda",
    example: "hoď 2 kostkami",
    icon: Dices,
    signals: [],
    summary: (d) => describeRandomCs(d),
    Component: RandomCard,
  },
  goal: {
    label: "Cíl",
    example: "přečíst 12 knih letos, 4 hotové",
    icon: Target,
    signals: [],
    summary: (d) => (d.target ? `${d.title || "Cíl"} · ${formatNumber(d.current)}/${formatNumber(d.target)}${d.unit ? ` ${d.unit}` : ""}` : d.title || "Cíl"),
    Component: GoalCard,
  },
  note: {
    label: "Poznámka",
    example: "ve městě bylo dnes ráno krásné ticho",
    icon: StickyNote,
    signals: ["tone", "isQuestion"],
    // The edge color is always paired with a tone word in the header, never color alone.
    headerLabel: (s) => (s.tone ? TONE_LABEL[s.tone] : "Poznámka"),
    edge: (s) => (s.tone ? TONE_EDGE[s.tone] : null),
    summary: (d) => d.title,
    Component: NoteCard,
  },
};

export const CARD_INTENTS = Object.keys(registry) as CardIntent[];
