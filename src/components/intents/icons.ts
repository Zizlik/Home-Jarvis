import {
  Bus,
  Car,
  Clapperboard,
  HeartPulse,
  type LucideIcon,
  Plane,
  Receipt,
  ShoppingBag,
  TrainFront,
  Utensils,
  Wallet,
} from "lucide-react";
import type { ExpenseCategory, Transport } from "@/lib/jev/types";

export const CATEGORY_ICON: Record<ExpenseCategory, LucideIcon> = {
  food: Utensils,
  transport: Car,
  shopping: ShoppingBag,
  bills: Receipt,
  entertainment: Clapperboard,
  health: HeartPulse,
  other: Wallet,
};

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  food: "Jídlo a pití",
  transport: "Doprava",
  shopping: "Nákupy",
  bills: "Účty",
  entertainment: "Zábava",
  health: "Zdraví",
  other: "Ostatní",
};

export const TRANSPORT_ICON: Record<Transport, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  car: Car,
  unspecified: Plane,
};
