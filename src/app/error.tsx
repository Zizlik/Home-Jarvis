"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-[560px] flex-col items-start gap-3 px-4 pt-[22vh]">
      <h1 className="text-[17px] leading-6 font-[550]">Shapeshift se nepodařilo načíst</h1>
      <p className="text-[15px] leading-[22px] text-ink-2">Při vykreslování se něco pokazilo. Uložené položky jsou v tomto prohlížeči v bezpečí.</p>
      <Button size="sm" onClick={() => retry()} className="px-4">
        Zkusit znovu
      </Button>
    </main>
  );
}
