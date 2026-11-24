// A picture from the game's illustrations (art/pictures.ts): an <svg> of one of them.

import { pictures } from "./pictures.ts";

const svgNS = "http://www.w3.org/2000/svg";

/** A picture by its id ("fox", "chapter-science", "flame"), as decoration: its words are beside
 * it. */
export function picture(id: string, cls = ""): SVGSVGElement {
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", cls ? `pic ${cls}` : "pic");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = pictures[id] ?? "";
  return svg;
}
