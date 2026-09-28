/*
 * Loaded synchronously in <head> (no defer). Two jobs that must happen before anything else:
 *  1. apply the saved theme before first paint (no light flash in dark mode);
 *  2. if the app fails to start (missing file, stale CDN copy, script error), replace the
 *     "Opening..." note with a readable error and a reload button instead of hanging forever.
 * Kept dependency-free and ES5-friendly on purpose.
 */
(function () {
  var root = document.documentElement;
  var theme = 'light';
  try {
    theme = localStorage.getItem('sz:theme') || 'light';
  } catch (e) {}
  function applyTheme() {
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  applyTheme();
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      if (theme === 'system') applyTheme();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  window.SZ_THEME = {
    get: function () {
      return theme;
    },
    set: function (value) {
      theme = value === 'dark' || value === 'system' ? value : 'light';
      try {
        localStorage.setItem('sz:theme', theme);
      } catch (e) {}
      applyTheme();
    },
  };

  var failed = false;
  function text(key, fallbackZh, fallbackEn) {
    try {
      if (window.t && window.SZ_I18N) return window.t(key);
    } catch (e) {}
    var lang = (navigator.language || '').toLowerCase();
    return lang.indexOf('zh') === 0 ? fallbackZh : fallbackEn;
  }
  function fail(detail) {
    if (window.SZ_BOOTED || failed) return;
    failed = true;
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'boot-error';
    box.setAttribute('role', 'alert');
    var h = document.createElement('h1');
    h.textContent = text('boot.failed', '页面没有正常打开', "The app didn't open properly");
    var p = document.createElement('p');
    p.textContent = text(
      'boot.failedHint',
      '请确认 index.html 与 core、locales、data、assets 文件夹放在一起，然后重试。',
      'Keep index.html together with the core, locales, data and assets folders, then try again.'
    );
    var code = document.createElement('code');
    code.textContent = String(detail || '').slice(0, 300);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-primary';
    b.textContent = text('boot.retry', '重新加载', 'Reload');
    b.addEventListener('click', function () {
      location.reload();
    });
    box.appendChild(h);
    box.appendChild(p);
    if (detail) box.appendChild(code);
    box.appendChild(b);
    app.appendChild(box);
  }
  window.SZ_BOOT_FAIL = fail;
  window.addEventListener('error', function (e) {
    if (window.SZ_BOOTED) return;
    var target = e.target;
    if (target && target !== window && (target.src || target.href)) fail('Missing file: ' + (target.src || target.href));
    else if (e.message) fail(e.message);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    if (!window.SZ_BOOTED) fail(e.reason && (e.reason.message || e.reason));
  });
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!window.SZ_BOOTED) fail('Startup timed out');
    }, 8000);
  });
})();
