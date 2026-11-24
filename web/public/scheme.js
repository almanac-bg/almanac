// The player's Night or Day on the page before it's first drawn, as lib/prefs.ts keeps it (the same key, the same
// attribute): on the pages the server draws alone (the privacy notice, a mail's settings), which have no client, and on
// the game's own, whose client comes after the first paint (a chosen Day would otherwise flash the device's Night).
try {
  const chosen = localStorage.getItem("almanac.scheme");
  if (chosen === "night" || chosen === "day") document.documentElement.dataset.scheme = chosen;
} catch {
  // Storage refused (a private window): the device's look.
}
