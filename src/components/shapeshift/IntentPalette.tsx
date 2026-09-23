"use client";

import { NotebookPen, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { CARD_INTENTS, registry } from "@/components/intents/registry";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { CardIntent } from "@/lib/jev/types";

/** Jarvis's other screens, listed above the card types. */
const TOOLS = [
  { href: "/meeting", label: "Meeting", hint: "poslouchá a píše zápis z meetingu", icon: NotebookPen, keywords: "meeting schůzka porada zápis přepis" },
  { href: "/nastaveni", label: "Nastavení", hint: "hlas, Google, MCP servery", icon: Settings, keywords: "nastavení settings google mcp hlas" },
];

/**
 * "/" opens every UI type — a manual override and a gallery in one — plus Jarvis's tools.
 * Keyboard-summoned and used often, so it opens without animation.
 */
export function IntentPalette({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (intent: CardIntent) => void;
}) {
  const router = useRouter();
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nástroje a karty"
      description="Otevřít nástroj, nebo zobrazit vstup jako konkrétní typ karty"
      className="shadow-[var(--shadow-float)] data-closed:animate-none data-open:animate-none sm:max-w-[480px]"
    >
      {/* shadcn's CommandDialog no longer includes the cmdk root; without it cmdk has no store. */}
      <Command>
        <CommandInput placeholder="Otevřít nebo zobrazit jako…" className="text-base sm:text-sm" />
        <CommandList className="max-h-[420px] overscroll-contain">
          <CommandEmpty>Žádný typ karty neodpovídá. Zkuste „časovač“ nebo „anketa“.</CommandEmpty>
          <CommandGroup heading="Nástroje">
            {TOOLS.map((t) => (
              <CommandItem
                key={t.href}
                value={`${t.label} ${t.keywords}`}
                onSelect={() => {
                  onOpenChange(false);
                  router.push(t.href);
                }}
                className="min-h-12 gap-3"
              >
                <span className="bg-secondary text-foreground grid size-8 shrink-0 place-items-center rounded-sm">
                  <t.icon className="size-[18px]" aria-hidden />
                </span>
                <span className="w-28 shrink-0 text-[14px] font-medium">{t.label}</span>
                <span className="text-muted-foreground min-w-0 text-[13px] text-pretty">{t.hint}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Karty">
            {CARD_INTENTS.map((intent) => {
              const def = registry[intent];
              const Icon = def.icon;
              return (
                <CommandItem
                  key={intent}
                  value={`${def.label} ${intent} ${def.example}`}
                  onSelect={() => onPick(intent)}
                  className="min-h-12 gap-3"
                >
                  <span className="bg-secondary text-foreground grid size-8 shrink-0 place-items-center rounded-sm">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="w-28 shrink-0 text-[14px] font-medium">{def.label}</span>
                  <span className="text-muted-foreground min-w-0 text-[13px] text-pretty">{def.example}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
