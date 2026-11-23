/* Video playback with two interchangeable players:
   - AvPlayer: Samsung's native player (webapis.avplay). It draws on the TV's video plane BEHIND the page, so the
     page turns transparent while it plays (html.avplay). Used on TVs because the HTML5 <video> path mis-places
     phone videos that carry a rotation tag (portrait clips shifted and cropped).
   - HtmlPlayer: the plain <video> element; used off-TV, or if AVPlay fails to start.
   Both expose: start(url, h), toggle(), play(), pause(), skip(seconds), stop(), paused(), name.
   h = { onPlaying(info), onEnded(), onError(msg) }. ES2017 at most (TV engine is Chromium ~63). */
(function (global) {
  'use strict';
  function $(id) { return document.getElementById(id); }

  var HtmlPlayer = {
    name: 'HTML5',
    start: function (url, h, poster) {
      var v = $('v-video');
      v.classList.remove('hidden');
      if (poster) v.poster = poster;
      v.onplaying = function () { h.onPlaying({ width: v.videoWidth, height: v.videoHeight }); };
      v.onended = function () { h.onEnded(); };
      v.onerror = function () { h.onError('HTML5 video error'); };
      v.src = url;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    },
    paused: function () { return $('v-video').paused; },
    play: function () { var p = $('v-video').play(); if (p && p.catch) p.catch(function () {}); },
    pause: function () { $('v-video').pause(); },
    toggle: function () { if (this.paused()) this.play(); else this.pause(); },
    skip: function (s) { var v = $('v-video'); v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + s)); },
    stop: function () { var v = $('v-video'); v.pause(); v.removeAttribute('src'); v.load(); v.classList.add('hidden'); }
  };

  var AvPlayer = {
    name: 'AVPlay',
    active: false,
    available: function () { return !!(global.webapis && global.webapis.avplay); },
    start: function (url, h) {
      var av = global.webapis.avplay, self = this, started = false;
      this.close();
      document.documentElement.classList.add('avplay');
      $('av-player').style.display = 'block';
      this.active = true;
      av.open(url);
      av.setDisplayRect(0, 0, 1920, 1080);   // 1920x1080 coordinate space on 2018+ TVs
      try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {}
      av.setListener({
        onbufferingstart: function () {},
        onbufferingprogress: function () {},
        onbufferingcomplete: function () {},
        oncurrentplaytime: function () { if (!started) { started = true; h.onPlaying(self.info()); } },
        onstreamcompleted: function () { h.onEnded(); },
        onerror: function (e) { h.onError('AVPlay error: ' + e); },
        onevent: function () {}
      });
      av.prepareAsync(function () { try { av.play(); } catch (e) { h.onError('AVPlay play: ' + e.message); } },
                      function (e) { h.onError('AVPlay prepare: ' + (e && e.name ? e.name : e)); });
    },
    info: function () {   // what the TV decoded: size + codec of the video track
      try {
        var s = global.webapis.avplay.getCurrentStreamInfo();
        for (var i = 0; i < s.length; i++) {
          if (s[i].type === 'VIDEO') {
            var x = JSON.parse(s[i].extra_info || '{}');
            return { width: x.Width, height: x.Height, codec: x.fourCC };
          }
        }
      } catch (e) {}
      return {};
    },
    state: function () { try { return global.webapis.avplay.getState(); } catch (e) { return 'NONE'; } },
    paused: function () { return this.state() === 'PAUSED'; },
    play: function () { try { global.webapis.avplay.play(); } catch (e) {} },
    pause: function () { try { global.webapis.avplay.pause(); } catch (e) {} },
    toggle: function () { if (this.state() === 'PLAYING') this.pause(); else this.play(); },
    skip: function (s) {
      try { if (s > 0) global.webapis.avplay.jumpForward(s * 1000); else global.webapis.avplay.jumpBackward(-s * 1000); } catch (e) {}
    },
    close: function () {
      try { global.webapis.avplay.stop(); } catch (e) {}
      try { global.webapis.avplay.close(); } catch (e) {}
    },
    stop: function () {
      if (!this.active) return;
      this.close();
      this.active = false;
      $('av-player').style.display = 'none';
      document.documentElement.classList.remove('avplay');
    }
  };

  global.Players = { html: HtmlPlayer, av: AvPlayer };
})(this);
