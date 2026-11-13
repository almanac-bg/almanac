// Season art: each season (a calendar month) has its own colour, going round the colour wheel a step a month, and
// its banner, medals and frame are drawn in it — generated, like the medals and emblems.

const svgNS = "http://www.w3.org/2000/svg";

function el(name: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A season's colour (0–359) from its id (YYYY-MM): the same as the server's (play.seasonHue). */
export function seasonHue(id: string): number {
  const [y = 0, m = 0] = id.split("-").map(Number);
  return ((y * 12 + m) * 137) % 360;
}

/** A season's name: its month and year („Ноември 2026“). */
export function seasonName(id: string): string {
  const [y = 2026, m = 1] = id.split("-").map(Number);
  const month = new Intl.DateTimeFormat("bg", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 15)),
  );
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${y}`;
}

/** A five-pointed star's points around a centre. */
function star(cx: number, cy: number, r: number): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(" ");
}

/** A season's banner: arcs rising from a corner and stars scattered by its id, in its colour (decoration). */
export function seasonBanner(id: string): HTMLElement {
  const svg = el("svg", { viewBox: "0 0 320 120", preserveAspectRatio: "xMidYMid slice", "aria-hidden": "true" });
  for (let i = 0; i < 6; i++) svg.append(el("circle", { cx: 300, cy: 130, r: 40 + i * 28, class: "season-arc" }));
  let seed = seasonHue(id) + 7;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 14; i++) {
    svg.append(el("polygon", { points: star(next() * 320, next() * 120, 2 + next() * 5), class: "season-star" }));
  }
  const wrap = document.createElement("div");
  wrap.className = "season-banner";
  wrap.style.setProperty("--season", `hsl(${seasonHue(id)} 72% 62%)`);
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(svg);
  return wrap;
}

/** A season's medal (bronze, silver, gold), or its empty place (decoration). */
export function seasonMedal(medal: string, earned: boolean): HTMLElement {
  const svg = el("svg", { viewBox: "0 0 48 48", "aria-hidden": "true" });
  svg.append(
    el("path", { d: "M16 4 L24 18 L32 4", class: "medal-ribbon" }),
    el("circle", { cx: 24, cy: 29, r: 15, class: "season-medal-face" }),
    el("polygon", { points: star(24, 29, 8), class: "season-medal-star" }),
  );
  const wrap = document.createElement("span");
  wrap.className = `season-medal d-${medal === "bronze" ? "bronze" : medal === "silver" ? "silver" : "gold"}${earned ? " earned" : ""}`;
  wrap.setAttribute("aria-hidden", "true");
  wrap.append(svg);
  return wrap;
}
