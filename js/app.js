/* ============================================================
   DCC-94 Batch Reunion 2026 - DP Frame Studio
   Everything runs locally: the photo is never uploaded anywhere.
   ============================================================ */
(function () {
  'use strict';

  /* ---- Frame geometry, measured from Frame.png ----
     The artwork is 1400x1200. Inside it sits a circular badge:

       r <= 420   transparent cut-out (the photo shows through)
       r 420-438  mint ring          #98d6d6
       r 438-452  dark teal ring     #005354
       r >  452   picnic scenery

     all centred on (700, 591). The teal wave carrying the batch
     name clips the cut-out from about y = 830 down.                */
  var FRAME_W = 1400, FRAME_H = 1200;
  /* The badge is very slightly taller than it is wide, and sits a few px
     below the cut-out's centre, so it is cut out as an ellipse. */
  var BADGE = { cx: 700, cy: 599, rx: 452, ry: 459 };
  var BOX = { cx: 700, cy: 545, size: 880 };  // square the photo cover-fits into
  var FACE_BIAS = 0.40;          // point of the photo that lands on BOX centre
  var PAN_LIMIT = 500;           // px of travel each way
  var MAX_SOURCE_EDGE = 2200;    // downscale huge phone photos once, on load

  /* Facebook masks a profile picture to the circle inscribed in the square.
     The Facebook DP is the supplied artwork at its own 1:1 scale - never
     resized, never redrawn - squared off to 1200x1200 and centred on the
     badge, so it reads as the full frame with its scenery, just rounded. */

  var SHAPES = {
    fb:    { label: 'Facebook DP', file: 'facebook' },
    frame: { label: 'Full Frame',  file: 'full-frame' },
    story: { label: 'Story',       file: 'story' }
  };

  var EVENT = {
    society: 'DCC-94 CO-OPERATIVE SOCIETY',
    title: 'DCC-94 BATCH REUNION',
    year: '2026',
    date: '27 November 2026',
    venue: 'Swapno Kanon Resort, Ulukhola, Gazipur'
  };

  /* Each shape is a scale + offset applied to the 1400x1200 artwork. */
  function shapeTransform(shape) {
    if (shape === 'frame') {
      return { w: FRAME_W, h: FRAME_H, k: 1, tx: 0, ty: 0 };
    }
    if (shape === 'story') {
      var cardW = 1000, sk = cardW / FRAME_W;
      return {
        w: 1080, h: 1920, k: sk, tx: 40, ty: 330,
        cardW: cardW, cardH: Math.round(cardW * FRAME_H / FRAME_W)
      };
    }
    // facebook: artwork at native scale, squared off and centred on the badge.
    // The offsets are clamped so the artwork always covers the whole square.
    var S = 1200, fk = 1;
    return {
      w: S, h: S, k: fk,
      tx: clamp(S / 2 - BADGE.cx * fk, S - FRAME_W * fk, 0),
      ty: clamp(S / 2 - BADGE.cy * fk, S - FRAME_H * fk, 0)
    };
  }

  /* ---------------- state ---------------- */
  var state = {
    photo: null,      // drawable source (ImageBitmap / Image / Canvas)
    name: '',
    scale: 1,
    offX: 0,
    offY: 0,
    shape: 'fb',
    format: 'png'
  };
  var frameImg = null;
  var rafPending = false;

  /* ---------------- elements ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var dropZone   = $('dropZone');
  var fileInput  = $('fileInput');
  var dropIdle   = $('dropIdle');
  var dropFilled = $('dropFilled');
  var fileThumb  = $('fileThumb');
  var fileName   = $('fileName');
  var stageFrame = $('stageFrame');
  var preview    = $('preview');
  var stageBadge = $('stageBadge');
  var stageHint  = $('stageHint');
  var elScale    = $('rScale');
  var elX        = $('rX');
  var elY        = $('rY');
  var outScale   = $('vScale');
  var outX       = $('vX');
  var outY       = $('vY');
  var btnDownload= $('btnDownload');
  var btnReset   = $('btnReset');
  var shapeChips = document.querySelectorAll('[data-shape]');
  var fmtChips   = document.querySelectorAll('[data-format]');
  var resultWrap = $('resultWrap');
  var resultPic  = $('resultPic');
  var resultImg  = $('resultImg');
  var resultMeta = $('resultMeta');
  var toastEl    = $('toast');

  var pctx = preview.getContext('2d');

  /* ---------------- helpers ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 3200);
  }

  function paintSliderFill(el) {
    var min = parseFloat(el.min), max = parseFloat(el.max);
    var pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
    el.style.setProperty('--fill', pct + '%');
  }

  function srcSize(img) {
    return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---- where the photo sits inside the 1400x1200 artwork ---- */
  function layout() {
    var s = srcSize(state.photo);
    var cover = Math.max(BOX.size / s.w, BOX.size / s.h);
    var dw = s.w * cover, dh = s.h * cover;

    // Bias toward the top of the photo (faces), but never uncover the hole.
    var slack = BOX.size / (2 * dh);
    var f = clamp(FACE_BIAS, slack, 1 - slack);

    var x = BOX.cx - dw / 2;
    var y = BOX.cy - f * dh;

    // Scale about the centre of the cut-out so zooming feels anchored.
    var k = state.scale;
    return {
      x: BOX.cx + (x - BOX.cx) * k + state.offX,
      y: BOX.cy + (y - BOX.cy) * k + state.offY,
      w: dw * k,
      h: dh * k
    };
  }

  /* ---- placeholder shown before a photo is chosen ---- */
  function drawPlaceholder(ctx) {
    var g = ctx.createLinearGradient(0, 120, 0, 980);
    g.addColorStop(0, '#E4F3F2');
    g.addColorStop(1, '#A9D9D6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FRAME_W, FRAME_H);

    ctx.fillStyle = 'rgba(1,113,115,.26)';
    ctx.beginPath();
    ctx.arc(700, 420, 118, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(700, 880, 232, 290, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  }

  /* ---- photo then artwork, in 1400x1200 artwork coordinates ---- */
  function drawArtwork(ctx) {
    if (state.photo) {
      var L = layout();
      ctx.drawImage(state.photo, L.x, L.y, L.w, L.h);
    } else {
      drawPlaceholder(ctx);
    }
    if (frameImg) ctx.drawImage(frameImg, 0, 0, FRAME_W, FRAME_H);
  }

  /* ---------------- story furniture ---------------- */
  var OUTFIT = '"Outfit", system-ui, sans-serif';
  var BALOO = '"Baloo 2", "Trebuchet MS", sans-serif';
  var STORY_MAX_W = 980;   // 1080 canvas, 50px of air each side

  /* Centred on the story canvas, shrinking the type until it fits maxW.
     EVENT is documented as editable, so longer text must not overflow. */
  function centeredText(ctx, text, y, weight, size, family, fill, spacing, maxW) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (spacing || 0) + 'px';

    var s = size;
    ctx.font = weight + ' ' + s + 'px ' + family;
    if (maxW) {
      while (ctx.measureText(text).width > maxW && s > 16) {
        s -= 2;
        ctx.font = weight + ' ' + s + 'px ' + family;
      }
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, 540, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function drawStoryBackground(ctx, T) {
    var g = ctx.createLinearGradient(0, 0, 0, T.h);
    g.addColorStop(0, '#0FA8CB');
    g.addColorStop(0.42, '#79D7E9');
    g.addColorStop(1, '#015E60');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, T.w, T.h);

    var glow = ctx.createRadialGradient(860, 250, 20, 860, 250, 520);
    glow.addColorStop(0, 'rgba(255,255,255,.55)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, T.w, 900);

    // white card behind the artwork, so it reads as mounted, not pasted
    var pad = 14;
    ctx.save();
    ctx.shadowColor = 'rgba(1,58,61,.38)';
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    roundRectPath(ctx, T.tx - pad, T.ty - pad, T.cardW + pad * 2, T.cardH + pad * 2, 42);
    ctx.fill();
    ctx.restore();
  }

  function drawStoryText(ctx) {
    centeredText(ctx, EVENT.society, 208, '600', 30, OUTFIT,
      'rgba(255,255,255,.92)', 6, STORY_MAX_W);

    ctx.save();
    ctx.shadowColor = 'rgba(1,58,61,.45)';
    ctx.shadowOffsetY = 6;
    ctx.shadowBlur = 0;
    centeredText(ctx, EVENT.title, 1400, '800', 82, BALOO, '#FFFFFF', 1, STORY_MAX_W);
    centeredText(ctx, EVENT.year, 1492, '800', 78, BALOO, '#F9E8D8', 4, STORY_MAX_W);
    ctx.restore();

    // Date pill, sized from its text so a longer date still fits inside it.
    ctx.font = '600 40px ' + OUTFIT;
    var pillH = 76;
    var pillW = Math.min(STORY_MAX_W, Math.max(360, ctx.measureText(EVENT.date).width + 100));
    var pillX = (1080 - pillW) / 2, pillY = 1548;
    ctx.fillStyle = 'rgba(1,78,82,.88)';
    roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();

    centeredText(ctx, EVENT.date, pillY + 51, '600', 40, OUTFIT, '#FFFFFF', 1, pillW - 60);
    centeredText(ctx, EVENT.venue, 1692, '500', 34, OUTFIT, 'rgba(255,255,255,.94)', 0, STORY_MAX_W);
  }

  /* ---- preview-only: show what Facebook's circular mask will hide ---- */
  function drawMaskGuide(ctx, T) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, T.w, T.h);
    ctx.arc(T.w / 2, T.h / 2, T.w / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3,32,31,.55)';
    ctx.fill('evenodd');
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(T.w / 2, T.h / 2, T.w / 2 - 2, 0, Math.PI * 2);
    ctx.setLineDash([18, 14]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- the one renderer ---------------- */
  function renderOutput(ctx, shape, pixelScale, forPreview) {
    var T = shapeTransform(shape);
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    ctx.clearRect(0, 0, T.w, T.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (shape === 'story') drawStoryBackground(ctx, T);

    ctx.save();
    if (shape === 'story') {
      roundRectPath(ctx, T.tx, T.ty, T.cardW, T.cardH, 30);
      ctx.clip();
    }
    ctx.translate(T.tx, T.ty);
    ctx.scale(T.k, T.k);
    drawArtwork(ctx);
    ctx.restore();

    if (shape === 'story') drawStoryText(ctx);
    if (forPreview && shape === 'fb') drawMaskGuide(ctx, T);
    return T;
  }

  function renderPreview() {
    var T = shapeTransform(state.shape);
    var ps = Math.min(1, 1100 / Math.max(T.w, T.h));
    var cw = Math.round(T.w * ps), ch = Math.round(T.h * ps);
    if (preview.width !== cw || preview.height !== ch) {
      preview.width = cw;
      preview.height = ch;
    }
    stageFrame.style.aspectRatio = T.w + ' / ' + T.h;
    renderOutput(pctx, state.shape, ps, true);
  }

  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; renderPreview(); });
  }

  /* ---------------- frame asset ---------------- */
  function loadFrame() {
    return new Promise(function (resolve) {
      var tryList = ['assets/frame.webp', 'assets/frame.png'];
      var i = 0;
      (function next() {
        if (i >= tryList.length) { resolve(null); return; }
        var im = new Image();
        im.onload = function () { frameImg = im; resolve(im); };
        im.onerror = function () { i++; next(); };
        im.src = tryList[i];
      })();
    });
  }

  /* ---------------- photo intake ---------------- */
  function shrinkIfHuge(img) {
    var s = srcSize(img);
    var longest = Math.max(s.w, s.h);
    if (longest <= MAX_SOURCE_EDGE) return img;
    var k = MAX_SOURCE_EDGE / longest;
    var c = document.createElement('canvas');
    c.width = Math.round(s.w * k);
    c.height = Math.round(s.h * k);
    var cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return decodeViaTag(file); });
    }
    return decodeViaTag(file);
  }

  function decodeViaTag(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      im.src = url;
    });
  }

  function acceptFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast('That file is not an image. Choose a JPG, PNG or WEBP.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast('That photo is over 25 MB. Try a smaller one.');
      return;
    }
    decode(file).then(function (img) {
      state.photo = shrinkIfHuge(img);
      state.name = file.name;
      autoFit();
      setHasPhoto(true);
      showThumb(file);
      toast('Photo placed. Drag it to line up your face.');
    }).catch(function () {
      toast('Could not read that image. Try a different file.');
    });
  }

  function showThumb(file) {
    var url = URL.createObjectURL(file);
    fileThumb.onload = function () { URL.revokeObjectURL(url); };
    fileThumb.src = url;
    fileName.textContent = file.name;
  }

  function setHasPhoto(has) {
    dropZone.classList.toggle('has-file', has);
    dropIdle.hidden = has;
    dropFilled.hidden = !has;
    [elScale, elX, elY].forEach(function (el) { el.disabled = !has; });
    btnDownload.disabled = !has;
    btnReset.disabled = !has;
    preview.classList.toggle('is-live', has);
    stageBadge.textContent = has ? 'Live preview' : 'Sample preview';
  }

  /* ---------------- controls ---------------- */
  function autoFit() {
    state.scale = 1; state.offX = 0; state.offY = 0;
    elScale.value = 100; elX.value = 0; elY.value = 0;
    syncReadouts();
    schedule();
  }

  function syncReadouts() {
    outScale.textContent = Math.round(state.scale * 100) + '%';
    outX.textContent = Math.round(state.offX);
    outY.textContent = Math.round(state.offY);
    [elScale, elX, elY].forEach(paintSliderFill);
  }

  elScale.addEventListener('input', function () {
    state.scale = parseInt(elScale.value, 10) / 100;
    syncReadouts(); schedule();
  });
  elX.addEventListener('input', function () {
    state.offX = parseInt(elX.value, 10);
    syncReadouts(); schedule();
  });
  elY.addEventListener('input', function () {
    state.offY = parseInt(elY.value, 10);
    syncReadouts(); schedule();
  });

  btnReset.addEventListener('click', function () {
    autoFit();
    toast('Back to the auto-fitted position.');
  });

  function setShapeHint() {
    stageHint.hidden = state.shape !== 'fb';
  }

  shapeChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.shape = chip.dataset.shape;
      shapeChips.forEach(function (c) {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      setShapeHint();
      schedule();
    });
  });

  fmtChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.format = chip.dataset.format;
      fmtChips.forEach(function (c) {
        c.setAttribute('aria-pressed', String(c === chip));
      });
    });
  });

  /* ---------------- drag + wheel on the preview ---------------- */
  var drag = null;
  preview.addEventListener('pointerdown', function (e) {
    if (!state.photo) return;
    preview.setPointerCapture(e.pointerId);
    preview.classList.add('is-drag');
    drag = { x: e.clientX, y: e.clientY, ox: state.offX, oy: state.offY };
  });
  preview.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var T = shapeTransform(state.shape);
    var rect = preview.getBoundingClientRect();
    // screen px -> output px -> artwork px
    var k = (T.w / rect.width) / T.k;
    state.offX = clamp(drag.ox + (e.clientX - drag.x) * k, -PAN_LIMIT, PAN_LIMIT);
    state.offY = clamp(drag.oy + (e.clientY - drag.y) * k, -PAN_LIMIT, PAN_LIMIT);
    elX.value = Math.round(state.offX);
    elY.value = Math.round(state.offY);
    syncReadouts(); schedule();
  });
  ['pointerup', 'pointercancel'].forEach(function (evt) {
    preview.addEventListener(evt, function () {
      drag = null;
      preview.classList.remove('is-drag');
    });
  });
  preview.addEventListener('wheel', function (e) {
    if (!state.photo) return;
    e.preventDefault();
    var next = clamp(state.scale * (e.deltaY > 0 ? 0.94 : 1.06), 0.5, 3);
    state.scale = next;
    elScale.value = Math.round(next * 100);
    syncReadouts(); schedule();
  }, { passive: false });

  /* ---------------- drop / paste / picker ---------------- */
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) acceptFile(fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) {
      e.preventDefault(); dropZone.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) {
      e.preventDefault(); dropZone.classList.remove('is-over');
    });
  });
  dropZone.addEventListener('drop', function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) acceptFile(dt.files[0]);
  });

  window.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        acceptFile(items[i].getAsFile());
        break;
      }
    }
  });

  /* ---------------- export ---------------- */
  function buildOutput() {
    var T = shapeTransform(state.shape);
    var out = document.createElement('canvas');
    out.width = T.w; out.height = T.h;
    renderOutput(out.getContext('2d'), state.shape, 1, false);
    return out;
  }

  function ensureFonts() {
    if (state.shape !== 'story') return Promise.resolve();
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('800 82px "Baloo 2"'),
      document.fonts.load('600 40px "Outfit"'),
      document.fonts.load('500 34px "Outfit"')
    ]).catch(function () {});
  }

  function exportImage() {
    if (!state.photo) return;
    btnDownload.disabled = true;
    ensureFonts().then(function () {
      var out = buildOutput();
      var mime = state.format === 'jpg' ? 'image/jpeg' : 'image/png';
      var ext = state.format === 'jpg' ? 'jpg' : 'png';
      var file = 'DCC-94-Reunion-2026-' + SHAPES[state.shape].file + '.' + ext;

      out.toBlob(function (blob) {
        btnDownload.disabled = false;
        if (!blob) { toast('Could not build the image. Try another photo.'); return; }
        var url = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href = url; a.download = file; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();

        resultImg.src = url;
        resultImg.alt = 'Your ' + SHAPES[state.shape].label + ' for the DCC-94 Reunion 2026';
        resultPic.classList.toggle('is-circle', state.shape === 'fb');
        resultMeta.textContent = SHAPES[state.shape].label + ' · ' +
          out.width + ' × ' + out.height + ' · ' + ext.toUpperCase() +
          ' · ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB';
        resultWrap.hidden = false;

        toast('Saved as ' + file);
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      }, mime, state.format === 'jpg' ? 0.92 : undefined);
    });
  }

  btnDownload.addEventListener('click', exportImage);

  /* ---------------- boot ---------------- */
  setHasPhoto(false);
  setShapeHint();
  syncReadouts();
  renderPreview();
  loadFrame().then(function (im) {
    if (!im) {
      toast('The frame artwork could not load. Check the assets folder.');
      return;
    }
    renderPreview();
  });
})();
