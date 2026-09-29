/* Admin: manage the "Nos créations" dishes and the "Souvenir" gallery photos, backed by
 * Supabase (database + file storage + auth). See ../../../supabase/schema.sql for the
 * tables, storage bucket and Row Level Security policies this relies on: reads are public,
 * writes require a signed-in session (enforced server-side by RLS, not by this file).
 *
 * Images are uploaded as real files to the `site-media` storage bucket and referenced by
 * their public URL. Existing site photos that haven't been touched from here yet still show
 * up via their original `assets/images/...` path (that's what the database was seeded with)
 * -- both kinds of path are treated the same way by imgUrl()/thumbFor() below.
 */
(function () {
  'use strict';

  var OUT_WIDTH = 900;      // max width of an exported (cropped) photo, same as the site's photos
  var OUT_QUALITY = 0.82;
  var MAX_FILE_MB = 25;
  var BUCKET = 'site-media';
  var BUCKET_MARKER = '/storage/v1/object/public/' + BUCKET + '/';

  var client = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  var state = { dishes: [], souvenirs: [] };

  /* ------------------------------------------------------------------ data */

  function isAbsolute(url) { return /^https?:\/\//.test(url); }

  // Legacy site photos ("assets/images/dish-foo.webp") have a hand-made "-p-500" thumbnail
  // sitting next to them; a freshly uploaded photo is a single file, so it IS its own thumb.
  function thumbFor(imagePath) {
    if (isAbsolute(imagePath)) return imagePath;
    return imagePath.replace(/(\.[a-z0-9]+)$/i, '-p-500$1');
  }

  function dishFromRow(row) { return { id: row.id, name: row.name, src: row.image_path, thumb: thumbFor(row.image_path) }; }
  function photoFromRow(row) { return { id: row.id, alt: row.alt, src: row.image_path, thumb: thumbFor(row.image_path) }; }

  function loadData() {
    return Promise.all([
      client.from('dishes').select('*').order('position'),
      client.from('gallery_photos').select('*').order('position')
    ]).then(function (results) {
      var dishesRes = results[0], photosRes = results[1];
      if (dishesRes.error) throw dishesRes.error;
      if (photosRes.error) throw photosRes.error;
      state.dishes = dishesRes.data.map(dishFromRow);
      state.souvenirs = photosRes.data.map(photoFromRow);
    });
  }

  // Every row's `position` reset to its current index in state.souvenirs (0 = top photo).
  // Called after any reorder, add or delete so the stored order always matches what's shown.
  function persistPhotoOrder() {
    return Promise.all(state.souvenirs.map(function (p, i) {
      return client.from('gallery_photos').update({ position: i }).eq('id', p.id);
    })).then(function (results) {
      var failed = results.find(function (r) { return r.error; });
      if (failed) throw failed.error;
    });
  }

  function extFromMime(type) {
    var map = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
    return map[type] || 'jpg';
  }

  function uploadImage(folder, blob) {
    var path = folder + '/' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + extFromMime(blob.type);
    return client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type }).then(function (res) {
      if (res.error) throw res.error;
      return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    });
  }

  // Best-effort cleanup of a photo this admin previously uploaded, once it's no longer used
  // anywhere (replaced or deleted). Never touches a legacy /assets/images/ site file (there's
  // no marker to strip, so it's simply skipped), and a failure here is silent: an orphaned
  // file in storage costs a little space, it isn't worth failing the user's action over.
  function deleteIfOwned(url) {
    var idx = url ? url.indexOf(BUCKET_MARKER) : -1;
    if (idx < 0) return;
    client.storage.from(BUCKET).remove([url.slice(idx + BUCKET_MARKER.length)]).catch(function () {});
  }

  /* --------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function indexOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }
  function errorMessage(err) { return (err && err.message) || 'erreur réseau'; }

  function setBusy(btn, busy, label) {
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Patientez…'; btn.disabled = true; }
    else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
  }

  var toastTimer = null;
  function toast(message, isError) {
    var t = $('toast');
    t.textContent = message;
    t.classList.toggle('is-error', !!isError);
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-visible'); }, isError ? 6000 : 3200);
  }

  function confirmDialog(message, yesLabel) {
    return new Promise(function (resolve) {
      var dlg = $('confirm-dialog');
      $('confirm-text').textContent = message;
      $('confirm-yes').textContent = yesLabel || 'Confirmer';
      function done(value) {
        $('confirm-yes').removeEventListener('click', onYes);
        $('confirm-no').removeEventListener('click', onNo);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        resolve(value);
      }
      function onYes() { done(true); }
      function onNo() { done(false); }
      function onClose() { done(false); }
      $('confirm-yes').addEventListener('click', onYes);
      $('confirm-no').addEventListener('click', onNo);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }

  // File -> data URL (for the file picker's immediate on-screen preview, before cropping).
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Aucun fichier choisi.'));
      if (!/^image\//.test(file.type)) return reject(new Error("Ce fichier n'est pas une image (formats acceptés : JPG, PNG, WebP)."));
      if (file.size > MAX_FILE_MB * 1024 * 1024) return reject(new Error('Cette photo est trop lourde (maximum ' + MAX_FILE_MB + ' Mo).'));
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Impossible de lire ce fichier.')); };
      reader.readAsDataURL(file);
    });
  }

  // Opens the OS file picker; resolves with the chosen file's data URL (or null if cancelled).
  function pickPhoto() {
    return new Promise(function (resolve) {
      var input = $('file-input');
      input.value = '';
      function onChange() {
        input.removeEventListener('change', onChange);
        var file = input.files && input.files[0];
        if (!file) return resolve(null);
        readFile(file).then(resolve, function (err) { toast(err.message, true); resolve(null); });
      }
      input.addEventListener('change', onChange);
      input.click();
    });
  }

  /* --------------------------------------------------------------- cropper */

  var cropper = (function () {
    var RATIOS = [
      { key: '3:4', label: 'Portrait 3:4', ratio: 3 / 4 },
      { key: '1:1', label: 'Carré', ratio: 1 },
      { key: '4:3', label: 'Paysage 4:3', ratio: 4 / 3 },
      { key: 'full', label: 'Photo entière', ratio: null }
    ];
    var dlg = $('crop-dialog'), stage = $('crop-stage'), img = $('crop-img'), slider = $('crop-zoom');
    var ratiosBox = $('crop-ratios'), err = $('crop-error');
    var W = 0, H = 0, nw = 0, nh = 0, s0 = 1, zoom = 1, x = 0, y = 0, ratio = 0.75;
    var pointers = {}, pinch = null, onDone = null;

    RATIOS.forEach(function (r) {
      var b = el('button', null, r.label);
      b.type = 'button';
      b.dataset.key = r.key;
      b.addEventListener('click', function () { setRatio(r.key); });
      ratiosBox.appendChild(b);
    });

    function currentRatio(key) {
      for (var i = 0; i < RATIOS.length; i++) if (RATIOS[i].key === key) return RATIOS[i].ratio || nw / nh;
      return 0.75;
    }

    function setRatio(key) {
      ratio = currentRatio(key);
      var buttons = ratiosBox.children;
      for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-pressed', buttons[i].dataset.key === key ? 'true' : 'false');
      layout();
    }

    // Fits the frame in the available room (any phone/desktop), then re-centres the photo.
    function layout() {
      var wrapW = $('crop-wrap').clientWidth || 300;
      var maxH = Math.max(200, window.innerHeight * 0.45);
      W = Math.min(wrapW, maxH * ratio);
      H = W / ratio;
      stage.style.width = W + 'px';
      stage.style.height = H + 'px';
      s0 = Math.max(W / nw, H / nh);          // "cover": the photo always fills the frame
      zoom = 1;
      slider.value = 0;
      x = (W - nw * s0) / 2;
      y = (H - nh * s0) / 2;
      apply();
    }

    function clamp() {
      var sc = s0 * zoom;
      x = Math.min(0, Math.max(W - nw * sc, x));
      y = Math.min(0, Math.max(H - nh * sc, y));
    }

    function apply() {
      clamp();
      var sc = s0 * zoom;
      img.style.width = nw * sc + 'px';
      img.style.height = nh * sc + 'px';
      img.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }

    // Zoom keeping the photo point under (px, py) fixed.
    function zoomAt(z, px, py) {
      z = Math.min(4, Math.max(1, z));
      var oldScale = s0 * zoom;
      var ix = (px - x) / oldScale, iy = (py - y) / oldScale;
      zoom = z;
      var newScale = s0 * zoom;
      x = px - ix * newScale;
      y = py - iy * newScale;
      slider.value = Math.round((zoom - 1) / 3 * 100);
      apply();
    }

    function stagePoint(e) {
      var r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    stage.addEventListener('pointerdown', function (e) {
      stage.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = stagePoint(e);
      stage.classList.add('is-dragging');
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoom };
      }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      var p = stagePoint(e), prev = pointers[e.pointerId];
      var ids = Object.keys(pointers);
      if (ids.length >= 2 && pinch) {
        pointers[e.pointerId] = p;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.dist > 0) zoomAt(pinch.zoom * d / pinch.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      } else {
        x += p.x - prev.x;
        y += p.y - prev.y;
        pointers[e.pointerId] = p;
        apply();
      }
    });
    function endPointer(e) {
      delete pointers[e.pointerId];
      pinch = null;
      if (!Object.keys(pointers).length) stage.classList.remove('is-dragging');
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = stagePoint(e);
      zoomAt(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y);
    }, { passive: false });
    slider.addEventListener('input', function () { zoomAt(1 + slider.value / 100 * 3, W / 2, H / 2); });
    window.addEventListener('resize', function () { if (dlg.open) layout(); });

    function close() { if (dlg.open) dlg.close(); pointers = {}; pinch = null; }
    $('crop-cancel').addEventListener('click', close);

    $('crop-ok').addEventListener('click', function () {
      var sc = s0 * zoom;
      var sx = -x / sc, sy = -y / sc, sw = W / sc, sh = H / sc;
      var outW = Math.max(1, Math.round(Math.min(OUT_WIDTH, sw)));   // never enlarge beyond the source pixels
      var outH = Math.max(1, Math.round(outW * H / W));
      var canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      var cb = onDone;
      close();
      if (!cb) return;
      // toBlob is what actually gets uploaded; canvas.toDataURL alongside it is only for the
      // instant on-screen preview while that upload is still in flight. If a browser can't
      // encode webp, toBlob silently gives back a PNG instead (blob.type says so) rather than
      // erroring -- extFromMime() picks the right file extension from that automatically.
      canvas.toBlob(function (blob) {
        // width/height of the actual exported file, not the on-screen preview size -- this is
        // what the public site later uses to tell a "photo entière" (goes in the one big frame
        // at the top of the gallery) from a 3:4-cropped one (goes in one of the 10 row frames):
        // a plain aspect-ratio check on width/height, no separate "which kind is this" field to
        // keep in sync by hand.
        cb({ dataUrl: canvas.toDataURL('image/png'), blob: blob, width: outW, height: outH });
      }, 'image/webp', OUT_QUALITY);
    });

    // opts: { src, defaultRatio: '3:4'|'1:1'|'4:3'|'full', title, onDone({dataUrl, blob, width, height}) }
    return {
      open: function (opts) {
        onDone = opts.onDone;
        err.hidden = true;
        $('crop-title').textContent = opts.title || 'Recadrer la photo';
        var probe = new Image();
        probe.onload = function () {
          nw = probe.naturalWidth;
          nh = probe.naturalHeight;
          img.src = opts.src;
          dlg.showModal();
          setRatio(opts.defaultRatio || '3:4');
        };
        probe.onerror = function () { toast("Cette image n'a pas pu être ouverte. Essayez une photo JPG, PNG ou WebP.", true); };
        probe.src = opts.src;
      }
    };
  })();

  /* ------------------------------------------------------------ rendering */

  function renderDishes() {
    var list = $('dish-list');
    list.textContent = '';
    state.dishes.forEach(function (dish, i) {
      var li = el('li');
      var row = el('button', 'dish-row');
      row.type = 'button';
      row.setAttribute('aria-label', 'Modifier ' + dish.name);
      var thumb = el('div', 'dish-thumb');
      var im = el('img');
      im.src = dish.thumb || dish.src;
      im.alt = '';
      thumb.appendChild(im);
      var info = el('div', 'dish-info');
      info.appendChild(el('span', 'dish-num', 'Plat ' + (i + 1)));
      info.appendChild(el('span', 'dish-name', dish.name));
      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(el('span', 'dish-edit', 'Modifier ›'));
      row.addEventListener('click', function () { openEdit('dish', dish.id); });
      li.appendChild(row);
      list.appendChild(li);
    });
    $('count-creations').textContent = '(' + state.dishes.length + ')';
  }

  function renderPhotos() {
    var grid = $('photo-grid');
    grid.textContent = '';
    state.souvenirs.forEach(function (photo, i) {
      var li = el('li', 'photo-card');
      li.dataset.id = photo.id;
      var thumb = el('div', 'photo-thumb');
      var im = el('img');
      im.src = photo.thumb || photo.src;
      im.alt = photo.alt || '';
      im.loading = 'lazy';
      im.draggable = false;
      thumb.appendChild(im);
      thumb.appendChild(el('span', 'photo-num', String(i + 1)));
      var first = el('span', 'photo-first', 'Photo du haut');
      first.hidden = i !== 0;
      thumb.appendChild(first);
      var prev = el('button', 'photo-move prev', '‹');
      prev.type = 'button';
      prev.disabled = i === 0;
      prev.setAttribute('aria-label', 'Avancer la photo ' + (i + 1) + ' (position ' + i + ')');
      prev.addEventListener('click', function () { movePhotoBy(photo.id, -1, 'prev'); });
      var next = el('button', 'photo-move next', '›');
      next.type = 'button';
      next.disabled = i === state.souvenirs.length - 1;
      next.setAttribute('aria-label', 'Reculer la photo ' + (i + 1) + ' (position ' + (i + 2) + ')');
      next.addEventListener('click', function () { movePhotoBy(photo.id, 1, 'next'); });
      thumb.appendChild(prev);
      thumb.appendChild(next);
      var actions = el('div', 'photo-actions');
      var edit = el('button', 'btn btn-small', 'Modifier');
      edit.type = 'button';
      edit.setAttribute('aria-label', 'Modifier la photo ' + (i + 1));
      edit.addEventListener('click', function () { openEdit('photo', photo.id); });
      var del = el('button', 'btn btn-small btn-danger', 'Supprimer');
      del.type = 'button';
      del.setAttribute('aria-label', 'Supprimer la photo ' + (i + 1));
      del.addEventListener('click', function () { removePhoto(photo.id); });
      actions.appendChild(edit);
      actions.appendChild(del);
      li.appendChild(thumb);
      li.appendChild(actions);
      grid.appendChild(li);
    });
    var addLi = el('li');
    var add = el('button', 'add-tile');
    add.type = 'button';
    add.appendChild(el('span', null, '+'));
    add.lastChild.setAttribute('aria-hidden', 'true');
    add.appendChild(el('span', null, 'Ajouter une photo'));
    add.addEventListener('click', addPhoto);
    addLi.appendChild(add);
    grid.appendChild(addLi);
    $('count-souvenir').textContent = '(' + state.souvenirs.length + ')';
  }

  function renderAll() { renderDishes(); renderPhotos(); }

  /* --------------------------------------------------------------- actions */

  /* ---- reordering: arrows, position select, press-and-drag ---- */

  // Moves one photo to a new index (0-based) and keeps the rest in order.
  function moveItem(from, to) {
    if (from === to || from < 0 || to < 0 || to >= state.souvenirs.length) return false;
    var item = state.souvenirs.splice(from, 1)[0];
    state.souvenirs.splice(to, 0, item);
    return true;
  }

  function movePhotoBy(id, delta, focusClass) {
    var from = indexOf(state.souvenirs, id);
    if (!moveItem(from, from + delta)) return;
    renderPhotos();
    var again = document.querySelector('.photo-card[data-id="' + id + '"] .photo-move.' + focusClass);
    if (again && !again.disabled) again.focus();
    persistPhotoOrder().then(function () {
      toast('Photo déplacée en position ' + (from + delta + 1) + '.');
    }).catch(function (err) {
      toast("Le nouvel ordre n'a pas pu être enregistré : " + errorMessage(err), true);
      loadData().then(renderPhotos);
    });
  }

  var dragState = null;
  var HOLD_MS = 320;       // touch: how long to keep a finger on a photo before it lifts
  var MOVE_PX = 6;         // mouse: how far to move before it counts as a drag
  var grid = $('photo-grid');

  function photoCards() { return Array.prototype.slice.call(grid.querySelectorAll('.photo-card')); }

  // Live renumbering while dragging (the real order is only saved on drop).
  function renumber() {
    photoCards().forEach(function (card, i) {
      card.querySelector('.photo-num').textContent = String(i + 1);
      card.querySelector('.photo-first').hidden = i !== 0;
    });
  }

  function startDrag() {
    var d = dragState;
    if (!d || d.active) return;
    d.active = true;
    clearTimeout(d.timer);
    d.card.classList.add('is-dragging');
    document.body.classList.add('is-sorting');
    var thumb = d.card.querySelector('.photo-thumb');
    var rect = thumb.getBoundingClientRect();
    d.ghost = thumb.cloneNode(true);
    d.ghost.classList.add('drag-ghost');
    d.ghost.style.width = rect.width + 'px';
    d.ghost.style.height = rect.height + 'px';
    document.body.appendChild(d.ghost);
    d.gw = rect.width;
    d.gh = rect.height;
    placeGhost();
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    d.raf = requestAnimationFrame(autoScroll);
  }

  function placeGhost() {
    var d = dragState;
    d.ghost.style.transform = 'translate(' + (d.x - d.gw / 2) + 'px,' + (d.y - d.gh / 2) + 'px) rotate(3deg)';
  }

  // Slides the dragged card into the slot under the pointer (other cards shift around it).
  function reorderLive() {
    var d = dragState;
    var under = document.elementFromPoint(d.x, d.y);
    var target = under && under.closest ? under.closest('.photo-card') : null;
    if (!target || target === d.card) return;
    var cards = photoCards();
    if (cards.indexOf(d.card) < cards.indexOf(target)) target.after(d.card);
    else target.before(d.card);
    renumber();
  }

  // Scrolls the page while dragging near the top/bottom edge (long galleries, small phones).
  function autoScroll() {
    var d = dragState;
    if (!d || !d.active) return;
    var edge = 80, speed = 0;
    if (d.y < edge) speed = -Math.ceil((edge - d.y) / 6);
    else if (d.y > window.innerHeight - edge) speed = Math.ceil((d.y - (window.innerHeight - edge)) / 6);
    if (speed) { window.scrollBy(0, speed); reorderLive(); }
    d.raf = requestAnimationFrame(autoScroll);
  }

  function endDrag(commit) {
    var d = dragState;
    if (!d) return;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    dragState = null;
    if (!d.active) return;
    if (d.ghost) d.ghost.remove();
    d.card.classList.remove('is-dragging');
    document.body.classList.remove('is-sorting');
    var before = state.souvenirs.map(function (p) { return p.id; });
    if (commit) {
      var byId = {};
      state.souvenirs.forEach(function (p) { byId[p.id] = p; });
      var after = photoCards().map(function (c) { return c.dataset.id; });
      state.souvenirs = after.map(function (id) { return byId[id]; });
      var from = before.indexOf(d.id), to = after.indexOf(d.id);
      if (from !== to) {
        persistPhotoOrder().then(function () {
          toast('Photo déplacée de la position ' + (from + 1) + ' à la position ' + (to + 1) + '.');
        }).catch(function (err) {
          toast("Le nouvel ordre n'a pas pu être enregistré : " + errorMessage(err), true);
          loadData().then(renderPhotos);
        });
      }
    }
    renderPhotos();
  }

  grid.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button')) return;
    var thumb = e.target.closest('.photo-thumb');
    var card = thumb && thumb.closest('.photo-card');
    if (!card || dragState) return;
    dragState = {
      id: card.dataset.id, card: card, pointerId: e.pointerId, active: false,
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      touch: e.pointerType === 'touch' || e.pointerType === 'pen', timer: null
    };
    if (dragState.touch) dragState.timer = setTimeout(startDrag, HOLD_MS);
  });

  document.addEventListener('pointermove', function (e) {
    var d = dragState;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.active) {
      var dist = Math.hypot(d.x - d.sx, d.y - d.sy);
      if (d.touch) { if (dist > 10) { clearTimeout(d.timer); dragState = null; } }   // finger moved first: it is a scroll
      else if (dist > MOVE_PX) startDrag();
      return;
    }
    placeGhost();
    reorderLive();
  });

  document.addEventListener('pointerup', function (e) { if (dragState && e.pointerId === dragState.pointerId) endDrag(true); });
  document.addEventListener('pointercancel', function (e) { if (dragState && e.pointerId === dragState.pointerId) endDrag(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dragState && dragState.active) endDrag(false); });
  // Once a touch drag has started, the page must not scroll under the finger.
  grid.addEventListener('touchmove', function (e) { if (dragState && dragState.active) e.preventDefault(); }, { passive: false });
  grid.addEventListener('contextmenu', function (e) { if (e.target.closest('.photo-thumb')) e.preventDefault(); });

  function addPhoto() {
    pickPhoto().then(function (dataUrl) {
      if (!dataUrl) return;
      cropper.open({
        src: dataUrl,
        defaultRatio: '3:4',
        title: 'Ajouter une photo',
        onDone: function (result) {
          toast('Ajout de la photo en cours…');
          uploadImage('gallery', result.blob).then(function (url) {
            return client.from('gallery_photos')
              .insert({ alt: 'Photo du restaurant La Re-Naissance', image_path: url, position: state.souvenirs.length, width: result.width, height: result.height })
              .select().single();
          }).then(function (res) {
            if (res.error) throw res.error;
            state.souvenirs.push(photoFromRow(res.data));
            renderPhotos();
            toast('Photo ajoutée à la fin de la galerie.');
          }).catch(function (err) {
            toast("Impossible d'ajouter la photo : " + errorMessage(err), true);
          });
        }
      });
    });
  }

  function removePhoto(id) {
    var idx = indexOf(state.souvenirs, id);
    if (idx < 0) return;
    confirmDialog('Supprimer la photo n°' + (idx + 1) + ' de la galerie ?', 'Supprimer').then(function (ok) {
      if (!ok) return;
      var item = state.souvenirs[idx];
      client.from('gallery_photos').delete().eq('id', id).then(function (res) {
        if (res.error) throw res.error;
        state.souvenirs.splice(idx, 1);
        renderPhotos();
        toast('Photo supprimée.');
        persistPhotoOrder().catch(function () {});   // renumber the rest; non-critical if it fails
        deleteIfOwned(item.src);
      }).catch(function (err) {
        toast('Impossible de supprimer : ' + errorMessage(err), true);
      });
    });
  }

  /* ---- edit dialog (dish or souvenir photo) ---- */
  var edit = null; // { kind, id, src, name, idx, blob }

  function openEdit(kind, id) {
    var list = kind === 'dish' ? state.dishes : state.souvenirs;
    var idx = indexOf(list, id);
    if (idx < 0) return;
    var item = list[idx];
    edit = { kind: kind, id: id, src: item.src, name: item.name || '', idx: idx, blob: null, width: null, height: null };
    $('edit-title').textContent = kind === 'dish' ? 'Modifier le plat ' + (idx + 1) : 'Modifier la photo ' + (idx + 1);
    $('name-field').hidden = kind !== 'dish';
    $('edit-name').value = edit.name;
    $('btn-delete').hidden = kind === 'dish';   // the carousel always keeps its 6 dishes
    $('pos-field').hidden = kind !== 'photo';
    if (kind === 'photo') {
      var sel = $('edit-pos');
      sel.textContent = '';
      for (var n = 1; n <= state.souvenirs.length; n++) {
        var opt = el('option', null, n === 1 ? '1 — photo du haut' : String(n));
        opt.value = String(n - 1);
        sel.appendChild(opt);
      }
      sel.value = String(idx);
    }
    $('edit-error').hidden = true;
    var preview = $('edit-photo');
    preview.src = item.thumb || item.src;
    preview.alt = item.name || item.alt || '';
    $('edit-dialog').showModal();
  }

  function editRatio() { return edit && edit.kind === 'photo' && edit.idx === 0 ? 'full' : '3:4'; }

  $('btn-crop').addEventListener('click', function () {
    cropper.open({
      src: edit.src,
      defaultRatio: editRatio(),
      onDone: function (result) { edit.src = result.dataUrl; edit.blob = result.blob; edit.width = result.width; edit.height = result.height; $('edit-photo').src = result.dataUrl; }
    });
  });

  $('btn-replace').addEventListener('click', function () {
    pickPhoto().then(function (dataUrl) {
      if (!dataUrl) return;
      cropper.open({
        src: dataUrl,
        defaultRatio: editRatio(),
        title: 'Changer la photo',
        onDone: function (result) { edit.src = result.dataUrl; edit.blob = result.blob; edit.width = result.width; edit.height = result.height; $('edit-photo').src = result.dataUrl; }
      });
    });
  });

  $('btn-cancel').addEventListener('click', function () { $('edit-dialog').close(); });

  $('btn-save').addEventListener('click', saveEdit);
  $('edit-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } });

  function saveEdit() {
    var list = edit.kind === 'dish' ? state.dishes : state.souvenirs;
    var item = list[indexOf(list, edit.id)];
    if (!item) return;
    var name = item.name;
    if (edit.kind === 'dish') {
      name = $('edit-name').value.replace(/\s+/g, ' ').trim();
      if (!name) {
        $('edit-error').textContent = 'Le nom du plat ne peut pas être vide.';
        $('edit-error').hidden = false;
        $('edit-name').focus();
        return;
      }
    }
    var table = edit.kind === 'dish' ? 'dishes' : 'gallery_photos';
    var previousSrc = item.src;
    var uploadedUrl = null;
    var saveBtn = $('btn-save');
    setBusy(saveBtn, true, 'Enregistrement…');

    (edit.blob ? uploadImage(edit.kind === 'dish' ? 'dishes' : 'gallery', edit.blob) : Promise.resolve(null))
      .then(function (url) {
        uploadedUrl = url;
        var patch = {};
        if (edit.kind === 'dish' && name !== item.name) patch.name = name;
        if (uploadedUrl) {
          patch.image_path = uploadedUrl;
          // Dimensions of the newly exported file -- only meaningful for gallery photos (this is
          // what tells the public site "photo entière" (top frame) from "recadrée en 3:4" (one of
          // the 10 row frames); dishes have no such distinction, and their table has no matching columns.
          if (edit.kind === 'photo') { patch.width = edit.width; patch.height = edit.height; }
        }
        if (!Object.keys(patch).length) return null;
        if (edit.kind === 'dish') patch.updated_at = new Date().toISOString();
        return client.from(table).update(patch).eq('id', edit.id).then(function (res) {
          if (res.error) throw res.error;
        });
      })
      .then(function () {
        if (edit.kind === 'dish') item.name = name;
        if (uploadedUrl) { item.src = uploadedUrl; item.thumb = uploadedUrl; }
        if (edit.kind !== 'photo') return null;
        var newIdx = parseInt($('edit-pos').value, 10);
        return moveItem(indexOf(state.souvenirs, edit.id), newIdx) ? persistPhotoOrder() : null;
      })
      .then(function () {
        if (uploadedUrl && previousSrc !== uploadedUrl) deleteIfOwned(previousSrc);
        setBusy(saveBtn, false);
        toast('Modification enregistrée.');
        renderAll();
        $('edit-dialog').close();
      })
      .catch(function (err) {
        setBusy(saveBtn, false);
        toast("Impossible d'enregistrer : " + errorMessage(err), true);
      });
  }

  $('btn-delete').addEventListener('click', function () {
    var id = edit.id;
    $('edit-dialog').close();
    removePhoto(id);
  });

  /* ------------------------------------------------------------ tabs, etc. */

  var TABS = ['creations', 'souvenir'];
  function selectTab(name, focus) {
    TABS.forEach(function (t) {
      var on = t === name;
      var tab = $('tab-' + t);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
      if (on && focus) tab.focus();
    });
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
  }
  TABS.forEach(function (t, i) {
    $('tab-' + t).addEventListener('click', function () { selectTab(t); });
    $('tab-' + t).addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        selectTab(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length], true);
      }
    });
  });

  $('add-photo-top').addEventListener('click', addPhoto);

  $('logout').addEventListener('click', function () {
    client.auth.signOut().then(function () { location.href = 'connexion.html'; });
  });

  /* -------------------------------------------------------------- startup */

  // Gate on a real signed-in session (Supabase Auth) before loading or showing anything.
  // Everything above only defines functions and wires listeners -- safe to run either way --
  // it's this promise chain that actually fetches data and renders the page.
  client.auth.getSession().then(function (res) {
    if (!res.data.session) { location.replace('connexion.html'); return; }
    return loadData().then(function () {
      renderAll();
      var initial = (location.hash || '').replace('#', '');
      selectTab(TABS.indexOf(initial) >= 0 ? initial : 'creations');
    });
  }).catch(function (err) {
    toast('Connexion à Supabase impossible : ' + errorMessage(err), true);
  });

  // Signed out from another tab, or the session expired: bounce back to the login page.
  client.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT') location.replace('connexion.html');
  });
})();
