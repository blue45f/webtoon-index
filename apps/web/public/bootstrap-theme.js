(function () {
  "use strict";

  try {
    var serialized =
      localStorage.getItem("toonspectrum-theme") ||
      localStorage.getItem("webdex-theme");
    if (!serialized) return;

    var parsed = JSON.parse(serialized);
    var theme = parsed && parsed.state && parsed.state.theme;
    if (theme === "dark" || theme === "light") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // Storage can be unavailable in hardened/private contexts. The CSS default remains usable.
  }
})();
