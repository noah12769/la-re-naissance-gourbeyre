/* Admin preview: manage the "Nos créations" dishes and the "Souvenir" gallery photos.
 *
 * PREVIEW ONLY: nothing here reaches the public site yet. Changes are kept in this browser's
 * localStorage so the interface can be tried out. The next step replaces `load()` / `persist()`
 * with Supabase (database + file storage) and the placeholder login with Supabase Auth.
 *
 * Images are only ever handled as data URLs (never blob: URLs) because the site's CSP
 * (vercel.json) allows `img-src 'self' data:`.
 */
(function () {
  'use strict';

  var AUTH_KEY = 'lrn-admin-session';
  var STORE_KEY = 'lrn-admin-preview-v1';
  var IMG = 'assets/images/';
  var OUT_WIDTH = 900;      // max width of an exported (cropped) photo, same as the site's photos
  var OUT_QUALITY = 0.82;
  var MAX_FILE_MB = 25;

  // Same guard as the login page (placeholder, see connexion.html).
  try { if (sessionStorage.getItem(AUTH_KEY) !== '1') { location.replace('connexion.html'); return; } }
  catch (e) { location.replace('connexion.html'); return; }

  /* ------------------------------------------------------------------ data */

  // Mirrors what index.html shows today (same order). Will come from the database later.
  function defaults() {
    function dish(slug, name) {
      return { id: 'dish-' + slug, name: name, src: IMG + 'dish-' + slug + '.webp', thumb: IMG + 'dish-' + slug + '-p-500.webp' };
    }
    function photo(slug, alt) {
      return { id: 'photo-' + slug, alt: alt, src: IMG + 'gallery-' + slug + '.webp', thumb: IMG + 'gallery-' + slug + '-p-500.webp' };
    }
    return {
      dishes: [
        dish('steak-de-lambi', 'Steak de lambi'),
        dish('montgolfiere-mer', 'Montgolfière de la mer'),
        dish('millefeuille-redfish', 'Mille-feuille de redfish'),
        dish('dessert-blancmanger', 'Dessert blanc-manger coco passion'),
        dish('croquettes-porc', 'Croquettes de porc'),
        dish('cote-de-boeuf', 'Côte de bœuf')
      ],
      souvenirs: [
        photo('groupe-equipe', 'Photo de groupe au restaurant La Re-Naissance'),
        photo('severine-olivier', 'Séverine et Olivier devant La Re-Naissance'),
        photo('salle-bar', 'Le bar du restaurant'),
        photo('equipe-entree', "L'équipe de La Re-Naissance devant le restaurant"),
        photo('salle-exterieure-1', 'Façade extérieure du restaurant'),
        photo('evenement-plage', 'Soirée événement La Re-Naissance à la plage'),
        photo('salle-lounge', "Salon d'accueil du restaurant"),
        photo('clients-selfie', 'Clients de La Re-Naissance'),
        photo('salle-interieure-2', 'Salle du restaurant, ambiance lumineuse'),
        photo('evenement-costume', 'Événement La Re-Naissance en tenue traditionnelle'),
        photo('salle-interieure-3', 'Autre vue de la salle du restaurant')
      ]
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.dishes) && Array.isArray(s.souvenirs)) return s;
      }
    } catch (e) { /* storage blocked or corrupted: start from the defaults */ }
    return defaults();
  }

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; }
    catch (e) {
      toast("Le navigateur n'a plus de place pour garder ces modifications (trop de photos ajoutées).", true);
      return false;
    }
  }

  /* --------------------------------------------------------------- helpers */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function newId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

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

  // File -> data URL. Rejects non-images and very large files with a readable message.
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
      var url = canvas.toDataURL('image/webp', OUT_QUALITY);
      if (url.indexOf('data:image/webp') !== 0) url = canvas.toDataURL('image/jpeg', OUT_QUALITY); // Safari: no webp export
      var cb = onDone;
      close();
      if (cb) cb(url);
    });

    // opts: { src, defaultRatio: '3:4'|'1:1'|'4:3'|'full', title, onDone(dataUrl) }
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
      var name = el('span', 'dish-name', dish.name);
      if (dish.changed) name.appendChild(el('span', 'badge', 'Modifié'));
      info.appendChild(name);
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
    if (persist()) toast('Photo déplacée en position ' + (from + delta + 1) + '.');
    renderPhotos();
    var again = document.querySelector('.photo-card[data-id="' + id + '"] .photo-move.' + focusClass);
    if (again && !again.disabled) again.focus();
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
      if (from !== to && persist()) toast('Photo déplacée de la position ' + (from + 1) + ' à la position ' + (to + 1) + '.');
    }
    renderPhotos();   // also restores the saved order if the drag was cancelled
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
        onDone: function (url) {
          state.souvenirs.push({ id: newId('photo'), alt: 'Photo du restaurant La Re-Naissance', src: url, thumb: url, changed: true });
          if (persist()) toast('Photo ajoutée à la fin de la galerie.');
          renderPhotos();
        }
      });
    });
  }

  function removePhoto(id) {
    var idx = indexOf(state.souvenirs, id);
    if (idx < 0) return;
    confirmDialog('Supprimer la photo n°' + (idx + 1) + ' de la galerie ?', 'Supprimer').then(function (ok) {
      if (!ok) return;
      state.souvenirs.splice(idx, 1);
      if (persist()) toast('Photo supprimée.');
      renderPhotos();
    });
  }

  function indexOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  /* ---- edit dialog (dish or souvenir photo) ---- */
  var edit = null; // { kind, id, src, name }

  function openEdit(kind, id) {
    var list = kind === 'dish' ? state.dishes : state.souvenirs;
    var idx = indexOf(list, id);
    if (idx < 0) return;
    var item = list[idx];
    edit = { kind: kind, id: id, src: item.src, name: item.name || '', idx: idx };
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
      onDone: function (url) { edit.src = url; $('edit-photo').src = url; }
    });
  });

  $('btn-replace').addEventListener('click', function () {
    pickPhoto().then(function (dataUrl) {
      if (!dataUrl) return;
      cropper.open({
        src: dataUrl,
        defaultRatio: editRatio(),
        title: 'Changer la photo',
        onDone: function (url) { edit.src = url; $('edit-photo').src = url; }
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
    if (edit.kind === 'dish') {
      var name = $('edit-name').value.replace(/\s+/g, ' ').trim();
      if (!name) {
        $('edit-error').textContent = 'Le nom du plat ne peut pas être vide.';
        $('edit-error').hidden = false;
        $('edit-name').focus();
        return;
      }
      if (name !== item.name) { item.name = name; item.changed = true; }
    }
    if (edit.src !== item.src) { item.src = edit.src; item.thumb = edit.src; item.changed = true; }
    var moved = false;
    if (edit.kind === 'photo') moved = moveItem(indexOf(state.souvenirs, edit.id), parseInt($('edit-pos').value, 10));
    if (persist()) toast(moved ? 'Modification enregistrée, photo déplacée.' : 'Modification enregistrée.');
    renderAll();
    $('edit-dialog').close();
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
    try { sessionStorage.removeItem(AUTH_KEY); } catch (e) {}
    location.href = 'connexion.html';
  });

  $('reset').addEventListener('click', function () {
    confirmDialog("Remettre tous les noms et toutes les photos comme sur le site actuel ? Vos modifications de cet aperçu seront perdues.", 'Remettre').then(function (ok) {
      if (!ok) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      state = defaults();
      renderAll();
      toast("Photos et noms d'origine remis.");
    });
  });

  renderAll();
  var initial = (location.hash || '').replace('#', '');
  selectTab(TABS.indexOf(initial) >= 0 ? initial : 'creations');
})();
