import type { CardIntent } from "@/lib/jev/types";

/**
 * Czech → parser English, deterministic and instant.
 *
 * The value parsers (chrono, regexes) read English. Jev already knows which card the
 * text is, so the rewrite only touches what that card's parser needs: dates, times,
 * numbers, units and the few command words. Content (items, names, titles) stays Czech.
 * Every pattern also matches text typed without diacritics ("zitra", "patek").
 */

// ── Pattern helpers ─────────────────────────────────────────

const LOOSE: Record<string, string> = {
  á: "[áa]", č: "[čc]", ď: "[ďd]", é: "[ée]", ě: "[ěe]", í: "[íi]", ň: "[ňn]", ó: "[óo]",
  ř: "[řr]", š: "[šs]", ť: "[ťt]", ú: "[úuů]", ů: "[ůuú]", ý: "[ýy]", ž: "[žz]",
};

/** Regex source where every Czech letter also matches its plain form. */
const cz = (src: string) => src.replace(/[áčďéěíňóřšťúůýž]/g, (c) => LOOSE[c]);

/** Whole-word, case-insensitive, Unicode-aware regex. */
const w = (src: string) => new RegExp(`(?<![\\p{L}\\d])(?:${cz(src)})(?![\\p{L}\\d])`, "giu");

type Rule = [RegExp, string | ((...m: string[]) => string)];
const apply = (text: string, rules: Rule[]) =>
  rules.reduce((t, [re, to]) => t.replace(re, to as never), text);

/** Strip diacritics and lowercase, for dictionary lookups. */
export const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// ── Numbers ─────────────────────────────────────────────────

const NUMBER_LIST: [string, number][] = [
  ["jeden|jedna|jedno|jednu", 1], ["dva|dvě|dvou|dvěma", 2], ["tři|třech|třem|třemi", 3], ["čtyři|čtyřech|čtyřem", 4],
  ["pět|pěti", 5], ["šest|šesti", 6], ["sedm|sedmi", 7], ["osm|osmi", 8], ["devět|devíti", 9], ["deset|deseti", 10],
  ["jedenáct", 11], ["dvanáct", 12], ["patnáct", 15], ["dvacet", 20], ["třicet", 30], ["čtyřicet", 40], ["padesát", 50], ["sto", 100],
];
const NUMBER_WORDS: Record<string, number> = Object.fromEntries(NUMBER_LIST.flatMap(([f, n]) => f.split("|").map((x) => [plain(x), n])));
const NUMBER_RE = w(NUMBER_LIST.map(([f]) => f).join("|"));

function numbers(text: string) {
  return apply(text, [
    // "2 400" → "2400" (not phone numbers like "777 123 456")
    [/(?<![\d ]\d|\d )(\d{1,3}) (\d{3})(?![\d]| \d)/g, "$1$2"],
    // decimal comma: "12,50" → "12.50"
    [/(\d),(\d{1,2})(?!\d)/g, "$1.$2"],
    [w("(\\d+(?:\\.\\d+)?)\\s*(?:tisíc|tis\\.?)"), (_, n) => `${n}k`],
    [w("(\\d+(?:\\.\\d+)?)\\s*(?:milionů|miliony|milion|mil\\.)"), (_, n) => String(Number(n) * 1_000_000)],
    [NUMBER_RE, (m) => String(NUMBER_WORDS[plain(m)] ?? m)],
    [w("korun|korunami|kč|czk|,-"), "Kč"],
  ]);
}

// ── Dates and times (every card that has a date) ────────────

const DAYS: [string, string][] = [
  ["pondělí|pondělka|pondělku|pondělím", "monday"],
  ["úterý|úterka|úterku|úterým", "tuesday"],
  ["středa|středu|středy|středě|středou", "wednesday"],
  ["čtvrtek|čtvrtka|čtvrtku|čtvrtkem", "thursday"],
  ["pátek|pátku|pátkem|pátka", "friday"],
  ["sobota|sobotu|soboty|sobotě|sobotou", "saturday"],
  ["neděle|neděli|nedělí", "sunday"],
];
const DAY_ALT = DAYS.map(([cs]) => cs).join("|");
const dayEn = (m: string) => DAYS.find(([cs]) => w(cs).test(m))?.[1] ?? m;

const MONTHS: [string, string][] = [
  ["leden|ledna|lednu|lednem", "January"],
  ["únor|února|únoru|únorem", "February"],
  ["březen|března|březnu|březnem", "March"],
  ["duben|dubna|dubnu|dubnem", "April"],
  ["květen|května|květnu|květnem", "May"],
  ["červen|června|červnu|červnem", "June"],
  ["červenec|července|červenci|červencem", "July"],
  ["srpen|srpna|srpnu|srpnem", "August"],
  ["září|zářím", "September"],
  ["říjen|října|říjnu|říjnem", "October"],
  ["listopad|listopadu|listopadem", "November"],
  ["prosinec|prosince|prosinci|prosincem", "December"],
];
// Longest first so "července" wins over "červen".
const MONTH_ALT = MONTHS.flatMap(([cs]) => cs.split("|")).sort((a, b) => b.length - a.length).join("|");
const monthEn = (m: string) => MONTHS.find(([cs]) => cs.split("|").some((f) => plain(f) === plain(m)))?.[1] ?? m;
const MONTH_BY_NUMBER = MONTHS.map(([, en]) => en);

const HALF_LIST = ["jedné", "druhé", "třetí", "čtvrté", "páté", "šesté", "sedmé", "osmé", "deváté", "desáté", "jedenácté", "dvanácté"];
/** "půl třetí" = 2:30: the half hour before the named hour. */
const HALF_HOURS: Record<string, number> = Object.fromEntries(HALF_LIST.map((x, i) => [plain(x), i === 0 ? 12 : i]));

/** 24h clock from a Czech hour and part of day. */
function clock(h: number, m: number, part?: string) {
  const p = part ? plain(part) : "";
  if ((p === "odpoledne" || p === "vecer") && h < 12) h += 12;
  if (p === "v noci" && h >= 7 && h < 12) h += 12;
  return `at ${h}:${String(m).padStart(2, "0")}`;
}

const PART = "ráno|dopoledne|odpoledne|večer|v noci";

function dates(text: string) {
  return apply(text, [
    // relative days
    [w("pozítří"), "in 2 days"],
    [w("zítra|zejtra"), "tomorrow"],
    [w("(?:dnes|dneska) večer|večer dnes"), "tonight"],
    [w("dnes|dneska"), "today"],
    [w("včera"), "yesterday"],
    [w("za (\\d+) (?:dní|dny|dnů|den)"), "in $1 days"],
    [w("za (\\d+) (?:týdnů|týdny|týden)"), "in $1 weeks"],
    [w("za týden"), "in 1 week"],
    [w("za (\\d+) (?:měsíců|měsíce|měsíc)"), "in $1 months"],
    [w("za měsíc"), "in 1 month"],
    [w("za (\\d+) (?:hodin|hodiny|hodinu)"), "in $1 hours"],
    [w("za hodinu"), "in 1 hour"],
    [w("za (\\d+) (?:minut|minuty|minutu|min)"), "in $1 minutes"],
    [w("za půl hodiny"), "in 30 minutes"],
    // weeks and weekends
    [w("(?:o|na|tento|tenhle|tenhle|tenhleten) víkend(?:u)?"), "this weekend"],
    [w("příští víkend|přístí víkend|na příští víkend"), "next weekend"],
    [w("příští týden|přístí týden"), "next week"],
    [w("(?:tento|tenhle) týden"), "this week"],
    [w("příští měsíc"), "next month"],
    [w("příští rok|napřesrok"), "next year"],
    // weekdays: "příští pátek", "v pátek", "do pátku"
    [w(`(?:příští|přístí) (${DAY_ALT})`), (_, d) => `next ${dayEn(d)}`],
    [w(`(?:tento|tuto|toto|tenhle|tuhle) (${DAY_ALT})`), (_, d) => `this ${dayEn(d)}`],
    [w(`od (${DAY_ALT}) do (${DAY_ALT})`), (_, a, b) => `from ${dayEn(a)} to ${dayEn(b)}`],
    [w(`(?:v|ve|na|v tento|v tuto) (${DAY_ALT})`), (_, d) => dayEn(d)],
    [w(`do (${DAY_ALT})`), (_, d) => `by ${dayEn(d)}`],
    [w(DAY_ALT), (d) => dayEn(d)],
    // dates: "15. 10.", "15.10.2026", "15. října"
    [/(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}))?(?!\d)/g, (_, d, m, y) =>
      Number(m) >= 1 && Number(m) <= 12 ? `${MONTH_BY_NUMBER[Number(m) - 1]} ${Number(d)}${y ? ` ${y}` : ""}` : _],
    [w(`(\\d{1,2})\\.?\\s*(${MONTH_ALT})(?:\\s+(\\d{4}))?`), (_, d, m, y) => `${monthEn(m)} ${Number(d)}${y ? ` ${y}` : ""}`],
    [w(`(?:v|ve|během) (${MONTH_ALT})`), (_, m) => `in ${monthEn(m)}`],
    // times
    [w("ve dvanáct v poledne|12 v poledne|(?:v|ve|o|kolem|okolo)? ?poledne"), "at noon"],
    [w("(?:o|v|kolem)? ?půlnoci|půlnoc"), "at midnight"],
    [w(`(?:v|ve|od|kolem|okolo|na)?\\s*půl (${HALF_LIST.join("|")})(?:\\s+(${PART}))?`), (_, h, part) =>
      clock(HALF_HOURS[plain(h)] ?? 0, 30, part)],
    [w(`(?:v|ve|od|kolem|okolo)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?!\\s*(?:min|hours|sec|km|kg|%|Kč|dní|dny|days|people|lidí|osob|x))(?:\\s*(?:hodin|hod\\.?|h))?(?:\\s+(${PART}))?`), (_, h, m, part) =>
      Number(h) <= 24 ? clock(Number(h), Number(m ?? 0), part) : _],
    [w(`(\\d{1,2})(?:[:.](\\d{2}))?\\s+(${PART})`), (_, h, m, part) => clock(Number(h), Number(m ?? 0), part)],
    [w("ráno|dopoledne"), "morning"],
    [w("odpoledne"), "afternoon"],
    [w("večer"), "evening"],
    [w("v noci"), "at night"],
  ]);
}

// ── Cities ──────────────────────────────────────────────────

/** Czech city forms → [time zone key, Czech nominative]. */
const CITIES: [string, string, string][] = [
  ["praha|prahy|praze|prahu|prahou", "prague", "Praha"],
  ["brno|brna|brně|brnem", "brno", "Brno"],
  ["ostrava|ostravy|ostravě|ostravu", "prague", "Ostrava"],
  ["plzeň|plzně|plzni", "prague", "Plzeň"],
  ["olomouc|olomouce|olomouci", "prague", "Olomouc"],
  ["bratislava|bratislavy|bratislavě|bratislavu", "bratislava", "Bratislava"],
  ["vídeň|vídně|vídni", "vienna", "Vídeň"],
  ["varšava|varšavy|varšavě|varšavu", "warsaw", "Varšava"],
  ["berlín|berlína|berlíně|berlínem", "berlin", "Berlín"],
  ["mnichov|mnichova|mnichově", "berlin", "Mnichov"],
  ["londýn|londýna|londýně|londýnem", "london", "Londýn"],
  ["paříž|paříže|paříži", "paris", "Paříž"],
  ["amsterdam|amsterdamu", "amsterdam", "Amsterdam"],
  ["řím|říma|římě", "rome", "Řím"],
  ["miláno|milána|miláně", "rome", "Miláno"],
  ["madrid|madridu", "madrid", "Madrid"],
  ["barcelona|barcelony|barceloně|barcelonu", "barcelona", "Barcelona"],
  ["lisabon|lisabonu", "lisbon", "Lisabon"],
  ["atény|athény|atén|aténách", "athens", "Atény"],
  ["moskva|moskvy|moskvě|moskvu", "moscow", "Moskva"],
  ["istanbul|istanbulu", "istanbul", "Istanbul"],
  ["dubaj|dubaje|dubaji", "dubai", "Dubaj"],
  ["dillí", "delhi", "Dillí"],
  ["bombaj|bombaje|bombaji", "mumbai", "Bombaj"],
  ["indie|indii", "india", "Indie"],
  ["bangkok|bangkoku", "bangkok", "Bangkok"],
  ["singapur|singapuru", "singapore", "Singapur"],
  ["hongkong|hongkongu", "hong kong", "Hongkong"],
  ["peking|pekingu", "beijing", "Peking"],
  ["šanghaj|šanghaje|šanghaji", "shanghai", "Šanghaj"],
  ["tokio|tokia|tokiu", "tokyo", "Tokio"],
  ["soul|soulu", "seoul", "Soul"],
  ["sydney", "sydney", "Sydney"],
  ["auckland|aucklandu", "auckland", "Auckland"],
  ["new york|new yorku|newyork|newyorku", "new york", "New York"],
  ["los angeles", "los angeles", "Los Angeles"],
  ["san francisco|san franciscu", "san francisco", "San Francisco"],
  ["chicago|chicagu", "chicago", "Chicago"],
  ["toronto|torontu", "toronto", "Toronto"],
  ["miami", "miami", "Miami"],
  ["mexiko|mexika|mexiku", "mexico city", "Mexiko"],
  ["seattle", "seattle", "Seattle"],
  ["denver|denveru", "denver", "Denver"],
];
const CITY_ALT = CITIES.flatMap(([f]) => f.split("|")).sort((a, b) => b.length - a.length).join("|");
const city = (m: string) => CITIES.find(([f]) => f.split("|").some((x) => plain(x) === plain(m)));

/** Genitive/locative of an unknown place → a guess at the nominative ("Barcelony" → "Barcelona"). */
function nominativePlace(word: string) {
  const known = city(word);
  if (known) return known[2];
  if (/[^aeiouyáéěíóúůý]y$/i.test(word)) return word.slice(0, -1) + "a";
  if (/[^aeiouyáéěíóúůý]u$/i.test(word) && word.length > 4) return word.slice(0, -1);
  return word;
}

// ── Names and items ─────────────────────────────────────────

/** Instrumental → nominative for a name after "s/se" ("Petrem" → "Petr", "Janou" → "Jana"). */
function nominativeName(word: string) {
  if (/ií$/i.test(word)) return word.slice(0, -1) + "e"; // Lucií → Lucie
  if (/[^aeiouy]em$/i.test(word) && word.length > 3) return word.slice(0, -2); // Petrem → Petr
  if (/ou$/i.test(word) && word.length > 3) return word.slice(0, -2) + "a"; // Janou → Jana
  if (/ím$/i.test(word)) return word.slice(0, -1); // Jiřím → Jiří
  if (/[^aeiouy]y$/i.test(word) && /^\p{Lu}/u.test(word)) return word; // Novákovými etc. stay
  return word;
}

const NOT_ACCUSATIVE = new Set(["tofu", "menu", "emu", "guru", "kakadu", "zebu", "ragu", "kung-fu", "tiramisu", "sushi"]);

/** Accusative of a feminine item → nominative ("kávu" → "káva"). */
function nominativeItem(item: string) {
  return item.replace(/(\p{L}+)u(?![\p{L}])/gu, (m, stem) =>
    NOT_ACCUSATIVE.has(plain(m)) || stem.length < 2 || /[aeiouyáéíóúůý]$/i.test(stem) ? m : `${stem}a`,
  );
}

// ── Per-card rules ──────────────────────────────────────────

const PLATFORMS: Record<string, string> = {
  zoom: "zoom", zoomu: "zoom", meet: "meet", meetu: "meet", teams: "teams", teamsech: "teams", teamsu: "teams",
  skype: "skype", skypu: "skype", discord: "discord", discordu: "discord", whatsapp: "whatsapp", whatsappu: "whatsapp", facetime: "facetime",
};

const STOP_NAME = new RegExp(
  `^(?:${["v", "ve", "na", "do", "od", "za", "at", "in", "on", "via", "přes", "o", "u", "k", "ke", "by", "from", "a"].map(cz).join("|")})$`,
  "iu",
);

function event(text: string) {
  let t = apply(text, [
    [w(`(?:přes|na|v|ve|po) (${Object.keys(PLATFORMS).join("|")})`), (_, p) => `via ${PLATFORMS[p.toLowerCase()]}`],
    [w("videohovor(?:em)?|videocall"), "video call"],
  ]);
  // "s Petrem a Janou" → "with Petr and Jana"
  t = t.replace(new RegExp(`(?<![\\p{L}])(?:s|se)\\s+((?:\\p{L}+(?:\\s*,\\s*|\\s+a\\s+|\\s+))*?\\p{L}+)(?=\\s+(?:${cz("v|ve|na|do|od|at|in|on|via|přes|o|u|by|from|today|tomorrow|tonight|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday|January|February|March|April|May|June|July|August|September|October|November|December")})(?![\\p{L}])|\\s*[,.!?]?\\s*$)`, "iu"), (_, names: string) => {
    const words = names.split(/(\s*,\s*|\s+a\s+|\s+)/u);
    return (
      "with " +
      words
        .map((x) => (/^\s*,\s*$/.test(x) ? ", " : /^\s+a\s+$/i.test(x) ? " and " : /^\s+$/.test(x) ? " " : STOP_NAME.test(x) ? x : nominativeName(x)))
        .join("")
    );
  });
  return t;
}

function reminder(text: string) {
  return apply(text, [
    [w("(?:prosím )?(?:připomeň|připomen|připomeňte|připomínka)(?: mi)?,?(?: (?:abych|že|ať|to))?:?"), "remind me to"],
    [w("(?:nezapomeň|nezapomen|nezapomenout|pamatuj|nezapomeňte)(?: (?:na|že|abych))?"), "remind me to"],
    [w("(?:je to |to je )?(?:urgentní|urgentně|urgent|důležité|důležitý|spěchá|hned|asap|nutně)"), "urgent"],
  ]);
}

function todo(text: string) {
  const t = apply(text, [
    [w("(?:nákupní )?seznam|nákup|na nákup"), "shopping list"],
    [w("koupit|nakoupit|kup|kupte|nakup|nakupit"), "buy"],
    [w("sehnat|seženu|vzít"), "get"],
    [w("vyzvednout|vyzvedni"), "pick up"],
    [w("objednat|objednej"), "order"],
    [w("a|i|taky|také"), "and"],
  ]);
  // items after "buy" are accusative in Czech: "kávu" → "káva"
  return t.replace(/^(\s*(?:shopping list:?\s*)?(?:buy|get)\s+)(.*)$/iu, (_, lead, items) => lead + nominativeItem(items));
}

function timer(text: string) {
  return apply(text, [
    [w("za (\\d+)"), "$1"],
    [w("půl hodiny|půlhodina|půlhodinu"), "30 min"],
    [w("čtvrt hodiny|čtvrthodina|čtvrthodinu"), "15 min"],
    [w("(\\d+(?:\\.\\d+)?)\\s*(?:minut|minuty|minutu|minutka|minutek|min\\.?)"), "$1 min"],
    [w("(\\d+(?:\\.\\d+)?)\\s*(?:hodin|hodiny|hodinu|hod\\.?)"), "$1 hours"],
    [w("hodinu|hodina"), "1 hours"],
    [w("(\\d+)\\s*(?:sekund|sekundy|sekundu|vteřin|vteřiny|vteřinu|s)"), "$1 sec"],
    [w("časovač|odpočet|minutka"), "timer"],
    [w("stopky|stopek"), "stopwatch"],
    [w("nastav|spusť|spust|zapni"), "set"],
    [w("na"), "for"],
  ]);
}

const TIMES: Record<string, string> = { jednou: "once", dvakrát: "twice", třikrát: "3x", čtyřikrát: "4x", pětkrát: "5x", šestkrát: "6x" };

function habit(text: string) {
  return apply(text, [
    [w("každý den|každej den|denně|každodenně|každodenne"), "every day"],
    [w("každé ráno|každý ráno|každé ráno"), "every morning"],
    [w("každý večer|každej večer"), "every evening"],
    [w("každou noc"), "every night"],
    [w("každé odpoledne"), "every afternoon"],
    [w("(?:v )?(?:pracovní|všední) dny|každý všední den|přes týden"), "weekdays"],
    [w("o víkendech|každý víkend|o víkendu"), "weekends"],
    [w("(\\d+)\\s*(?:[x×]|krát)\\s*(?:týdně|za týden|do týdne|v týdnu)"), "$1x a week"],
    [w(`(${Object.keys(TIMES).join("|")})\\s*(?:týdně|za týden|v týdnu)`), (_, n) => `${TIMES[Object.keys(TIMES).find((k) => plain(k) === plain(n)) ?? ""] ?? n} a week`],
    [w("týdně|jednou za týden"), "weekly"],
    [w("každ(?:ý|é|ou|ej)"), "every"],
  ]);
}

function split(text: string) {
  return apply(text, [
    [w("rozděl|rozdělit|rozdělte|rozpočítej|rozpočítat|poděl|podělit|dělit"), "split"],
    [w("na (\\d+) (?:lidí|lidi|osob|osoby|části|díly|dílů)"), "between $1"],
    [w("(\\d+) (?:lidí|lidi|osob|osoby|kamarádů|kámošů)"), "$1 people"],
    [w("mezi|mezi nás|pro"), "between"],
    [w("mě|mne|sebe"), "me"],
    [w("a"), "and"],
  ]);
}

function expense(text: string) {
  const t = apply(text, [
    [w("(?:utratil|utratila|utratili|zaplatil|zaplatila|zaplatili|platil|platila|dal|dala|vydal|vydala)(?: jsem| jsme)?"), "spent"],
    [w("stál|stála|stálo|stály|stojí|stálo mě|stálo nás"), "cost"],
    [w("dneska|dnes|včera"), ""],
  ]);
  // "450 Kč za taxi" → "450 Kč on taxi"; the item after "za" is accusative
  return t.replace(new RegExp(`(\\d[\\d.,k]*\\s*(?:Kč|€|\\$|eur|euro)?)\\s+(?:${cz("za|na")})\\s+(.+)$`, "iu"), (_, amount, item) => `${amount} on ${nominativeItem(item)}`)
    .replace(new RegExp(`^\\s*(?:${cz("za|na")})\\s+(.+?)\\s+(\\d[\\d.,k]*\\s*(?:Kč|€|\\$)?)\\s*$`, "iu"), (_, item, amount) => `${amount} on ${nominativeItem(item)}`);
}

const UNITS: [string, string][] = [
  ["míle|mil|míli|mílí|mílích", "miles"],
  ["kilometr|kilometrů|kilometry|kilometru|kiláků|kilák", "km"],
  ["centimetr|centimetrů|centimetry|centimetru|cenťáků", "cm"],
  ["milimetr|milimetrů|milimetry", "mm"],
  ["metr|metrů|metry|metru", "m"],
  ["stopa|stopy|stop|stopách", "ft"],
  ["palec|palce|palců|palcích", "inches"],
  ["yard|yardů|yardy", "yd"],
  ["kilogram|kilogramů|kilogramy|kila|kilo|kil", "kg"],
  ["gram|gramů|gramy|gramu", "g"],
  ["libra|libry|liber|librách", "lb"],
  ["unce|uncí", "oz"],
  ["litr|litrů|litry|litru", "l"],
  ["mililitr|mililitrů|mililitry", "ml"],
  ["galon|galonů|galony|galonu", "gal"],
  ["hrnek|hrnky|hrnků|hrnku", "cups"],
  ["stupňů celsia|stupně celsia|celsia|celsius|°c|st\\. ?c", "c"],
  ["stupňů fahrenheita|stupně fahrenheita|fahrenheita|fahrenheit|°f|st\\. ?f", "f"],
  ["kilometrů za hodinu|kilometry za hodinu|km/hod", "km/h"],
];
const UNIT_EN = "miles|mi|km|cm|mm|m|ft|inches|in|yd|kg|g|lb|lbs|oz|l|ml|gal|cups|c|f|k|km/h|mph";

function convertUnits(text: string) {
  let t = apply(text, [
    ...UNITS.map(([cs, en]): Rule => [w(cs), en]),
    [w("převeď|převod|převést|kolik je|kolik dělá|kolik"), ""],
  ]);
  t = t.replace(/(\d)\s*°\s*([cf])(?![a-z])/gi, "$1 $2");
  // "5 miles na km" → "5 miles in km"
  t = t.replace(new RegExp(`(\\d[\\d.]*\\s*(?:${UNIT_EN}))\\s+${cz("(?:na|do|v|ve|->|=)")}\\s+(${UNIT_EN})(?![\\p{L}])`, "iu"), "$1 in $2");
  return t;
}

function travel(text: string) {
  const t = apply(text, [
    [w("(?:let|letenka|letenky|letím|letíme|poletím|poletíme|letadlem|letadlo)(?: (?:do|na|z))?"), "flight to"],
    [w("(?:vlak|vlakem)(?: (?:do|na))?"), "train to"],
    [w("(?:autobus|autobusem|busem|bus)(?: (?:do|na))?"), "bus to"],
    [w("(?:autem|roadtrip)(?: (?:do|na))?"), "road trip to"],
    [w("(?:výlet|cesta|cestu|jedu|jedeme|pojedu|pojedeme|dovolená|dovolenou|služebka|služebně)(?: (?:do|na|k|ke))?"), "trip to"],
    [w("z (\\p{Lu}\\p{L}+) do"), "from $1 to"],
  ]);
  return t.replace(/(\b(?:to|from)\s+)(\p{Lu}\p{L}+)/gu, (_, lead, place) => lead + nominativePlace(place));
}

const HOLIDAYS: [string, string][] = [
  ["vánoc|vánocům|vánoce|vánocemi", "vánoce"],
  ["štědrého dne|štědrému dni|štědrý den|štědrého večera|štědrý večer", "štědrý den"],
  ["silvestra|silvestru|silvestr", "silvestr"],
  ["nového roku|novému roku|nový rok", "nový rok"],
  ["valentýna|valentýnu|valentýn", "valentýn"],
  ["mikuláše|mikuláši|mikuláš", "mikuláš"],
  ["halloweenu|halloween", "halloween"],
];

function countdown(text: string) {
  return apply(text, [
    ...HOLIDAYS.map(([cs, key]): Rule => [w(cs), key]),
    [w("(?:za )?kolik (?:dní|dnů|dny|týdnů)(?: (?:zbývá|zbyva|je|bude|jsou))? do|kolik (?:zbývá|zbyva) do|(?:dní|dnů|dny) do|zbývá do|odpočet do|kdy (?:je|budou|bude)"), "days until"],
  ]);
}

function timezone(text: string) {
  return apply(text, [
    [w("kolik je (?:teď |právě |tam )?hodin|kolik je tam|jaký je (?:teď )?čas"), "what time is it"],
    // "15:00 v Praze" reads Prague → …; "v Tokiu" is the target
    [w(`(\\d{1,2}(?::\\d{2})?(?:\\s*(?:am|pm))?)\\s+(?:v|ve)\\s+(${CITY_ALT})`), (_, time, c) => `${time} ${city(c)?.[1] ?? c}`],
    [w(`(?:v|ve|do|na|pro)\\s+(${CITY_ALT})`), (_, c) => ` in ${city(c)?.[1] ?? c}`],
    [w(CITY_ALT), (c) => city(c)?.[1] ?? c],
    [w("kolik je|kolik|to je|je to"), ""],
  ]);
}

function random(text: string) {
  return apply(text, [
    [/(\d*)\s*k(\d+)(?![\p{L}\d])/giu, "$1d$2"],
    [w("hoď(?: si)? (\\d+) (?:kostkami|kostky|kostek)|(\\d+) kostky"), (_, a, b) => `roll ${a || b} dice`],
    [w("hoď(?: si)? kostkou|hod kostkou|kostka|kostku"), "roll a die"],
    [w("hoď(?: si)? mincí|hod mincí|hoď korunou|panna nebo orel|pannu nebo orla|mince|mincí"), "flip a coin"],
    [w("náhodné číslo|náhodný číslo|náhodně|náhodný"), "random number"],
    [w("od (-?\\d+) do (-?\\d+)"), "between $1 and $2"],
    [w("(-?\\d+) až (-?\\d+)"), "$1 to $2"],
    [w("vyber(?: mi)?(?: (?:jedno|jednu|jeden|něco|náhodně))?:?|vylosuj|losuj"), "pick one:"],
    [w("nebo"), "or"],
  ]);
}

function goal(text: string) {
  return apply(text, [
    [w("(\\d[\\d.]*k?) z (\\d[\\d.]*k?)"), "$1 of $2"],
    [w("(\\d[\\d.]*k?)\\s*(?:hotovo|hotové|hotových|hotový|splněno|splněné|dokončeno|dokončené|přečteno|přečtené|mám)"), "$1 done"],
    [w("(?:zatím|mám|už mám|už) (\\d[\\d.]*k?)"), "$1 so far"],
    [w("(?:ušetřeno|naspořeno|našetřeno|mám našetřeno) (\\d[\\d.]*k?)"), "saved $1"],
    [w("letos|tento rok|tenhle rok"), "this year"],
    [w("tento měsíc|tenhle měsíc"), "this month"],
    [w("cíl|cílem"), "goal"],
  ]);
}

function color(text: string) {
  return apply(text, [
    [w("světle|světlá|světlý|světlé|bledě|bledá|pastelově|pastelová|pastelový|jemně|baby"), "light"],
    [w("tmavě|tmavá|tmavý|tmavé|temně|temná|hluboká|hluboce"), "dark"],
    [w("zářivě|zářivá|zářivý|neonově|neonová|neonový|jasně|sytě|sytá"), "bright"],
    [w("matně|matná|matný|zašle|zašlá|pastel"), "muted"],
  ]);
}

const RULES: Partial<Record<CardIntent, (t: string) => string>> = {
  event, reminder, todo, timer, habit, split, expense, convert: convertUnits, travel, countdown, timezone, random, goal, color,
};

/** Cards whose parsers read the text as typed (they already handle Czech or only show it). */
export const TYPED_TEXT: ReadonlySet<CardIntent> = new Set(["poll", "note", "link", "contact", "calc", "color"]);

/** Rough "is this Czech?" test, so English input skips the rewrite entirely. */
const CZECH_HINT = new RegExp(
  `[áčďéěíňóřšťúůýž]|(?<![\\p{L}])(?:${[
    "zitra", "dnes", "dneska", "koupit", "nakoupit", "pripomen", "rozdel", "mezi", "minut", "minuty", "hodin", "hodinu", "kolik",
    "patek", "pondeli", "utery", "streda", "ctvrtek", "sobota", "nedele", "tyden", "tydne", "denne", "mesic", "rano", "vecer",
    "nebo", "jsem", "utratil", "zaplatil", "vanoc", "hod", "kostkou", "kostkami", "minci", "prevod", "prevest", "kazdy", "kazde",
    "posilovna", "vecere", "obed", "schuzka", "rozdelit", "nezapomen", "prosim", "abych", "letos", "hotovo", "zatim", "na", "za",
    "do", "od", "ve", "se", "s", "v", "a", "z",
  ].join("|")})(?![\\p{L}])`,
  "iu",
);

export function looksCzech(text: string) {
  return CZECH_HINT.test(text);
}

/**
 * Rewrite Czech input into the English the card's parser reads.
 * Without an intent (offline classifier), every card's rules run.
 */
export function rewriteCzech(text: string, intent?: CardIntent): string {
  if (!looksCzech(text)) return text;
  if (intent && TYPED_TEXT.has(intent)) return text;
  // Dictated text ends sentences with a period the parsers would read as content.
  let t = numbers(text.replace(/[.!…]+\s*$/u, ""));
  if (intent) t = RULES[intent]?.(t) ?? t;
  else for (const f of [reminder, todo, split, expense, timer, habit, convertUnits, travel, countdown, timezone, random, goal, color, event]) t = f(t);
  t = dates(t);
  return t.replace(/\s{2,}/g, " ").trim();
}
