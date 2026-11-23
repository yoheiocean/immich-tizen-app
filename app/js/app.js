/* Immich TV app: Home (rows) -> Grid (virtualised) -> Viewer. Remote: arrows, OK, Back, Play/Pause, Ch+/-. */
(function () {
  'use strict';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8,
    PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412, CHUP: 427, CHDOWN: 428, PGUP: 33, PGDN: 34 };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];
  var SLIDE_MS = 6000, SPIN_DELAY = 500;
  // Ken Burns moves: [start, end]. Subtle (max 12% zoom) so faces stay in frame.
  var KB_MOVES = [
    ['scale(1) translate(0, 0)', 'scale(1.12) translate(-2%, -1.5%)'],
    ['scale(1.12) translate(2%, 1.5%)', 'scale(1) translate(0, 0)'],
    ['scale(1.04) translate(-1.5%, 1%)', 'scale(1.12) translate(1.5%, -1%)'],
    ['scale(1.12) translate(0, 2%)', 'scale(1.03) translate(0, -1%)'],
    ['scale(1.03) translate(1.5%, 0)', 'scale(1.11) translate(-1.5%, 0)'],
    ['scale(1.1) translate(-1%, -1.5%)', 'scale(1.01) translate(1%, 1%)']
  ];

  // Photos kept in memory (the last 8): the full-screen preview AND the small thumbnail used for the blurred
  // background, so a slide never waits on the network for either.
  var cache = {}, cacheOrder = [];
  function prefetch(id) {
    if (cache[id]) return cache[id];
    var p = new Image(), t = new Image();
    p.src = Api.preview(id); t.src = Api.thumb(id);
    cache[id] = { p: p, t: t }; cacheOrder.push(id);
    while (cacheOrder.length > 8) delete cache[cacheOrder.shift()];
    return cache[id];
  }
  // Blur + darken a photo's thumbnail into a small canvas, ahead of the swap (see .v-bg in app.css).
  var CAN_FILTER = (function () { try { return 'filter' in document.createElement('canvas').getContext('2d'); } catch (e) { return false; } })();
  function drawBg(canvas, img) {
    var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    ctx.filter = 'none';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!img.naturalWidth) return;
    // cover-crop, drawn a little larger than the canvas so the blur has no soft dark edge
    var pad = 8, s = Math.max((W + 2 * pad) / img.naturalWidth, (H + 2 * pad) / img.naturalHeight);
    var dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    try {
      if (CAN_FILTER) ctx.filter = 'blur(3px) saturate(1.3) brightness(0.5)';
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.filter = 'none';
      if (!CAN_FILTER) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H); }   // tiny canvas + upscale still blurs
    } catch (e) { /* leave it black */ }
  }
  function whenLoaded(img, cb) {   // cb once, on load or error (an image that fails must not block the slide)
    if (img.complete) { cb(); return; }
    var done = false;
    function once() { if (!done) { done = true; cb(); } }
    img.addEventListener('load', once); img.addEventListener('error', once);
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function monthLabel(tb) { if (!tb) return ''; var y = tb.substr(0, 4), m = parseInt(tb.substr(5, 2), 10); return MONTHS[m - 1] + ' ' + y; }
  function fmtDur(d) {  // "0:01:23.456" -> "1:23"
    if (!d) return '';
    var p = d.split(':'); if (p.length < 3) return '';
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10), s = Math.floor(parseFloat(p[2]));
    var ss = (s < 10 ? '0' : '') + s;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss : m + ':' + ss;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var y = iso.substr(0, 4), m = parseInt(iso.substr(5, 2), 10), d = parseInt(iso.substr(8, 2), 10);
    var hh = parseInt(iso.substr(11, 2), 10), mm = iso.substr(14, 2);
    var ap = hh >= 12 ? 'PM' : 'AM'; var h12 = hh % 12 || 12;
    return MONTHS[m - 1].substr(0, 3) + ' ' + d + ', ' + y + (isNaN(hh) ? '' : '  ' + h12 + ':' + mm + ' ' + ap);
  }
  var toastTimer;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 4000);
  }
  function exitApp() { try { tizen.application.getCurrentApplication().exit(); } catch (e) { toast('Exit'); } }

  var timeline = new Source('All Photos', 'visibility=timeline');
  var current = null;   // active screen object
  function show(screen) {
    ['home', 'grid', 'viewer'].forEach(function (id) { $(id).classList.toggle('hidden', id !== screen.id); });
    current = screen;
  }

  /* =========================== HOME =========================== */
  var Home = {
    id: 'home', rows: [], r: 0, cols: [],
    build: function () {
      var self = this;
      var today = new Date();
      var memP = Api.get('/memories').then(function (list) {
        var now = today.getTime();
        return list.filter(function (m) {
          return m.assets && m.assets.length && new Date(m.showAt).getTime() <= now && now <= new Date(m.hideAt).getTime();
        }).sort(function (a, b) { return b.data.year - a.data.year; });
      }).catch(function () { return []; });
      var recentP = timeline.init().then(function (s) {
        if (!s.total) return [];
        var need = Math.min(30, s.total), i, ps = [];
        for (i = 0; i < need; i++) ps.push(s.at(i));
        return Promise.all(ps);
      });
      var albumsP = Api.get('/albums').then(function (a) {
        return a.filter(function (x) { return x.assetCount > 0; }).sort(function (x, y) {
          return (y.endDate || y.updatedAt || '').localeCompare(x.endDate || x.updatedAt || '');
        });
      });
      var peopleP = Api.get('/people?withHidden=false&size=60').then(function (r) {
        return (r.people || []).filter(function (p) { return p.name; });
      }).catch(function () { return []; });

      return Promise.all([memP, recentP, albumsP, peopleP]).then(function (res) {
        self.render(res[0], res[1], res[2], res[3]);
      });
    },
    render: function (memories, recent, albums, people) {
      var rows = [], thisYear = new Date().getFullYear();
      if (memories.length) {
        rows.push({ title: 'On this day', kind: 'memory', h: 280 + 40, items: memories.map(function (m) {
          var ago = thisYear - m.data.year;
          var assets = m.assets.map(function (a) { return { id: a.id, isImage: a.type === 'IMAGE', duration: a.duration }; });
          var over = ago === 1 ? '1 year ago' : ago + ' years ago';
          return { pic: Api.thumb(assets[0].id), over: over,
            open: function () { Grid.open(Source.fixed('On this day · ' + m.data.year + ' (' + over + ')', assets), 0); } };
        }) });
      }
      var rec = [{ kind: 'all', big: 'All\nPhotos', open: function () { Grid.open(timeline, 0); } }];
      recent.forEach(function (a, i) { if (a) rec.push({ pic: Api.thumb(a.id), dur: a.isImage ? '' : fmtDur(a.duration),
        open: function () { Viewer.open(timeline, i); } }); });
      rows.push({ title: 'Recent', kind: 'thumb', h: 240, items: rec });
      if (albums.length) rows.push({ title: 'Albums', kind: 'album', h: 300 + 80, items: albums.map(function (a) {
        return { pic: a.albumThumbnailAssetId ? Api.thumb(a.albumThumbnailAssetId) : '', label: a.albumName,
          sub: a.assetCount + (a.assetCount === 1 ? ' item' : ' items'),
          open: function () { Grid.open(new Source(a.albumName, 'albumId=' + a.id), 0); } };
      }) });
      if (people.length) rows.push({ title: 'People', kind: 'person', h: 200 + 50, items: people.map(function (p) {
        return { pic: Api.personThumb(p.id), label: p.name,
          open: function () { Grid.open(new Source(p.name, 'personId=' + p.id + '&visibility=timeline'), 0); } };
      }) });

      var box = $('rows'); box.innerHTML = '';
      var y = 0;
      rows.forEach(function (row) {
        var rd = el('div', 'row'); rd.style.top = y + 'px'; rd.style.position = 'absolute'; rd.style.width = '1920px';
        rd.appendChild(el('div', 'row-title', row.title));
        var track = el('div', 'row-track');
        row.items.forEach(function (it) {
          var kind = it.kind || row.kind;
          var c = el('div', 'card ' + kind), pic = el('div', 'pic');
          if (it.pic) pic.style.backgroundImage = 'url("' + it.pic + '")';
          if (it.over) pic.appendChild(el('div', 'over', it.over));
          if (it.big) { var b = el('div', 'big'); b.innerHTML = it.big.replace('\n', '<br>'); pic.appendChild(b); }
          if (it.dur) pic.appendChild(el('div', 'vid-badge', '▶ ' + it.dur));
          c.appendChild(pic);
          if (it.label) c.appendChild(el('div', 'label', it.label));
          if (it.sub) c.appendChild(el('div', 'sublabel', it.sub));
          it.node = c; track.appendChild(c);
        });
        rd.appendChild(track);
        row.node = rd; row.track = track; row.y = y;
        box.appendChild(rd);
        y += 56 + row.h + 50;
      });
      this.rows = rows;
      this.cols = rows.map(function () { return 0; });
      this.r = 0;
      this.focus();
    },
    focus: function () {
      var self = this;
      this.rows.forEach(function (row, ri) {
        row.items.forEach(function (it, ci) { it.node.classList.toggle('focus', ri === self.r && ci === self.cols[ri]); });
      });
      var row = this.rows[this.r]; if (!row) return;
      var it = row.items[this.cols[this.r]];
      // horizontal: keep focused card ~1/4 from the left
      var x = Math.max(0, it.node.offsetLeft - 300);
      row.track.style.transform = 'translateX(' + (-x) + 'px)';
      // vertical: focused row near the top
      $('rows').style.transform = 'translateY(' + (-Math.max(0, row.y - 20)) + 'px)';
    },
    key: function (k) {
      var row = this.rows[this.r];
      if (!row) { if (k === KEY.BACK || k === KEY.ESC) exitApp(); return; }
      if (k === KEY.LEFT) { this.cols[this.r] = Math.max(0, this.cols[this.r] - 1); }
      else if (k === KEY.RIGHT) { this.cols[this.r] = Math.min(row.items.length - 1, this.cols[this.r] + 1); }
      else if (k === KEY.UP) { this.r = Math.max(0, this.r - 1); }
      else if (k === KEY.DOWN) { this.r = Math.min(this.rows.length - 1, this.r + 1); }
      else if (k === KEY.ENTER) { row.items[this.cols[this.r]].open(); return; }
      else if (k === KEY.BACK || k === KEY.ESC) { exitApp(); return; }
      else return;
      this.focus();
    }
  };

  /* =========================== GRID =========================== */
  var COLS = 7, TILE = 257, ROWS_VISIBLE = 4;   // 7 x 257 = 1799px; viewport 870px tall
  var Grid = {
    id: 'grid', src: null, f: 0, top: 0, tiles: {}, btn: 0,   // btn: 0 Slideshow, 1 Shuffle, -1 = in the photos
    open: function (src, index) {
      var self = this;
      this.src = src; this.f = index || 0; this.top = 0; this.btn = 0;
      $('grid-title').textContent = src.title; $('grid-sub').textContent = '';
      $('grid-canvas').innerHTML = ''; this.tiles = {};
      if (this.changeFn && this.prevSrc) this.prevSrc.offChange(this.changeFn);
      this.changeFn = function () { self.render(); };
      src.onChange(this.changeFn); this.prevSrc = src;
      show(this);
      src.init().then(function () {
        $('grid-canvas').style.height = Math.ceil(src.total / COLS) * TILE + 'px';
        if (!src.total) { $('grid-sub').textContent = 'Empty'; return; }
        self.focus();
      }, function (e) { toast('Could not load: ' + e.message); });
    },
    focus: function () {
      $('btn-play').classList.toggle('focus', this.btn === 0);
      $('btn-shuffle').classList.toggle('focus', this.btn === 1);
      var row = Math.floor(this.f / COLS);
      if (row < this.top + 1) this.top = Math.max(0, row - 1);
      if (row > this.top + ROWS_VISIBLE - 2) this.top = row - (ROWS_VISIBLE - 2);
      $('grid-canvas').style.transform = 'translateY(' + (-this.top * TILE) + 'px)';
      var m = this.src.monthOf(this.f);
      $('grid-sub').textContent = (m ? monthLabel(m) + '   ·   ' : '') + (this.f + 1) + ' / ' + this.src.total;
      this.render();
    },
    render: function () {
      var src = this.src, canvas = $('grid-canvas');
      var first = Math.max(0, (this.top - 2) * COLS), last = Math.min(src.total, (this.top + ROWS_VISIBLE + 3) * COLS);
      var keep = {}, i;
      for (i = first; i < last; i++) {
        keep[i] = 1;
        var t = this.tiles[i];
        if (!t) {
          t = el('div', 'tile');
          t.style.left = (i % COLS) * TILE + 'px'; t.style.top = Math.floor(i / COLS) * TILE + 'px';
          canvas.appendChild(t); this.tiles[i] = t;
        }
        if (!t.loaded) {
          var a = src.peek(i);
          if (a) {
            t.loaded = 1;
            t.style.backgroundImage = 'url("' + Api.thumb(a.id) + '")';
            if (!a.isImage) t.appendChild(el('div', 'vid-badge', '▶ ' + fmtDur(a.duration)));
            var b = src.bucketOf(i);
            if (src.buckets[b].timeBucket && src.buckets[b].start === i) t.appendChild(el('div', 'month', monthLabel(src.buckets[b].timeBucket)));
          }
        }
        t.classList.toggle('focus', this.btn < 0 && i === this.f);
      }
      for (i in this.tiles) {
        if (!keep[i]) { canvas.removeChild(this.tiles[i]); delete this.tiles[i]; }
      }
    },
    start: function (shuffle) {
      var self = this;
      if (!shuffle) { Viewer.open(this.src, 0, this, true); return; }
      this.src.shuffled().then(function (s) { Viewer.open(s, 0, self, true); }, function (e) { toast('Could not shuffle: ' + e.message); });
    },
    key: function (k) {
      var n = this.src.total;
      if (k === KEY.BACK || k === KEY.ESC) { if (this.src.offChange) this.src.offChange(this.changeFn); show(Home); Home.focus(); return; }
      if (!n) return;
      if (this.btn >= 0) {   // on the Slideshow / Shuffle buttons
        if (k === KEY.LEFT) this.btn = 0;
        else if (k === KEY.RIGHT) this.btn = 1;
        else if (k === KEY.DOWN) this.btn = -1;
        else if (k === KEY.ENTER) { this.start(this.btn === 1); return; }
        else if (k === KEY.PLAY || k === KEY.PLAYPAUSE) { this.start(false); return; }
        else return;
        this.focus(); return;
      }
      if (k === KEY.UP && this.f < COLS) { this.btn = 0; this.focus(); return; }
      if (k === KEY.LEFT) this.f = Math.max(0, this.f - 1);
      else if (k === KEY.RIGHT) this.f = Math.min(n - 1, this.f + 1);
      else if (k === KEY.UP) this.f = Math.max(0, this.f - COLS);
      else if (k === KEY.DOWN) this.f = Math.min(n - 1, this.f + COLS);
      else if (k === KEY.CHDOWN || k === KEY.PGDN || k === KEY.FF) this.f = Math.min(n - 1, this.f + COLS * 3);
      else if (k === KEY.CHUP || k === KEY.PGUP || k === KEY.RW) this.f = Math.max(0, this.f - COLS * 3);
      else if (k === KEY.ENTER) { Viewer.open(this.src, this.f, this); return; }
      else if (k === KEY.PLAY || k === KEY.PLAYPAUSE) { Viewer.open(this.src, this.f, this, true); return; }
      else return;
      this.focus();
    }
  };

  /* =========================== VIEWER =========================== */
  var Viewer = {
    id: 'viewer', src: null, i: 0, back: null, slide: false, timer: null, info: false, front: 'a', seq: 0,
    open: function (src, index, back, slideshow) {
      var self = this;
      this.src = src; this.i = index; this.back = back || Home; this.info = false;
      $('v-info').classList.add('hidden');
      ['a', 'b'].forEach(function (x) { var im = $('v-img-' + x); im.classList.remove('on'); im.removeAttribute('src'); im.style.transition = ''; im.style.transform = 'none'; $('v-bg-' + x).classList.remove('on'); });
      show(this);
      src.init().then(function () { self.showAt(index); if (slideshow) self.setSlide(true); });
    },
    close: function () {
      this.setSlide(false); this.stopVideo();
      if (this.back === Grid) {
        Grid.f = this.src.baseIndex ? this.src.baseIndex(this.i) : this.i;   // shuffled -> real position
        Grid.btn = -1; show(Grid); Grid.focus();
      } else { show(Home); Home.focus(); }
    },
    stopVideo: function () {
      Players.av.stop(); Players.html.stop(); this.player = null;
    },
    // The spinner only appears if something takes longer than SPIN_DELAY (no flash for cached photos).
    spin: function (on) {
      clearTimeout(this.spinTimer);
      if (on) this.spinTimer = setTimeout(function () { $('v-spinner').classList.remove('hidden'); }, SPIN_DELAY);
      else $('v-spinner').classList.add('hidden');
    },
    showAt: function (i) {
      var self = this, seq = ++this.seq;
      if (i < 0 || i >= this.src.total) return;
      this.i = i;
      this.spin(true);
      this.src.at(i).then(function (a) {
        if (seq !== self.seq || !a) return;
        self.asset = a;
        self.bar(a);
        if (self.info) self.loadInfo(a);
        if (a.isImage) { self.stopVideo(); self.showImage(a, seq); }
        else self.showVideo(a);
        // warm the next photos (two ahead during a slideshow) and the previous one
        var ahead = self.slide ? [i + 1, i + 2, i - 1] : [i + 1, i - 1];
        ahead.forEach(function (j) { self.src.at(j).then(function (n) { if (n && n.isImage) prefetch(n.id); }); });
      }, function (e) { self.spin(false); toast('Could not load: ' + e.message); });
    },
    showImage: function (a, seq) {
      var self = this, back = this.front === 'a' ? 'b' : 'a';
      var im = $('v-img-' + back), fr = $('v-img-' + this.front);
      var bg = $('v-bg-' + back), bgFr = $('v-bg-' + this.front);
      var c = prefetch(a.id);
      im.style.transition = 'none'; im.style.transform = 'none';
      var pending = 2;
      function ready() {
        if (--pending > 0 || seq !== self.seq) return;
        // one more frame so the blurred background is painted before both layers fade in together
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          if (seq !== self.seq) return;
          self.spin(false);
          if (self.slide) self.kenBurns(im); else { im.style.transition = ''; im.style.transform = 'none'; }
          bg.classList.add('on'); bgFr.classList.remove('on');
          im.classList.add('on'); fr.classList.remove('on'); self.front = back;
          if (self.slide) self.schedule();
        }); });
      }
      whenLoaded(c.t, function () { if (seq === self.seq) drawBg(bg, c.t); ready(); });   // background drawn before the swap
      im.onload = ready;
      im.onerror = function () { self.spin(false); toast('Could not load this photo'); if (self.slide) self.schedule(); };
      im.src = Api.preview(a.id);
    },
    // Slow zoom + pan for the whole time a photo is on screen (slideshow only), random direction each photo.
    kenBurns: function (im) {
      var m = KB_MOVES[Math.floor(Math.random() * KB_MOVES.length)];
      im.style.transition = 'none';
      im.style.transform = m[0];
      void im.offsetWidth;                             // commit the start position before animating
      im.style.transition = 'opacity 0.6s ease, transform ' + (SLIDE_MS + 1200) + 'ms linear';
      im.style.transform = m[1];
    },
    freezeMotion: function () {                        // pause: hold the photo where the zoom/pan is now
      var im = $('v-img-' + this.front), t = window.getComputedStyle(im).transform;
      im.style.transition = 'opacity 0.6s ease';
      im.style.transform = t && t !== 'none' ? t : 'none';
    },
    // Videos use Samsung's native player when available (see js/video.js), else the HTML5 <video>.
    showVideo: function (a) {
      var self = this, seq = this.seq, url = Api.video(a.id), poster = Api.preview(a.id);
      ['a', 'b'].forEach(function (x) { $('v-img-' + x).classList.remove('on'); $('v-bg-' + x).classList.remove('on'); });
      clearTimeout(this.timer);
      this.stopVideo();
      var h = {
        onPlaying: function () { if (seq === self.seq) self.spin(false); },
        onEnded: function () { if (seq === self.seq && self.slide) self.next(); },
        onError: function (msg) {
          if (seq !== self.seq) return;
          if (self.player === Players.av) {          // AVPlay failed: fall back to HTML5 once
            Players.av.stop(); self.player = Players.html;
            Players.html.start(url, h, poster); return;
          }
          self.spin(false); toast('This video can\u2019t be played on the TV'); if (self.slide) self.schedule();
        }
      };
      this.player = Players.av.available() ? Players.av : Players.html;
      try { this.player.start(url, h, poster); } catch (e) { h.onError('start: ' + e.message); }
    },
    bar: function (a) {
      var m = this.src.monthOf(this.i);
      $('v-bar-left').textContent = (m ? monthLabel(m) : this.src.title) + (a.isImage ? '' : '   ·   video ' + fmtDur(a.duration));
      $('v-bar-right').textContent = (this.src.shuffle ? '⇄ Shuffle   ' : '') + (this.i + 1) + ' / ' + this.src.total;
      this.flashBar();
    },
    flashBar: function () {
      var b = $('v-bar'); b.classList.remove('hidden');
      clearTimeout(this.barTimer);
      if (!this.info) this.barTimer = setTimeout(function () { b.classList.add('hidden'); }, 3000);
    },
    badge: function (txt) {
      var b = $('v-badge'); b.textContent = txt; b.classList.remove('hidden');
      clearTimeout(this.badgeTimer); this.badgeTimer = setTimeout(function () { b.classList.add('hidden'); }, 2000);
    },
    loadInfo: function (a) {
      var box = $('v-info'), self = this;
      box.innerHTML = '<span class="k">Loading…</span>';
      Api.get('/assets/' + a.id).then(function (d) {
        if (self.asset !== a) return;
        var x = d.exifInfo || {}, rows = [];
        rows.push(['Date', fmtDate(d.localDateTime)]);
        var place = [x.city, x.state, x.country].filter(function (s) { return s; }).join(', ');
        if (place) rows.push(['Place', place]);
        var cam = [x.make, x.model].filter(function (s) { return s; }).join(' ');
        if (cam) rows.push(['Camera', cam]);
        var exp = [x.fNumber ? 'f/' + x.fNumber : '', x.exposureTime ? x.exposureTime + ' s' : '', x.iso ? 'ISO ' + x.iso : '',
          x.focalLength ? Math.round(x.focalLength) + ' mm' : ''].filter(function (s) { return s; }).join('   ');
        if (exp) rows.push(['Exposure', exp]);
        if (x.exifImageWidth) rows.push(['Size', x.exifImageWidth + ' × ' + x.exifImageHeight]);
        if (d.people && d.people.length) rows.push(['People', d.people.filter(function (p) { return p.name; }).map(function (p) { return p.name; }).join(', ')]);
        rows.push(['File', d.originalFileName]);
        box.innerHTML = '';
        rows.forEach(function (r) { if (!r[1]) return; var line = el('div'); line.appendChild(el('span', 'k', r[0] + ':  ')); line.appendChild(document.createTextNode(r[1])); box.appendChild(line); });
      }, function () { box.textContent = 'No details'; });
    },
    toggleInfo: function () {
      this.info = !this.info;
      $('v-info').classList.toggle('hidden', !this.info);
      if (this.info && this.asset) this.loadInfo(this.asset);
      this.flashBar();
    },
    schedule: function () { var self = this; clearTimeout(this.timer); this.timer = setTimeout(function () { self.next(); }, SLIDE_MS); },
    setSlide: function (on) {
      this.slide = on; clearTimeout(this.timer);
      if (on) {
        this.badge('▶  Slideshow');
        if (this.asset && this.asset.isImage) { this.kenBurns($('v-img-' + this.front)); this.schedule(); }
        var self = this;   // warm the next two right away
        [this.i + 1, this.i + 2].forEach(function (j) { if (self.src) self.src.at(j).then(function (n) { if (n && n.isImage) prefetch(n.id); }); });
      }
      else if (this.src) { this.badge('❚❚  Paused'); this.freezeMotion(); }
    },
    next: function () {
      if (this.i + 1 < this.src.total) this.showAt(this.i + 1);
      else if (this.slide) this.showAt(0);
    },
    key: function (k) {
      var p = this.player, isVideo = !!(this.asset && !this.asset.isImage && p);
      if (k === KEY.BACK || k === KEY.ESC) { if (this.info) { this.toggleInfo(); return; } this.close(); return; }
      if (k === KEY.RIGHT) { this.next(); if (this.slide) this.schedule(); }
      else if (k === KEY.LEFT) { if (this.i > 0) this.showAt(this.i - 1); if (this.slide) this.schedule(); }
      else if (k === KEY.UP || k === KEY.DOWN) this.toggleInfo();
      else if (k === KEY.ENTER) {
        if (isVideo) p.toggle();
        else this.toggleInfo();
      }
      else if (k === KEY.PLAYPAUSE) {
        if (isVideo && !this.slide) p.toggle(); else this.setSlide(!this.slide);
      }
      else if (k === KEY.PLAY) { if (isVideo && p.paused()) p.play(); else this.setSlide(true); }
      else if (k === KEY.PAUSE || k === KEY.STOP) { if (isVideo) p.pause(); this.setSlide(false); }
      else if (k === KEY.FF && isVideo) p.skip(10);
      else if (k === KEY.RW && isVideo) p.skip(-10);
    }
  };

  /* =========================== BOOT =========================== */
  function clock() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    $('clock').textContent = (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function registerKeys() {
    try {
      ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'ChannelUp', 'ChannelDown']
        .forEach(function (n) { try { tizen.tvinputdevice.registerKey(n); } catch (e) {} });
    } catch (e) { /* not on a TV (desktop test) */ }
  }
  document.addEventListener('keydown', function (e) {
    if (!current) return;
    var k = e.keyCode;
    if (k === KEY.BACKSPACE) k = KEY.BACK;        // desktop testing
    if (k === 32) k = KEY.PLAYPAUSE;               // desktop testing: space
    current.key(k);
    e.preventDefault();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && current === Viewer) { Viewer.setSlide(false); if (Viewer.player) Viewer.player.pause(); }
  });

  registerKeys(); clock(); setInterval(clock, 15000);
  show(Home);
  if (!window.IMMICH_CONFIG || !window.IMMICH_CONFIG.key) { toast('Missing config.js (server URL + API key)', 60000); return; }
  Home.build().catch(function (e) { toast('Could not reach Immich: ' + e.message, 15000); });
  window.ImmichTV = { Home: Home, Grid: Grid, Viewer: Viewer };   // for debugging
})();
