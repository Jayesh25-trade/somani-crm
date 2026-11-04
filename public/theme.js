// Runs in <head> so the saved/system theme is applied before first paint (no flash)
(function () {
  var t = null;
  try { t = localStorage.getItem('theme'); } catch (e) {}
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
})();
