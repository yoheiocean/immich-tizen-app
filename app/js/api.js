/* Immich API + asset sources. Plain ES5-ish (TV engine is Chromium ~63).
   config.js (generated at package time, never committed) sets window.IMMICH_CONFIG = {url, key}. */
(function (global) {
  'use strict';
  var CFG = global.IMMICH_CONFIG || {};
  var BASE = (CFG.url || '').replace(/\/$/, '') + '/api';
  var KEY = CFG.key || '';

  function get(path) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', BASE + path);
      xhr.setRequestHeader('x-api-key', KEY);
      xhr.timeout = 20000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
        } else { reject(new Error('HTTP ' + xhr.status + ' ' + path)); }
      };
      xhr.onerror = function () { reject(new Error('Network error ' + path)); };
      xhr.ontimeout = function () { reject(new Error('Timeout ' + path)); };
      xhr.send();
    });
  }

  // <img>/<video> can't send headers: Immich accepts ?apiKey= too.
  function k(url) { return BASE + url + (url.indexOf('?') < 0 ? '?' : '&') + 'apiKey=' + encodeURIComponent(KEY); }
  var Api = {
    get: get,
    thumb: function (id) { return k('/assets/' + id + '/thumbnail?size=thumbnail'); },
    preview: function (id) { return k('/assets/' + id + '/thumbnail?size=preview'); },
    video: function (id) { return k('/assets/' + id + '/video/playback'); },
    personThumb: function (id) { return k('/people/' + id + '/thumbnail'); }
  };

  /* A Source is an ordered list of assets that may be huge (the whole timeline). It knows every month's count
     up front (timeline/buckets) and fetches a month's asset list only when something asks for an index in it.
     Asset = {id, isImage, duration, month}. */
  function Source(title, query) {
    this.title = title;
    this.query = query;          // e.g. 'visibility=timeline', 'albumId=..', 'personId=..'; null for fixed lists
    this.buckets = [];           // [{timeBucket, count, start}]
    this.total = 0;
    this.data = {};              // bucket index -> array of assets
    this.pending = {};
    this.listeners = [];
  }
  Source.fixed = function (title, assets) {
    var s = new Source(title, null);
    s.buckets = [{ timeBucket: null, count: assets.length, start: 0 }];
    s.data[0] = assets;
    s.total = assets.length;
    s.ready = Promise.resolve(s);
    return s;
  };
  Source.prototype.init = function () {
    var self = this;
    if (this.ready) return this.ready;
    this.ready = get('/timeline/buckets?' + this.query).then(function (list) {
      var start = 0;
      self.buckets = list.map(function (b) { var o = { timeBucket: b.timeBucket, count: b.count, start: start }; start += b.count; return o; });
      self.total = start;
      return self;
    });
    return this.ready;
  };
  Source.prototype.bucketOf = function (i) {
    var lo = 0, hi = this.buckets.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (this.buckets[mid].start <= i) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  Source.prototype.onChange = function (fn) { this.listeners.push(fn); };
  Source.prototype.offChange = function (fn) { this.listeners = this.listeners.filter(function (f) { return f !== fn; }); };
  Source.prototype.load = function (b) {
    var self = this;
    if (this.data[b]) return Promise.resolve(this.data[b]);
    if (this.pending[b]) return this.pending[b];
    var bk = this.buckets[b];
    var p = get('/timeline/bucket?' + this.query + '&timeBucket=' + encodeURIComponent(bk.timeBucket)).then(function (c) {
      var out = [];
      for (var j = 0; j < c.id.length; j++) {
        out.push({ id: c.id[j], isImage: c.isImage[j], duration: c.duration ? c.duration[j] : null, month: bk.timeBucket });
      }
      self.data[b] = out;
      delete self.pending[b];
      self.listeners.forEach(function (fn) { try { fn(b); } catch (e) {} });
      return out;
    }, function (e) { delete self.pending[b]; throw e; });
    this.pending[b] = p;
    return p;
  };
  // Synchronous peek: the asset if its month is loaded (and start loading it if not).
  Source.prototype.peek = function (i) {
    if (i < 0 || i >= this.total) return null;
    var b = this.bucketOf(i), d = this.data[b];
    if (d) return d[i - this.buckets[b].start] || null;
    this.load(b);
    return null;
  };
  Source.prototype.at = function (i) {
    var self = this;
    if (i < 0 || i >= this.total) return Promise.resolve(null);
    var b = this.bucketOf(i);
    return this.load(b).then(function (d) { return d[i - self.buckets[b].start] || null; });
  };
  Source.prototype.monthOf = function (i) {
    if (!this.buckets.length || this.buckets[0].timeBucket === null) return null;
    return this.buckets[this.bucketOf(i)].timeBucket;
  };

  /* A shuffled view of a Source: same interface the Viewer uses (init/at/monthOf/total/title), random order over
     ALL its assets (months are fetched lazily as the slideshow reaches them). base.indexOf(i) maps back. */
  Source.prototype.shuffled = function () {
    var base = this;
    return base.init().then(function () {
      var n = base.total, perm = new Array(n), i, j, t;
      for (i = 0; i < n; i++) perm[i] = i;
      for (i = n - 1; i > 0; i--) { j = Math.floor(Math.random() * (i + 1)); t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
      return {
        title: base.title, total: n, shuffle: true,
        init: function () { return Promise.resolve(this); },
        at: function (k) { return base.at(perm[k]); },
        monthOf: function (k) { return base.monthOf(perm[k]); },
        baseIndex: function (k) { return perm[k]; }
      };
    });
  };

  global.Api = Api;
  global.Source = Source;
})(this);
