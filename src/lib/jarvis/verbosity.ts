/** How much Jarvis talks: remembered per browser, switched by voice or in settings. */
export type Verbosity = "normal" | "brief" | "silent";

const KEY = "jarvis.verbosity";
const listeners = new Set<() => void>();

export function getVerbosity(): Verbosity {
  try {
    const v = localStorage.getItem(KEY);
    return v === "brief" || v === "silent" ? v : "normal";
  } catch {
    return "normal";
  }
}

export function setVerbosity(v: Verbosity) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // private mode: holds for this visit only
  }
  listeners.forEach((l) => l());
}

export const subscribeVerbosity = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const VERBOSITY_LABEL: Record<Verbosity, string> = { normal: "Normálně", brief: "Stručně", silent: "Potichu" };

/** Instructions appended to the live session. */
export const VERBOSITY_INSTRUCTIONS: Record<Verbosity, string> = {
  normal: "Mluv jako obvykle: krátce a věcně.",
  brief: "Mluv co nejméně. Na povely jen „Hotovo.“. Na otázky jedna krátká věta, maximálně deset slov. Nic nekomentuj, na nic se neptej, nic neopakuj.",
  silent:
    "Tichý režim: na povely (zapsat, uložit, zahodit, upravit, časovač) NEODPOVÍDEJ vůbec, aplikace je potvrdí zvukem. Mluv jen když odpovídáš na otázku, a to jednou krátkou větou.",
};

/** "mluv méně", "nekecej" → brief; "mlč", "tichý režim" → silent; "mluv normálně" → normal. */
export function verbosityCommand(u: string): Verbosity | null {
  const t = u.toLowerCase();
  if (/(mluv|mluvte)\s+(normáln\p{L}*|normaln\p{L}*|víc|vic|klidně víc)|normální režim|normalni rezim|můžeš mluvit|muzes mluvit/u.test(t)) return "normal";
  if (/nemluv\s+(tolik|tak\s+moc|moc)|nekecej|nekecejte/u.test(t)) return "brief";
  if (/(?<![\p{L}])(mlč|mlc|mlčte|tichý režim|tichy rezim|potichu|jen zvuk\p{L}*|nemluv)(?![\p{L}])/u.test(t)) return "silent";
  if (/(mluv|mluvte)\s+(méně|mene|míň|min|stručn\p{L}*|strucn\p{L}*|krátce|kratce)|(buď|bud)\s+(stručn\p{L}*|strucn\p{L}*)|nekecej|nekecejte|stručný režim|strucny rezim|méně mluv|mene mluv/u.test(t)) return "brief";
  return null;
}
