// Art-free build: any <img> whose file is not shipped is swapped for an inline dot,
// so pages keep their layout instead of showing broken-image icons.
// Classic script, loaded in <head> so it is listening before the first image fails.
(function () {
  var DOT = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<circle cx="50" cy="50" r="30" fill="#efa04b" stroke="#2b2230" stroke-width="6"/></svg>');
  window.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG' || el.dataset.dot) return;
    el.dataset.dot = '1';
    el.src = DOT;
  }, true);
})();
