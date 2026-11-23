/*
 * Standalone runtime for the National Cannabis Outlook Tracker.
 *
 * Inside Claude, the tracker is a "Data" dashboard: the dashboard framework
 * mounts the tracker's page, loads its datasets and hands the page's scripts a
 * global `dash` object. This file stands in for that framework on a plain web
 * host, so the tracker's own page runs here unchanged.
 *
 * What it loads:
 *   data/manifest.json   which datasets exist (written by tools/stamp.py)
 *   data/<id>.json       one file per dataset, fetched the first time the page reads it
 *   page/index.html      the tracker's page, copied as it is stored in the tracker
 *
 * What it gives the page (the same contract the framework documents):
 *   dash.data(id)                 -> {status, data, message, refreshing, truncated, meta}
 *   dash.onData(fn)               -> runs fn now and whenever data, a filter or the width changes
 *   dash.calc(id, {inputs, fn})   -> a value worked out from datasets, read like a dataset
 *   dash.loader(id, {fn})         -> reshapes a file's content into rows
 *   dash.draw(name, fn|{mount,update,unmount}) and dash.draw(name)
 *   dash.colors, dash.params(), dash.setParams(), dash.resetParams(),
 *   dash.refresh(id), dash.setLink(name)
 *
 * Not available outside Claude: the Sources panel, comments, saved rows,
 * connectors and anything reached through claude.use().
 */
(function () {
  'use strict';

  var PAGE_DIR = 'page/';
  var DATA_DIR = 'data/';
  var MAX_COLORS = 8;

  var root = document.getElementById('dash-root');
  var foot = document.getElementById('dash-foot');

  var manifest = null;
  var sources = Object.create(null);   // dataset id -> {status, data, message, ...}
  var calcs = Object.create(null);     // calc id -> {inputs, fn, ...}
  var loaders = Object.create(null);   // dataset id -> fn
  var drawings = Object.create(null);  // drawing name -> fn | {mount, update, unmount}
  var records = new WeakMap();         // drawing element -> {mounted, made, def, stale}
  var onDataFns = [];
  var paramDefaults = {};
  var params = {};
  var version = 0;                     // bumps whenever data or a filter changes
  var started = false;                 // true once the page's scripts have run
  var fullQueued = false;
  var partQueued = false;
  var dirtyNames = new Set();
  var dirtyEls = new Set();
  var noteShown = false;

  function log(msg, err) {
    try { console.error('[tracker] ' + msg, err || ''); } catch (e) { /* no console */ }
  }

  /* ------------------------------------------------------------------ data */

  function blank(status, message, isCalc) {
    return { status: status, data: isCalc ? null : [], message: message || '', refreshing: false, truncated: false, meta: [] };
  }

  // A JSON file's value becomes rows the way the framework reads one:
  // an array of row objects, bare or under rows / data / results.
  function toRows(value) {
    var rows = null, meta = [], truncated = false, columns = null;
    if (Array.isArray(value)) {
      rows = value;
    } else if (value && typeof value === 'object') {
      ['rows', 'data', 'results'].some(function (k) {
        if (Array.isArray(value[k])) { rows = value[k]; return true; }
        return false;
      });
      if (Array.isArray(value.meta)) meta = value.meta;
      if (Array.isArray(value.columns)) columns = value.columns.map(function (c) { return (c && typeof c === 'object') ? String(c.name) : String(c); });
      truncated = value.truncated === true;
    }
    if (!rows) return { data: value, truncated: truncated, meta: meta };
    if (columns && rows.length && Array.isArray(rows[0])) {
      rows = rows.map(function (cells) {
        var o = {};
        columns.forEach(function (c, i) { o[c] = cells[i]; });
        return o;
      });
    }
    if (!columns) {
      var seen = Object.create(null);
      columns = [];
      rows.slice(0, 50).forEach(function (r) {
        if (r && typeof r === 'object' && !Array.isArray(r)) {
          Object.keys(r).forEach(function (k) { if (!seen[k]) { seen[k] = true; columns.push(k); } });
        }
      });
    }
    try { Object.defineProperty(rows, 'columns', { value: columns, enumerable: false, configurable: true, writable: true }); } catch (e) { /* frozen */ }
    return { data: rows, truncated: truncated, meta: meta };
  }

  function applyLoader(id, value) {
    var fn = loaders[id];
    if (!fn) return toRows(value);
    return Promise.resolve(fn({
      answer: value,
      items: [value],
      args: {},
      read: {},
      call: function () { return Promise.reject(new Error('Connector calls are not available outside Claude.')); }
    })).then(function (out) {
      if (out && typeof out === 'object' && !Array.isArray(out) && out.error) {
        throw new Error(typeof out.error === 'string' ? out.error : (out.error.message || 'The loader reported an error.'));
      }
      return toRows(out);
    });
  }

  function fileUrl(id, entry) {
    var name = (entry && entry.file) || (id + '.json');
    var v = (entry && entry.sha256) ? String(entry.sha256).slice(0, 16) : (manifest && manifest.published) || '';
    return DATA_DIR + name + (v ? '?v=' + encodeURIComponent(v) : '');
  }

  function load(id, s) {
    fetch(fileUrl(id, s.entry))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (value) { return applyLoader(id, value); })
      .then(function (out) {
        s.status = 'ok';
        s.data = out.data;
        s.truncated = out.truncated;
        s.meta = out.meta;
        s.message = '';
        s.refreshing = false;
      })
      .catch(function (err) {
        s.refreshing = false;
        if (s.status !== 'ok') {
          s.status = 'error';
          s.message = String((err && err.message) || err);
        }
        log('dataset "' + id + '" did not load', err);
        showNote('Some of this tracker’s data did not load. Refresh the page to try again.');
      })
      .then(function () {
        version += 1;
        queueFull();
      });
  }

  function readSource(id) {
    if (calcs[id]) return readCalc(id);
    var s = sources[id];
    if (!s) {
      var entry = manifest && manifest.datasets && manifest.datasets[id];
      if (!entry) return blank('missing', 'There is no dataset named "' + id + '".');
      s = sources[id] = { status: 'loading', data: [], message: '', refreshing: false, truncated: false, meta: [], entry: entry };
      load(id, s);
    }
    return {
      status: s.status,
      data: s.status === 'ok' ? s.data : [],
      message: s.message,
      refreshing: !!s.refreshing,
      truncated: !!s.truncated,
      meta: s.meta || []
    };
  }

  function readCalc(id) {
    var c = calcs[id];
    if (c.reading) return blank('error', 'The calculation "' + id + '" depends on itself.', true);
    c.reading = true;
    var ins;
    try { ins = c.inputs.map(readSource); } finally { c.reading = false; }
    var order = ['error', 'missing', 'loading'];
    for (var i = 0; i < order.length; i++) {
      for (var j = 0; j < ins.length; j++) {
        if (ins[j].status === order[i]) return blank(order[i], ins[j].message, true);
      }
    }
    var other = ins.filter(function (x) { return x.status !== 'ok'; })[0];
    if (other) return blank(other.status, other.message, true);
    if (c.version !== version) {
      c.version = version;
      try {
        c.value = c.fn.apply(null, ins.map(function (x) { return x.data; }));
        c.error = null;
      } catch (err) {
        c.error = String((err && err.message) || err);
        log('calculation "' + id + '" failed', err);
      }
    }
    if (c.error) return blank('error', c.error, true);
    return {
      status: 'ok',
      data: c.value,
      message: '',
      refreshing: ins.some(function (x) { return x.refreshing; }),
      truncated: ins.some(function (x) { return x.truncated; }),
      meta: []
    };
  }

  /* -------------------------------------------------------------- drawings */

  function recordOf(el) {
    var rec = records.get(el);
    if (!rec) { rec = { mounted: false, made: undefined, def: null, stale: true }; records.set(el, rec); }
    return rec;
  }

  function runEl(el) {
    var name = el.getAttribute('data-draw');
    var def = drawings[name];
    if (!def) return;
    // A drawing inside another is never called.
    if (el.parentElement && el.parentElement.closest('[data-draw]')) return;
    var rec = recordOf(el);
    // Under the hidden attribute no drawing runs until it comes off.
    if (el.closest('[hidden]')) { rec.stale = true; return; }
    rec.stale = false;
    try {
      if (typeof def === 'function') {
        def(el);
      } else {
        if (!rec.mounted || rec.def !== def) {
          el.replaceChildren();
          rec.def = def;
          rec.made = typeof def.mount === 'function' ? def.mount(el) : undefined;
          rec.mounted = true;
        }
        if (typeof def.update === 'function') def.update(el, rec.made);
      }
    } catch (err) {
      if (rec.mounted && def && typeof def.unmount === 'function') {
        try { def.unmount(el, rec.made); } catch (e) { /* ignore */ }
      }
      rec.mounted = false;
      log('drawing "' + name + '" failed', err);
    }
  }

  function allDrawEls() {
    return Array.prototype.slice.call(root.querySelectorAll('[data-draw]'));
  }

  function runFull() {
    fullQueued = false;
    if (!started) return;
    dirtyNames.clear();
    dirtyEls.clear();
    onDataFns.slice().forEach(function (fn) {
      try { fn(); } catch (err) { log('an onData callback failed', err); }
    });
    allDrawEls().forEach(runEl);
  }

  function runPart() {
    partQueued = false;
    if (!started) return;
    if (!dirtyNames.size && !dirtyEls.size) return;
    var names = dirtyNames, els = dirtyEls;
    dirtyNames = new Set();
    dirtyEls = new Set();
    allDrawEls().forEach(function (el) {
      if (names.has(el.getAttribute('data-draw')) || els.has(el)) runEl(el);
    });
  }

  function queueFull() {
    if (fullQueued) return;
    fullQueued = true;
    setTimeout(runFull, 0);
  }

  function queuePart() {
    if (partQueued) return;
    partQueued = true;
    Promise.resolve().then(runPart);
  }

  /* ------------------------------------------------------------- dash API */

  var dash = {};

  dash.colors = [];
  for (var ci = 0; ci < MAX_COLORS; ci++) dash.colors.push('var(--dash-c' + ci + ')');

  dash.data = function (id) { return readSource(String(id)); };

  dash.onData = function (fn) {
    if (typeof fn !== 'function') return;
    onDataFns.push(fn);
    try { fn(); } catch (err) { log('an onData callback failed', err); }
  };

  dash.calc = function (id, spec) {
    spec = spec || {};
    calcs[String(id)] = {
      inputs: Array.isArray(spec.inputs) ? spec.inputs.map(String) : [],
      fn: typeof spec.fn === 'function' ? spec.fn : function () { return null; },
      title: spec.title || '',
      description: spec.description || '',
      version: -1,
      value: null,
      error: null,
      reading: false
    };
    if (started) { version += 1; queueFull(); }
  };

  dash.loader = function (id, spec) {
    if (spec && typeof spec.fn === 'function') loaders[String(id)] = spec.fn;
  };

  dash.draw = function (name, def) {
    name = String(name);
    if (def) drawings[name] = def;
    if (!started) return;
    dirtyNames.add(name);
    queuePart();
  };

  dash.refresh = function (id) {
    id = String(id);
    var s = sources[id];
    if (!s || s.refreshing) return;
    if (s.status === 'ok') s.refreshing = true; else s.status = 'loading';
    load(id, s);
  };

  dash.params = function () {
    var out = {};
    Object.keys(params).forEach(function (k) { out[k] = params[k]; });
    return out;
  };

  dash.setParams = function (values) {
    if (!values || typeof values !== 'object') return;
    var changed = false;
    Object.keys(values).forEach(function (k) {
      var v = values[k];
      var ok = v === null || ['string', 'number', 'boolean'].indexOf(typeof v) >= 0 || Array.isArray(v);
      if (!ok) return;
      if (params[k] !== v) { params[k] = v; changed = true; }
    });
    if (changed) { version += 1; queueFull(); }
  };

  dash.resetParams = function () {
    params = {};
    Object.keys(paramDefaults).forEach(function (k) { params[k] = paramDefaults[k]; });
    version += 1;
    queueFull();
  };

  // Keeps the reader's place in the address, so a copied link opens there.
  dash.setLink = function (name) {
    try {
      var hash = name ? '#' + String(name) : '';
      if (location.hash === hash) return;
      history.replaceState(null, '', location.pathname + location.search + hash);
    } catch (e) { /* file:// or a locked-down browser */ }
  };

  window.dash = dash;

  // The page may call claude.use() for features that exist only inside Claude.
  if (!window.claude) {
    window.claude = {
      use: function (name) {
        return Promise.reject(new Error('"' + name + '" is only available inside Claude.'));
      }
    };
  }

  /* ---------------------------------------------------------------- notes */

  function showNote(text) {
    if (noteShown) return;
    noteShown = true;
    var p = document.createElement('p');
    p.className = 'dash-note';
    p.setAttribute('role', 'status');
    p.textContent = text;
    document.body.insertBefore(p, document.body.firstChild);
  }

  function bootMessage(text) {
    var p = document.createElement('p');
    p.className = 'dash-boot';
    p.textContent = text;
    root.replaceChildren(p);
    root.removeAttribute('aria-busy');
  }

  function showFooter() {
    if (!foot || !manifest || !manifest.datasets) return;
    var latest = '';
    Object.keys(manifest.datasets).forEach(function (id) {
      var c = manifest.datasets[id] && manifest.datasets[id].changed;
      if (typeof c === 'string' && c > latest) latest = c;
    });
    if (!latest) return;
    var d = new Date(latest);
    if (isNaN(d.getTime())) return;
    var text;
    try {
      text = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).format(d);
    } catch (e) {
      text = d.toDateString();
    }
    foot.textContent = 'Data last updated ' + text + '.';
    foot.hidden = false;
  }

  /* ----------------------------------------------------------- page mount */

  var PLAIN_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

  // The framework drops these from a page; the standalone copy drops them too,
  // so it never runs anything the tracker itself would not.
  function tidy(fragment) {
    Array.prototype.forEach.call(fragment.querySelectorAll('iframe, object, embed, base, script[type="module"], meta'), function (n) { n.remove(); });
    Array.prototype.forEach.call(fragment.querySelectorAll('script[src]'), function (n) {
      var src = n.getAttribute('src') || '';
      if (PLAIN_FILE.test(src)) n.setAttribute('src', PAGE_DIR + src); else n.remove();
    });
    Array.prototype.forEach.call(fragment.querySelectorAll('link'), function (n) {
      var href = n.getAttribute('href') || '';
      var rel = (n.getAttribute('rel') || '').toLowerCase();
      if (rel === 'stylesheet' && PLAIN_FILE.test(href)) n.setAttribute('href', PAGE_DIR + href); else n.remove();
    });
    Array.prototype.forEach.call(fragment.querySelectorAll('*'), function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      });
    });
  }

  // Each script runs in its own scope, in order, once the page is in place.
  function runScript(node, index) {
    var src = node.getAttribute('src');
    var getCode = src
      ? fetch(src, { cache: 'no-cache' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + src);
          return r.text();
        })
      : Promise.resolve(node.textContent || '');
    return getCode.then(function (code) {
      try {
        (new Function(code + '\n//# sourceURL=tracker-page-script-' + (index + 1) + '.js')).call(window);
      } catch (err) {
        log('page script ' + (index + 1) + ' stopped', err);
      }
    }, function (err) {
      log('page script ' + (index + 1) + ' did not load', err);
    });
  }

  function watch() {
    // When the hidden attribute comes off, drawings that were skipped under it run.
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function (list) {
        var found = false;
        list.forEach(function (m) {
          var t = m.target;
          if (!t || t.nodeType !== 1 || t.closest('[hidden]')) return;
          var els = t.hasAttribute('data-draw') ? [t] : [];
          els = els.concat(Array.prototype.slice.call(t.querySelectorAll('[data-draw]')));
          els.forEach(function (el) {
            var rec = recordOf(el);
            if (rec.stale && !el.closest('[hidden]')) { dirtyEls.add(el); found = true; }
          });
        });
        if (found) queuePart();
      }).observe(root, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    }
    // Drawings run again when the page's width changes.
    if (typeof ResizeObserver === 'function') {
      var lastWidth = root.clientWidth;
      new ResizeObserver(function () {
        var w = root.clientWidth;
        if (w === lastWidth) return;
        lastWidth = w;
        queueFull();
      }).observe(root);
    }
  }

  function mountPage(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    tidy(tpl.content);
    var scripts = Array.prototype.slice.call(tpl.content.querySelectorAll('script'));
    scripts.forEach(function (s) { s.remove(); });
    root.replaceChildren(tpl.content);
    var chain = Promise.resolve();
    scripts.forEach(function (s, i) {
      chain = chain.then(function () { return runScript(s, i); });
    });
    return chain.then(function () {
      started = true;
      root.removeAttribute('aria-busy');
      watch();
      runFull();
      showFooter();
    });
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }

  function getText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.text();
    });
  }

  function boot() {
    if (typeof d3 === 'undefined') { bootMessage('This page could not start. Refresh to try again.'); return; }
    getJson(DATA_DIR + 'manifest.json').then(function (m) {
      manifest = (m && typeof m === 'object') ? m : {};
      if (manifest.params && typeof manifest.params === 'object') {
        paramDefaults = manifest.params;
        dash.resetParams();
      }
      if (manifest.title) {
        document.title = manifest.title + (manifest.titleSuffix ? ' | ' + manifest.titleSuffix : '');
      }
      if (manifest.lang) document.documentElement.setAttribute('lang', manifest.lang);
      return getText(PAGE_DIR + 'index.html').then(mountPage);
    }).catch(function (err) {
      log('the tracker could not start', err);
      if (err && err.status === 404) bootMessage('This tracker has not been published yet.');
      else bootMessage('This tracker could not be loaded. Refresh the page to try again.');
    });
  }

  boot();
})();
