// Runs before first paint: apply the saved theme and language direction to avoid a flash.
(function () {
  try {
    var theme = localStorage.getItem('azs.theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    var lang = localStorage.getItem('azs.lang') || (navigator.language || '').slice(0, 2).toLowerCase();
    if (lang === 'fa' || lang === 'ar') { document.documentElement.lang = lang; document.documentElement.dir = 'rtl'; }
  } catch (e) { /* storage unavailable */ }
})();
