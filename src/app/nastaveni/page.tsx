import type { Metadata } from "next";
import { Settings } from "@/components/jarvis/Settings";

export const metadata: Metadata = { title: "Nastavení · Jarvis" };

export default function SettingsPage() {
  return <Settings />;
}
