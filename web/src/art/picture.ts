// A picture from the game's illustrations (art/pictures.ts): an <svg> that fills itself once the pictures have
// loaded. They come as a file of their own, asked for as the game starts, so the first screen never waits on them;
// until they're here, a picture is its empty box (an avatar shows its tone, a topic its card).

const svgNS = "http://www.w3.org/2000/svg";

let drawn: Record<string, string> | null = null;
let loading: Promise<Record<string, string>> | null = null;

/** Starts loading the pictures (once). */
export function loadPictures(): Promise<Record<string, string>> {
  loading ??= import("./pictures.ts").then(
    (m) => {
      drawn = m.pictures;
      return m.pictures;
    },
    (err) => {
      loading = null; // a failed load is tried again by the next picture
      throw err;
    },
  );
  return loading;
}

/** A picture by its id ("fox", "topic-science", "mode-duel", "frame-laurel"), as decoration: its words are beside
 * it. */
export function picture(id: string, cls = ""): SVGSVGElement {
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", cls ? `pic ${cls}` : "pic");
  svg.setAttribute("aria-hidden", "true");
  if (drawn) svg.innerHTML = drawn[id] ?? "";
  else
    loadPictures().then(
      (p) => {
        svg.innerHTML = p[id] ?? "";
      },
      () => {},
    );
  return svg;
}
