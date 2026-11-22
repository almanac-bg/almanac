// The pages the server draws alone (the privacy notice, a mail's settings) have no client: this puts the player's
// Night or Day on them before they're drawn, as lib/prefs.ts does in the game (the same key, the same attribute).
try {
  const chosen = localStorage.getItem("almanac.scheme");
  if (chosen === "night" || chosen === "day") document.documentElement.dataset.scheme = chosen;
} catch {
  // Storage refused (a private window): the device's look.
}
