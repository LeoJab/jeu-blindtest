/* Blind Test — ChadGangGames
   Multijoueur en ligne via les salles du hub (SDK ChadGang), extraits audio Deezer (JSONP, sans serveur).
   Modèle : l'hôte (1er de la salle) fait foi et publie un état complet versionné (keep) ;
   chaque joueur vérifie sa réponse localement et prévient l'hôte, qui calcule les points. */
(() => {
  'use strict';

  /* ───────── Réglages ───────── */
  const T = Object.assign({ reveal: 7000, prepMin: 3000, prepMax: 9000, endGrace: 1300, roundTail: 1500 }, window.BT_TIMING || {});
  const N_CHOICES = [5, 10, 15, 20];
  const D_CHOICES = [15, 20, 30];
  const RING_LEN = 590.6;
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

  /* ───────── Petits outils ───────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sec = ms => (ms / 1000).toFixed(1) + ' s';
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* ignoré */ } return null; }
  function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }

  /* ───────── Réponses : normalisation et tolérance aux fautes ───────── */
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\bet\b/g, 'and');
  }
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const ARTICLES = /^(the|le|la|les|l|un|une|a|an) /;
  function stripTitle(raw) {
    return String(raw || '').replace(/\s+[-–—]\s+.*$/, '')
      .replace(/\s*[\(\[]\s*(feat|ft|avec|with)\b[^\)\]]*[\)\]]/ig, '')
      .replace(/\s+(feat|ft)\.?\s+.*$/i, '').trim();
  }
  function coreTitle(s) { return norm(stripTitle(s).replace(/[\(\[][^\)\]]*[\)\]]/g, ' ')); }
  function addVariant(set, s) {
    const n = norm(s); if (!n) return;
    set.add(n);
    const m = n.replace(ARTICLES, ''); if (m.length >= 2) set.add(m);
  }
  function titleVariants(raw, extra) {
    const set = new Set(), s = stripTitle(raw);
    addVariant(set, s);
    const bare = s.replace(/[\(\[][^\)\]]*[\)\]]/g, ' ');
    addVariant(set, bare);
    const head = bare.split(/\s*[,:]\s+/)[0];            // « Besoin de rien, envie de toi » → « Besoin de rien »
    if (norm(head).length >= 5) addVariant(set, head);
    (extra || []).forEach(x => addVariant(set, x));
    return [...set];
  }
  function artistVariants(raw) {
    const set = new Set(), full = String(raw || '');
    addVariant(set, stripTitle(full));
    full.split(/\s*(?:,|&|\bet\b|\band\b|\bfeat\.?\b|\bft\.?\b|\/|;)\s*/i).forEach(p => { if (norm(p).length >= 4) addVariant(set, p); });
    return [...set];
  }
  const tol = n => (n <= 4 ? 0 : n <= 7 ? 1 : n <= 12 ? 2 : 3);
  function matchOne(g, v) {
    if (g === v) return true;
    const gs = g.replace(/ /g, ''), vs = v.replace(/ /g, '');
    if (gs === vs) return true;
    if (vs.length < 5) return false;
    return lev(gs, vs) <= tol(vs.length);
  }
  const matchAny = (g, vars) => vars.some(v => matchOne(g, v));
  const hasPhrase = (g, v) => v.length >= 4 && (' ' + g + ' ').includes(' ' + v + ' ');
  const removePhrase = (g, v) => (' ' + g + ' ').replace(' ' + v + ' ', ' ').replace(/\s+/g, ' ').trim();
  const mcache = new Map();
  function matchers(tr) {
    const key = tr.i + '|' + tr.t;
    let m = mcache.get(key);
    if (!m) { m = { tv: titleVariants(tr.t, tr.al), av: tr.a ? artistVariants(tr.a) : [] }; mcache.set(key, m); }
    return m;
  }
  /** Renvoie { t, a } : le texte tapé correspond-il au titre / à l'artiste ? */
  function judge(text, tr) {
    const g = norm(text), m = matchers(tr);
    if (!g) return { t: false, a: false };
    let t = matchAny(g, m.tv), a = tr.a ? matchAny(g, m.av) : false;
    if (!t && !a) {
      if (tr.a) {
        for (const v of m.av) if (hasPhrase(g, v)) { a = true; const rest = removePhrase(g, v); if (rest && matchAny(rest, m.tv)) t = true; break; }
      }
      if (!t) {
        for (const v of m.tv) if (hasPhrase(g, v)) { t = true; if (tr.a) { const rest = removePhrase(g, v); if (rest && matchAny(rest, m.av)) a = true; } break; }
      }
    }
    return { t, a };
  }
  /** Indice : masque les lettres selon le niveau (0 = tout caché, 1 = initiales, 2 = + 30 % des lettres). */
  function maskText(s, lvl) {
    const chars = [...String(s)], isL = c => /[\p{L}\p{N}]/u.test(c);
    const idxs = []; chars.forEach((c, i) => { if (isL(c)) idxs.push(i); });
    const reveal = new Set();
    if (lvl >= 1) idxs.forEach(i => { if (i === 0 || !isL(chars[i - 1])) reveal.add(i); });
    if (lvl >= 2) {
      const k = s.length * 31;
      const rest = idxs.filter(i => !reveal.has(i)).sort((a, b) => ((a * 7919 + k) % 97) - ((b * 7919 + k) % 97));
      rest.slice(0, Math.floor(rest.length * 0.3)).forEach(i => reveal.add(i));
    }
    const set = new Set(idxs);
    return chars.map((c, i) => (set.has(i) ? (reveal.has(i) ? c : '_') : (c === ' ' ? ' ' : c))).join('');
  }

  /* ───────── Catalogue ───────── */
  function parseItem(g, line) {
    const p = String(line).split('|').map(s => s.trim());
    const al = s => (s || '').split(';').map(x => x.trim()).filter(Boolean);
    if (g.dessins) return p[0] && p[1] && p[2] ? { k: 'd', r: p[0], q: p[1], w: p[2], al: al(p[3]) } : null;
    return p[0] && p[1] ? { k: 's', t: p[0], a: p[1], al: al(p[2]) } : null;
  }
  const GROUPS = (window.BT_CATALOGUE || []).map(g => ({ id: g.id, nom: g.nom, emoji: g.emoji, dessins: !!g.dessins, items: g.items.map(l => parseItem(g, l)).filter(Boolean) }));
  const ALL_CATS = [{ id: 'mix', nom: 'Le grand mélange', emoji: '🎲' }].concat(GROUPS.map(g => ({ id: g.id, nom: g.nom, emoji: g.emoji })));
  function buildPool(cat) {
    const groups = cat === 'mix' ? GROUPS : GROUPS.filter(g => g.id === cat);
    const seen = new Set(), out = [];
    groups.forEach(g => g.items.forEach(e => { const k = e.k === 'd' ? 'd' + e.r : e.t + '|' + e.a; if (!seen.has(k)) { seen.add(k); out.push(e); } }));
    return shuffle(out);
  }

  /* ───────── Deezer (JSONP : fonctionne depuis une page statique) ───────── */
  let jid = 0;
  function jsonp(url, timeout = 9000) {
    return new Promise((resolve, reject) => {
      const cb = '__dz' + (++jid) + '_' + Date.now().toString(36);
      const s = document.createElement('script');
      const clean = () => { delete window[cb]; s.remove(); clearTimeout(to); };
      const to = setTimeout(() => { clean(); reject(new Error('timeout')); }, timeout);
      window[cb] = d => { clean(); resolve(d); };
      s.onerror = () => { clean(); reject(new Error('réseau')); };
      s.src = url + (url.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
      document.head.appendChild(s);
    });
  }
  async function dz(path, params) {
    const qs = Object.entries(params || {}).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const url = 'https://api.deezer.com/' + path + (qs ? '?' + qs : '');
    for (let i = 0; i < 3; i++) {
      const d = await jsonp(url);
      if (d && d.error) { if (d.error.code === 4) { await sleep(1500); continue; } throw new Error(d.error.message || 'deezer'); }
      return d;
    }
    throw new Error('quota');
  }
  /* Sources audio : Deezer (principale) et iTunes (secours si Deezer est injoignable).
     Les deux renvoient la même forme : { id, title, artist, album, rank, preview, cover }. */
  const PROV = {
    d: {
      gap: 450,
      async search(q) {
        const d = await dz('search', { q, limit: 12 });
        return (d.data || []).map(x => ({
          id: x.id, title: x.title, artist: (x.artist && x.artist.name) || '', album: (x.album && x.album.title) || '', rank: x.rank || 0,
          preview: x.preview, cover: (x.album && (x.album.md5_image || x.album.cover_medium || x.album.cover)) || '',
        }));
      },
    },
    i: {
      gap: 1700,   // iTunes limite à ~20 requêtes par minute
      async search(q) {
        const d = await jsonp('https://itunes.apple.com/search?media=music&entity=song&country=FR&limit=15&term=' + encodeURIComponent(q), 12000);
        return (d.results || []).map(x => ({
          id: x.trackId, title: x.trackName, artist: x.artistName || '', album: x.collectionName || '', rank: 0,
          preview: x.previewUrl, cover: (x.artworkUrl100 || '').replace('100x100', '500x500'),
        }));
      },
    },
  };
  const tkey = tr => (tr.p || 'd') + tr.i;
  const previews = new Map();
  /** Lien d'extrait tout frais (Deezer le fait expirer : on ne le stocke jamais dans l'état de la partie). */
  function getPreview(tr, fresh) {
    if (tr.p === 'i') return Promise.resolve(tr.u);
    const k = tkey(tr), c = previews.get(k);
    if (c && !fresh && Date.now() - c.at < 4 * 60e3) return c.p;
    const p = dz('track/' + tr.i).then(d => { if (!d.preview) throw new Error('sans extrait'); return d.preview; });
    previews.set(k, { at: Date.now(), p });
    p.catch(() => previews.delete(k));
    return p;
  }
  const HARD_BAD = /\b(karaoke|instrumental|tribute|cover|made famous|originally performed|lullaby|workout|8 bit|nightcore|sped up|slowed)\b/;
  const SOFT_BAD = /\b(live|remix|acoustic|version|demo|reprise|mix)\b/;
  function artistMatches(entryArtist, resArtist) {
    const na = norm(entryArtist), ra = norm(resArtist);
    if (!na) return true;
    if (ra.includes(na) || na.includes(ra)) return true;
    if (lev(ra.replace(/ /g, ''), na.replace(/ /g, '')) <= 1) return true;
    return na.split(' ').some(t => t.length >= 4 && ra.includes(t));
  }
  function scoreResult(e, x) {
    const alb = norm(x.album), title = norm(x.title), full = title + ' ' + alb;
    const rank = Math.min(5, (x.rank || 0) / 200000);
    if (e.k === 'd') {
      const hay = full + ' ' + norm(x.artist);
      if (!hay.includes(norm(e.w))) return 0;
      return 10 + rank - (HARD_BAD.test(title) ? 8 : 0);
    }
    const nt = coreTitle(e.t), rt = coreTitle(x.title);
    const exact = rt === nt;
    if (!(exact || (nt.length >= 4 && rt.includes(nt)) || (rt.length >= 4 && nt.includes(rt)))) return 0;
    if (!artistMatches(e.a, x.artist)) return 0;
    const own = norm(e.t);
    if (HARD_BAD.test(full) && !HARD_BAD.test(own)) return 0;
    let s = exact ? 20 : 10;
    if (SOFT_BAD.test(full) && !SOFT_BAD.test(own)) s -= 6;
    return s + rank;
  }
  async function resolveEntry(e, prov) {
    const q = e.k === 'd' ? e.q : e.t + ' ' + e.a;
    const list = await PROV[prov].search(q);
    let best = null, bs = 0;
    list.forEach(x => { if (!x || !x.preview) return; const s = scoreResult(e, x); if (s > bs) { bs = s; best = x; } });
    if (!best) return null;
    const c = best.cover || '';
    const tr = e.k === 'd'
      ? { i: best.id, t: e.r, a: '', c, x: best.title + ' — ' + best.artist }
      : { i: best.id, t: e.t, a: e.a, c };
    if (prov === 'i') { tr.p = 'i'; tr.u = best.preview; }
    if (e.al && e.al.length) tr.al = e.al;
    return tr;
  }
  /** Trouve les morceaux de la partie. Deezer d'abord ; si Deezer est injoignable ou ne renvoie rien, bascule sur iTunes. */
  async function resolveTracks(cfg) {
    const pool = buildPool(cfg.cat), out = [], used = new Set(), t0 = Date.now();
    let prov = 'd', idx = 0, net = 0, tried = 0, switched = false;
    while (out.length < cfg.n && idx < pool.length && Date.now() - t0 < 70000) {
      const batch = pool.slice(idx, idx + (prov === 'd' ? Math.min(4, cfg.n - out.length + 1) : 1)); idx += batch.length;
      const res = await Promise.all(batch.map(e => resolveEntry(e, prov).then(r => ({ r }), err => ({ err }))));
      res.forEach(o => {
        tried++;
        if (o.err) net++;
        else if (o.r && !used.has(tkey(o.r)) && out.length < cfg.n) { used.add(tkey(o.r)); out.push(o.r); }
      });
      if (prov === 'd' && !out.length && (net >= 4 || tried >= 10)) { prov = 'i'; switched = true; net = 0; tried = 0; }
      else if (prov === 'i' && !out.length && net >= 3) break;   // iTunes injoignable aussi : on abandonne vite
      if (out.length < cfg.n) await sleep(PROV[prov].gap);
    }
    return { tracks: out, net, switched };
  }
  const coverUrl = tr => (!tr.c ? '' : /^https?:/.test(tr.c) ? tr.c : 'https://cdn-images.dzcdn.net/images/cover/' + tr.c + '/500x500-000000-80-0-0.jpg');

  /* ───────── État ───────── */
  const freshState = () => ({ v: 0, ph: 'lobby', cfg: { cat: 'mix', n: 10, d: 20 }, tr: [], r: 0, t0: 0, gid: '', sc: {}, fd: {}, err: '' });
  let S = freshState();                 // état partagé (reçu du réseau)
  const L = {                           // état local
    me: { id: '', name: 'Joueur', avatar: null, hub: false }, room: null, code: '', joined: false,
    players: [], hostId: '', names: {}, avatars: {}, rd: null, raf: 0,
    audioId: null, audioReady: false, loading: null, vol: 0.8, muted: false,
    cd: [], endTimers: [], endIv: 0, reported: {},
  };
  const H = { phaseAt: 0, rdy: new Set(), doneAt: 0, starting: false };
  const audio = $('#player');
  const isHost = () => !!L.me.id && L.hostId === L.me.id;
  const nameOf = id => L.names[id] || (S.sc[id] && S.sc[id][1]) || 'Joueur';
  const catLabel = () => { const c = ALL_CATS.find(x => x.id === S.cfg.cat); return c ? c.emoji + ' ' + c.nom : ''; };

  /* ───────── Interface : outils ───────── */
  function show(id) { $$('.screen').forEach(s => s.classList.toggle('active', s.id === id)); $('#main').scrollTop = 0; }
  function toast(msg, ms = 3500) {
    let box = $('#toast'); if (!box) { box = document.createElement('div'); box.id = 'toast'; document.body.appendChild(box); }
    const d = document.createElement('div'); d.className = 'toast-item'; d.textContent = msg; box.appendChild(d);
    setTimeout(() => d.remove(), ms);
  }
  function bigMsg(text, kind) {
    const box = $('#big-msg'), d = document.createElement('div');
    d.className = 'bm ' + (kind || ''); d.textContent = text; box.appendChild(d);
    setTimeout(() => d.remove(), 1500);
    while (box.children.length > 4) box.firstChild.remove();
  }
  function avatarEl(id, name) {
    const url = L.avatars[id] || '';
    let el;
    if (url) {
      el = document.createElement('img'); el.src = url; el.alt = '';
      el.addEventListener('error', () => { L.avatars[id] = ''; fillSlots(document); });
    } else {
      el = document.createElement('span'); el.className = 'av-fb';
      el.textContent = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
      el.style.background = 'hsl(' + (hash(id) % 360) + ' 65% 45%)';
    }
    el.classList.add('av');
    el.setAttribute('data-chadgang-id', id);   // le hub y affiche la caméra du joueur quand elle est allumée
    el.dataset.bt = '1'; el.dataset.url = url; el.dataset.nm = name || '';
    return el;
  }
  function fillSlots(root) {
    $$('.avslot', root).forEach(s => {
      const id = s.dataset.id, name = nameOf(id), cur = s.firstElementChild;
      if (cur && !cur.dataset.bt) return;   // élément géré par le hub : on n'y touche pas
      if (cur && cur.dataset.url === (L.avatars[id] || '') && cur.dataset.nm === name) return;
      s.replaceChildren(avatarEl(id, name));
    });
  }
  function slot(id) { return '<span class="avslot" data-id="' + esc(id) + '"></span>'; }
  function refreshUi() {
    fillSlots(document);
    renderLobby();
    $('#btn-skip').hidden = !(isHost() && S.ph === 'round');   // l'hôte peut changer en cours de partie
    if (S.ph === 'end') { $('#btn-again').hidden = !isHost(); $('#end-wait').hidden = isHost(); }
    if ($('#s-game').classList.contains('active')) updateBoard();
  }

  /* ───────── Salle : connexion ───────── */
  function localRoom(code) {
    const me = L.me, h = {}, peers = new Map(), at = Date.now() + Math.random();
    let kept = null, closed = false;
    const emit = (e, ...a) => (h[e] || []).forEach(f => { try { f(...a); } catch (err) { console.error(err); } });
    const ch = typeof BroadcastChannel === 'function' ? new BroadcastChannel('bt-' + code) : null;
    const post = m => { if (ch) ch.postMessage(m); };
    const list = () => [...peers.values()].sort((a, b) => a.at - b.at).map(p => ({ id: p.id, name: p.name }));
    peers.set(me.id, { id: me.id, name: me.name, at });
    if (ch) ch.onmessage = ev => {
      const m = ev.data || {};
      if (m.k === 'hello') {
        const isNew = !peers.has(m.id); peers.set(m.id, { id: m.id, name: m.name, at: m.at });
        if (isNew) { post({ k: 'hello', id: me.id, name: me.name, at }); if (kept) post({ k: 'sync', to: m.id, data: kept.data, from: kept.from }); emit('players', list()); }
      } else if (m.k === 'bye') { peers.delete(m.id); emit('players', list()); }
      else if (m.k === 'msg') { if (m.keep) kept = { data: m.data, from: m.from }; emit('message', m.data, m.from); }
      else if (m.k === 'sync' && m.to === me.id) emit('message', m.data, m.from);
    };
    post({ k: 'hello', id: me.id, name: me.name, at });
    setTimeout(() => emit('ready', { me: me.id, players: list(), last: null }), 300);
    return {
      on(e, f) { (h[e] = h[e] || []).push(f); },
      send(data, opt) {
        if (closed) return;
        const from = { id: me.id, name: me.name };
        if (opt && opt.keep) kept = { data, from };
        post({ k: 'msg', data, from, keep: !!(opt && opt.keep) });
        setTimeout(() => emit('message', data, from), 0);
      },
      leave() { closed = true; post({ k: 'bye', id: me.id }); if (ch) ch.close(); },
    };
  }
  function enter(code, create) {
    if (L.room) leaveRoom(true);
    FX.unlock(); unlockAudio();
    if (!L.me.hub) { L.me.name = ($('#pseudo').value || '').trim().slice(0, 20) || L.me.name; store('bt_name', L.me.name); }
    L.names[L.me.id] = L.me.name; L.avatars[L.me.id] = L.me.avatar || '';
    L.code = code; L.joined = false;
    $('#home-msg').textContent = 'Connexion à la salle…';
    let room;
    try { room = L.me.hub ? ChadGang.join(code, { create }) : localRoom(code); }
    catch (e) { L.room = null; $('#home-msg').textContent = '😕 Impossible de rejoindre cette salle.'; return; }
    L.room = room;
    room.on('ready', onReady);
    room.on('players', onPlayers);
    room.on('message', onMessage);
    room.on('error', msg => {
      if (!L.joined) { leaveRoom(true); $('#home-msg').textContent = '😕 ' + (msg || 'Impossible de rejoindre cette salle.'); }
      else toast('⚠️ ' + (msg || 'Problème de connexion'));
    });
  }
  function leaveRoom(silent) {
    try { if (L.room) L.room.leave(); } catch (e) { /* ignoré */ }
    L.room = null; L.joined = false; L.players = []; L.hostId = '';
    S = freshState(); H.rdy = new Set(); H.starting = false;
    stopRoundLoop(); cancelCountdown(); clearEnd(); hardStopAudio(); showLoading(false);
    document.body.classList.remove('fever', 'danger');
    if (!silent) { $('#home-msg').textContent = ''; }
    show('s-home');
  }
  function setPlayers(list) {
    L.players = (list || []).filter(p => p && p.id).map(p => ({ id: String(p.id), name: p.name }));
    L.players.forEach(p => { if (p.name && !L.names[p.id]) L.names[p.id] = String(p.name).slice(0, 24); });
    L.hostId = L.players[0] ? L.players[0].id : '';
  }
  function sendHi() { if (L.room) L.room.send({ t: 'hi', n: L.me.name, av: L.me.avatar || '' }); }
  function onReady(info) {
    L.joined = true;
    if (info && info.me && String(info.me) !== L.me.id) {   // identifiant de salle différent : on recale notre nom et notre photo
      L.me.id = String(info.me); L.names[L.me.id] = L.me.name; L.avatars[L.me.id] = L.me.avatar || '';
    }
    setPlayers(info && info.players);
    sendHi();
    $('#home-msg').textContent = '';
    $('#room-code').textContent = L.code;
    show('s-lobby'); renderLobby();
    if (!store('bt_rules_seen')) openRules();
    if (info && info.last && info.last.t === 'state') applyState(info.last, true);
    if (isHost()) hostBecame();
    refreshUi();
  }
  function onPlayers(list) {
    const oldIds = L.players.map(p => p.id), oldHost = L.hostId;
    setPlayers(list);
    if (L.players.some(p => !oldIds.includes(p.id))) { sendHi(); if (S.ph === 'lobby') FX.sfx.join(); }
    if (isHost() && oldHost !== L.hostId) hostBecame();
    refreshUi();
  }
  function onMessage(data, from) {
    if (!data || typeof data !== 'object' || !from) return;
    switch (data.t) {
      case 'hi':
        if (data.n) L.names[from.id] = String(data.n).slice(0, 24);
        if (typeof data.av === 'string' && /^https?:\/\//.test(data.av)) L.avatars[from.id] = data.av;
        refreshUi(); break;
      case 'state': applyState(data, false); break;
      case 'found': if (isHost()) handleFound(from, data); break;
      case 'rdy': if (isHost() && S.ph === 'prep' && data.r === S.r) H.rdy.add(from.id); break;
    }
  }

  /* ───────── État partagé : application ───────── */
  function applyState(next, fromReady) {
    if (!next || typeof next.v !== 'number' || next.v <= S.v) return;
    const old = S;
    S = Object.assign(freshState(), next); delete S.t;
    if (S.ph !== old.ph || S.r !== old.r || old.v === 0) phaseChanged(old, !!fromReady);
    else sameUpdate(old);
  }
  function phaseChanged(old, fromReady) {
    showLoading(S.ph === 'load');
    if (S.ph !== 'round') stopRoundLoop();
    if (S.ph !== 'end') clearEnd();
    switch (S.ph) {
      case 'lobby': cancelCountdown(); hardStopAudio(); document.body.classList.remove('fever', 'danger'); show('s-lobby'); renderLobby(); break;
      case 'load': break;
      case 'prep': startPrep(); break;
      case 'round': startRound(fromReady); break;
      case 'reveal': startReveal(); break;
      case 'end': startEnd(); break;
    }
  }
  function sameUpdate(old) {
    if (S.ph === 'lobby') { renderLobby(); return; }
    if (S.ph === 'round') { diffFound(old); updateStatusChips(); }
    updateBoard();
  }
  function showLoading(on) { $('#loading').hidden = !on; }

  /* ───────── Hôte : machine à états ───────── */
  function commit(patch) {
    const next = Object.assign({}, S, patch, { v: S.v + 1 });
    if (next.ph !== S.ph || next.r !== S.r) { H.phaseAt = Date.now(); H.rdy = new Set(); H.doneAt = 0; }
    if (L.room) L.room.send(Object.assign({ t: 'state' }, next), { keep: true });
    applyState(next, false);
  }
  function hostBecame() {
    H.phaseAt = Date.now(); H.doneAt = 0;
    L.players.forEach(p => H.rdy.add(p.id));
    if (S.v === 0) { commit({}); return; }
    if (S.ph === 'load') commit({ ph: 'lobby', err: 'La préparation a été interrompue, relance la partie.' });
  }
  async function hostStart() {
    if (!isHost() || H.starting || S.ph !== 'lobby') return;
    H.starting = true;
    commit({ ph: 'load', err: '', gid: (L.code + '-' + Date.now().toString(36)).slice(0, 64), tr: [], r: 0, fd: {}, sc: {} });
    let res = { tracks: [], net: 0, switched: false };
    try { res = await resolveTracks(S.cfg); } catch (e) { /* géré plus bas */ }
    const tr = res.tracks;
    H.starting = false;
    if (!isHost() || S.ph !== 'load') return;
    if (tr.length < Math.min(3, S.cfg.n)) {
      commit({
        ph: 'lobby', tr: [],
        err: res.net > 0
          ? "Deezer (et iTunes) sont injoignables depuis ton navigateur. Vérifie ta connexion ou un bloqueur de pub, puis réessaie."
          : "Pas assez d'extraits trouvés. Réessaie dans un instant ou change de playlist.",
      });
      return;
    }
    if (res.switched) toast('Deezer ne répond pas : playlist préparée avec iTunes.');
    const sc = {}; L.players.forEach(p => { sc[p.id] = [0, nameOf(p.id), 0]; });
    commit({ ph: 'prep', tr, r: 0, fd: {}, sc });
  }
  function pointsFor(k, ms, pid) {
    const tr = S.tr[S.r], D = S.cfg.d * 1000, speed = 1 - ms / D, prev = S.fd[pid] || {};
    const streak = S.sc[pid] ? S.sc[pid][2] : 0;
    let pts;
    if (k === 't') {
      pts = 100 + Math.round(100 * speed) + Math.min(50, streak * 10);
      if (!Object.values(S.fd).some(f => f.t !== undefined)) pts += 50;
    } else pts = 50 + Math.round(50 * speed);
    if (tr.a && (k === 't' ? prev.a !== undefined : prev.t !== undefined)) pts += 25;
    return pts;
  }
  function handleFound(from, m) {
    if (S.ph !== 'round' || m.r !== S.r) return;
    const tr = S.tr[S.r]; if (!tr) return;
    const k = m.k === 'a' ? 'a' : 't';
    if (k === 'a' && !tr.a) return;
    const pid = from.id, D = S.cfg.d * 1000, ms = clamp(Math.round(+m.ms) || 0, 0, D), prev = S.fd[pid] || {};
    if (prev[k] !== undefined) return;
    const pts = pointsFor(k, ms, pid), cur = S.sc[pid] || [0, from.name || nameOf(pid), 0];
    const f = Object.assign({}, prev, { [k]: ms, p: (prev.p || 0) + pts });
    commit({ fd: Object.assign({}, S.fd, { [pid]: f }), sc: Object.assign({}, S.sc, { [pid]: [cur[0] + pts, from.name || cur[1], cur[2]] }) });
  }
  function endRound() {
    if (S.ph !== 'round') return;
    const sc = {};
    Object.keys(S.sc).forEach(id => { sc[id] = S.sc[id].slice(); });
    L.players.forEach(p => { if (!sc[p.id]) sc[p.id] = [0, nameOf(p.id), 0]; });
    Object.keys(sc).forEach(id => {
      const f = S.fd[id], found = f && f.t !== undefined;
      sc[id] = [sc[id][0], nameOf(id), found ? sc[id][2] + 1 : 0];
    });
    commit({ ph: 'reveal', sc });
  }
  function allReady() { return L.players.every(p => H.rdy.has(p.id)); }
  function allDone() {
    const tr = S.tr[S.r]; if (!tr || !L.players.length) return false;
    return L.players.every(p => { const f = S.fd[p.id]; return f && f.t !== undefined && (!tr.a || f.a !== undefined); });
  }
  function hostTick() {
    if (!isHost() || !L.joined) return;
    const now = Date.now(), age = now - H.phaseAt;
    if (S.ph === 'prep') {
      if (age >= T.prepMin && (allReady() || age >= T.prepMax)) commit({ ph: 'round', t0: now, fd: {} });
    } else if (S.ph === 'round') {
      if (now - S.t0 >= S.cfg.d * 1000 + T.roundTail) { endRound(); return; }
      if (allDone()) { H.doneAt = H.doneAt || now; if (now - H.doneAt >= T.endGrace) endRound(); } else H.doneAt = 0;
    } else if (S.ph === 'reveal') {
      if (age >= T.reveal) {
        if (S.r + 1 < S.tr.length) commit({ ph: 'prep', r: S.r + 1, fd: {} });
        else commit({ ph: 'end' });
      }
    }
  }
  setInterval(hostTick, 250);

  /* ───────── Audio ───────── */
  function unlockAudio() {
    try { audio.src = SILENT_WAV; const p = audio.play(); if (p && p.then) p.then(() => audio.pause()).catch(() => {}); } catch (e) { /* ignoré */ }
    L.audioId = null; L.audioReady = false;
  }
  function setVolume(v) { L.vol = clamp(v, 0, 1); try { audio.volume = L.vol; } catch (e) { /* iOS */ } FX.setVolume(L.vol); }
  function setMuted(m) { L.muted = !!m; audio.muted = L.muted; FX.setMuted(L.muted); $('#btn-mute').textContent = L.muted ? '🔇' : '🔊'; store('bt_muted', L.muted ? '1' : '0'); }
  function hardStopAudio() { try { audio.pause(); } catch (e) { /* ignoré */ } $('#s-game').classList.remove('playing'); }
  function fadeOut(ms) {
    return new Promise(res => {
      if (audio.paused || !audio.src) { res(); return; }
      const v0 = L.vol, t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        try { audio.volume = v0 * (1 - k); } catch (e) { /* iOS */ }
        if (k < 1) requestAnimationFrame(step);
        else { audio.pause(); try { audio.volume = L.vol; } catch (e) { /* iOS */ } $('#s-game').classList.remove('playing'); res(); }
      };
      step();
    });
  }
  function waitCanPlay(ms) {
    return new Promise(res => {
      if (audio.readyState >= 3) { res(); return; }
      const done = () => { clearTimeout(to); audio.removeEventListener('canplay', done); audio.removeEventListener('error', done); res(); };
      const to = setTimeout(done, ms);
      audio.addEventListener('canplay', done); audio.addEventListener('error', done);
    });
  }
  async function loadAudio(tr) {
    L.audioReady = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = await getPreview(tr, attempt > 0);   // 2e essai : lien Deezer tout frais
        audio.pause(); audio.src = url; audio.load(); L.audioId = tkey(tr);
        await waitCanPlay(6000);
        if (audio.error) throw new Error('lecture');
        L.audioReady = true; return true;
      } catch (e) { L.audioId = null; if (tr.p === 'i') break; }
    }
    return false;
  }
  function ensureAudio(tr) {
    const k = tkey(tr);
    if (L.audioId === k && L.audioReady) return Promise.resolve(true);
    if (L.loading && L.loading.id === k) return L.loading.p;
    const p = loadAudio(tr).then(ok => { if (L.loading && L.loading.p === p) L.loading = null; return ok; });
    L.loading = { id: k, p };
    return p;
  }
  async function playAudio(tr, offset) {
    try {
      const ok = await ensureAudio(tr);
      if (!ok) throw new Error('load');
      if (S.ph !== 'round' && S.ph !== 'reveal') return;
      if (offset > 0.3) { try { audio.currentTime = offset; } catch (e) { /* ignoré */ } }
      await audio.play();
      $('#gate').hidden = true;
      $('#s-game').classList.add('playing');
    } catch (err) {
      if (err && err.name === 'NotAllowedError') { L.pending = { tr, offset }; $('#gate').hidden = false; }
      else toast("🔇 L'extrait n'a pas pu être lu pour toi cette manche.");
    }
  }
  audio.addEventListener('ended', () => $('#s-game').classList.remove('playing'));

  /* ───────── Manche : préparation, jeu, révélation ───────── */
  function cancelCountdown() { L.cd.forEach(clearTimeout); L.cd = []; }
  function prepGameShell() {
    show('s-game');
    $('#s-game').dataset.state = S.ph;
    $('#g-round').textContent = 'Manche ' + (S.r + 1) + '/' + S.tr.length;
    $('#g-cat').textContent = catLabel();
  }
  function resetRoundVisuals() {
    $('#feed').innerHTML = ''; $('#big-msg').innerHTML = ''; $('#found-chips').innerHTML = '';
    const ht = $('#hint-t'), ha = $('#hint-a');
    ht.textContent = ''; ht.className = 'hint-line'; ha.textContent = ''; ha.className = 'hint-line sm';
    $('#hints').hidden = false; $('#reveal').hidden = true;
    $('#s-game').classList.remove('revealed', 'playing');
    $('#ring-fg').style.strokeDashoffset = 0; $('#g-time').textContent = '?';
    lockInput('Prépare-toi…');
    document.body.classList.remove('danger');
    $('#btn-skip').hidden = true;
    $('#g-cover').removeAttribute('src');
  }
  function lockInput(ph) { const i = $('#guess'); i.disabled = true; i.value = ''; i.placeholder = ph; $('#guess-form button').disabled = true; }
  function enableInput() {
    const i = $('#guess'); i.disabled = false; i.placeholder = 'Titre ou artiste…'; $('#guess-form button').disabled = false;
    try { i.focus({ preventScroll: true }); } catch (e) { /* ignoré */ }
  }
  function updateStreak() {
    const st = S.sc[L.me.id] ? S.sc[L.me.id][2] : 0, b = $('#streak');
    b.hidden = st < 2; $('#streak-n').textContent = '×' + st;
    document.body.classList.toggle('fever', st >= 3);
  }
  function buildChips() {
    const tr = S.tr[S.r], box = $('#found-chips'); if (!tr) return;
    box.innerHTML = '<span class="fchip" data-k="t">' + (tr.a ? '🎯 Titre' : '📺 Série') + '</span>' + (tr.a ? '<span class="fchip" data-k="a">🎤 Artiste</span>' : '');
    updateStatusChips();
  }
  function updateStatusChips() {
    const rd = L.rd; if (!rd) return;
    $$('#found-chips .fchip').forEach(c => c.classList.toggle('ok', c.dataset.k === 't' ? !!rd.t : !!rd.a));
  }

  async function startPrep() {
    const r = S.r, tr = S.tr[r]; if (!tr) return;
    prepGameShell(); resetRoundVisuals();
    L.rd = { r, t: false, a: false, closed: true, hintT: -1, hintA: -1, lastSec: null };
    $('#stage').classList.add('prep');
    updateStreak(); updateBoard();
    cancelCountdown();
    [3, 2, 1].forEach((n, i) => L.cd.push(setTimeout(() => { if (S.ph === 'prep') { bigMsg(String(n), 'cd'); FX.sfx.count(n); FX.vibrate(15); } }, i * 1000)));
    await fadeOut(250);
    await ensureAudio(tr);
    if (S.r === r && L.room) L.room.send({ t: 'rdy', r });
    if (S.tr[r + 1]) getPreview(S.tr[r + 1]).catch(() => {});   // on prépare déjà la manche suivante
  }
  function startRound(fromReady) {
    const tr = S.tr[S.r]; if (!tr) return;
    prepGameShell();
    if (!L.rd || L.rd.r !== S.r) { resetRoundVisuals(); L.rd = { r: S.r }; }   // arrivée en cours de manche
    const D = S.cfg.d, elapsed = fromReady ? clamp((Date.now() - S.t0) / 1000, 0, D) : 0;
    Object.assign(L.rd, { t0: performance.now() - elapsed * 1000, t: false, a: false, closed: false, lastSec: null, hintT: 0, hintA: -1 });
    const mine = S.fd[L.me.id];
    if (mine) { if (mine.t !== undefined) L.rd.t = true; if (mine.a !== undefined) L.rd.a = true; }
    cancelCountdown();
    $('#stage').classList.remove('prep');
    $('#s-game').classList.remove('revealed');
    $('#hints').hidden = false; $('#reveal').hidden = true;
    bigMsg('GO !', 'go'); FX.sfx.count(0); FX.flash('go'); FX.vibrate(40);
    playAudio(tr, elapsed);
    buildChips(); renderHints(); startRoundLoop(); updateBoard(); updateStreak();
    if (L.rd.t && (L.rd.a || !tr.a)) lockInput('🎉 Tout trouvé ! On attend les autres…'); else enableInput();
    $('#btn-skip').hidden = !isHost();
    if (S.tr[S.r + 1]) getPreview(S.tr[S.r + 1]).catch(() => {});
  }
  function renderHints() {
    const tr = S.tr[S.r], rd = L.rd; if (!tr || !rd) return;
    const ht = $('#hint-t'), ha = $('#hint-a');
    if (rd.t) { ht.textContent = '✅ ' + tr.t; ht.className = 'hint-line ok'; }
    else { ht.className = 'hint-line'; ht.textContent = maskText(tr.t, Math.max(0, rd.hintT)); }
    if (!tr.a) { ha.textContent = ''; }
    else if (rd.a) { ha.textContent = '✅ ' + tr.a; ha.className = 'hint-line sm ok'; }
    else { ha.className = 'hint-line sm'; ha.textContent = rd.hintA >= 0 ? maskText(tr.a, rd.hintA) : ''; }
  }
  function startRoundLoop() {
    stopRoundLoop();
    const loop = () => { roundFrame(); L.raf = requestAnimationFrame(loop); };
    L.raf = requestAnimationFrame(loop);
  }
  function stopRoundLoop() { if (L.raf) cancelAnimationFrame(L.raf); L.raf = 0; document.body.classList.remove('danger'); }
  function roundFrame() {
    const rd = L.rd; if (!rd || S.ph !== 'round') return;
    const D = S.cfg.d, el = (performance.now() - rd.t0) / 1000, left = Math.max(0, D - el);
    $('#ring-fg').style.strokeDashoffset = RING_LEN * (1 - left / D);
    const s = Math.ceil(left);
    if (s !== rd.lastSec) {
      rd.lastSec = s; $('#g-time').textContent = s;
      if (s <= 5 && s > 0 && !rd.closed) FX.sfx.tick();
    }
    document.body.classList.toggle('danger', left <= 5 && left > 0);
    const frac = el / D, hT = frac < 0.35 ? 0 : frac < 0.7 ? 1 : 2, hA = frac < 0.5 ? -1 : frac < 0.75 ? 0 : 1;
    if (hT !== rd.hintT || hA !== rd.hintA) { rd.hintT = hT; rd.hintA = hA; renderHints(); }
    if (left <= 0 && !rd.closed) { rd.closed = true; lockInput('⏱ Temps écoulé'); }
  }

  function submitGuess(text) {
    const rd = L.rd, tr = S.tr[S.r];
    if (S.ph !== 'round' || !rd || rd.closed || !tr || !String(text).trim()) return;
    const res = judge(text, tr), ms = Math.round(performance.now() - rd.t0);
    let gotT = false, gotA = false;
    if (res.t && !rd.t) { rd.t = true; gotT = true; L.room.send({ t: 'found', r: S.r, k: 't', ms }); }
    if (res.a && tr.a && !rd.a) { rd.a = true; gotA = true; L.room.send({ t: 'found', r: S.r, k: 'a', ms }); }
    const inp = $('#guess');
    if (gotT || gotA) {
      const all = rd.t && (rd.a || !tr.a), p = FX.centerOf($('#stage'));
      if (all && tr.a) { bigMsg('PARFAIT !', 'good'); FX.sfx.great(); FX.burst(p.x, p.y, 150, { speed: 13 }); FX.flash('gold'); FX.shake(); }
      else if (gotT) { bigMsg(tr.a ? 'TITRE !' : 'BIEN VU !', 'good'); FX.sfx.good(); FX.burst(p.x, p.y, 90); FX.flash('good'); }
      else { bigMsg('ARTISTE !', 'good'); FX.sfx.good(); FX.burst(p.x, p.y, 70); FX.flash('good'); }
      FX.vibrate([30, 40, 30]);
      renderHints(); updateStatusChips(); inp.value = '';
      if (all) { lockInput('🎉 Tout trouvé ! On attend les autres…'); rd.closed = true; }
    } else if ((res.t && rd.t) || (res.a && rd.a)) {
      bigMsg('Déjà trouvé !', ''); inp.value = '';
    } else {
      inp.classList.remove('bad'); void inp.offsetWidth; inp.classList.add('bad');
      FX.sfx.wrong(); FX.flash('bad'); FX.vibrate(80); inp.select();
    }
  }

  function feedAdd(pid, k, ms) {
    const tr = S.tr[S.r], feed = $('#feed'), d = document.createElement('div');
    d.className = 'fitem';
    const what = k === 't' ? (tr.a ? 'le titre' : 'la réponse') : "l'artiste";
    d.innerHTML = slot(pid) + '<span>' + (k === 't' ? '🎯' : '🎤') + ' <b>' + esc(pid === L.me.id ? 'Toi' : nameOf(pid)) + '</b> : ' + what + ' · ' + sec(ms) + '</span>';
    fillSlots(d); feed.appendChild(d);
    while (feed.children.length > 4) feed.firstChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 520); }, 6000);
  }
  function diffFound(old) {
    if (!S.tr[S.r]) return;
    Object.entries(S.fd).forEach(([pid, f]) => {
      const o = old.fd[pid] || {};
      ['t', 'a'].forEach(k => {
        if (f[k] !== undefined && o[k] === undefined) { feedAdd(pid, k, f[k]); if (pid !== L.me.id) FX.sfx.other(); }
      });
      if (pid === L.me.id) { const gain = (f.p || 0) - (o.p || 0); if (gain > 0) bigMsg('+' + gain, 'pts'); }
    });
  }

  function startReveal() {
    const tr = S.tr[S.r]; if (!tr) return;
    prepGameShell(); stopRoundLoop(); cancelCountdown();
    if (!L.rd || L.rd.r !== S.r) { resetRoundVisuals(); L.rd = { r: S.r, t: false, a: false }; }
    L.rd.closed = true;
    $('#stage').classList.remove('prep');
    lockInput('Manche terminée');
    $('#g-time').textContent = '♪'; $('#ring-fg').style.strokeDashoffset = RING_LEN;
    const img = $('#g-cover'); img.alt = tr.t; img.style.display = ''; img.onerror = () => { img.style.display = 'none'; };
    img.src = coverUrl(tr);
    $('#s-game').classList.add('revealed');
    $('#hints').hidden = true; $('#btn-skip').hidden = true; $('#reveal').hidden = false;
    $('#rv-title').textContent = tr.t; $('#rv-artist').textContent = tr.a || ''; $('#rv-x').textContent = tr.x ? '♪ ' + tr.x : '';
    const ids = new Set(L.players.map(p => p.id).concat(Object.keys(S.fd)));
    const rows = [...ids].map(id => ({ id, f: S.fd[id] || null })).sort((a, b) => ((b.f && b.f.p) || 0) - ((a.f && a.f.p) || 0));
    const ul = $('#rv-list'); ul.innerHTML = '';
    rows.forEach((r, i) => {
      const f = r.f, li = document.createElement('li');
      li.className = f && f.p ? '' : 'none'; li.style.animationDelay = (i * 70) + 'ms';
      li.innerHTML = slot(r.id) + '<span class="nm">' + esc(nameOf(r.id)) + '</span><span>' + (f && f.t !== undefined ? '🎯 ' + sec(f.t) : '') + ' ' + (f && f.a !== undefined ? '🎤 ' + sec(f.a) : '') + '</span><b class="pts">' + (f && f.p ? '+' + f.p : '—') + '</b>';
      ul.appendChild(li);
    });
    fillSlots(ul);
    const fill = $('#next-fill');
    if (fill.animate) fill.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: T.reveal, easing: 'linear', fill: 'forwards' });
    FX.sfx.reveal(); FX.flash('go');
    const mine = S.fd[L.me.id];
    if (mine && mine.t !== undefined) { const p = FX.centerOf($('#stage')); FX.burst(p.x, p.y, 70, { speed: 10 }); }
    updateStreak(); updateBoard();
    const st = S.sc[L.me.id] ? S.sc[L.me.id][2] : 0;
    if (st >= 3) setTimeout(() => bigMsg('🔥 SÉRIE ×' + st, 'go'), 600);
    if (S.tr[S.r + 1]) getPreview(S.tr[S.r + 1]).catch(() => {});
  }

  /* ───────── Classement ───────── */
  function scoreRows() {
    const present = new Set(L.players.map(p => p.id));
    const ids = new Set([...present].concat(Object.keys(S.sc)));
    const rows = [...ids].map(id => {
      const f = S.fd[id]; let st = '';
      if ((S.ph === 'round' || S.ph === 'reveal') && f) { if (f.t !== undefined) st += '🎯'; if (f.a !== undefined) st += '🎤'; }
      return { id, name: nameOf(id), pts: S.sc[id] ? S.sc[id][0] : 0, present: present.has(id), st };
    });
    rows.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
    let rank = 0, last = null;
    rows.forEach((r, i) => { if (r.pts !== last) { rank = i + 1; last = r.pts; } r.rank = rank; });
    return rows;
  }
  function updateBoard() { renderBoard($('#board'), scoreRows()); }
  function renderBoard(ol, rows) {
    const first = new Map();
    [...ol.children].forEach(li => first.set(li.dataset.id, li.getBoundingClientRect()));
    const keep = new Set();
    rows.forEach(row => {
      keep.add(row.id);
      let li = [...ol.children].find(l => l.dataset.id === row.id);
      if (!li) {
        li = document.createElement('li'); li.dataset.id = row.id; li._pts = 0;
        li.innerHTML = '<span class="rk"></span>' + slot(row.id) + '<span class="nm"></span><span class="st"></span><b class="pt">0</b>';
      }
      li.classList.toggle('me', row.id === L.me.id); li.classList.toggle('away', !row.present);
      li.querySelector('.rk').textContent = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank;
      li.querySelector('.nm').textContent = row.name;
      li.querySelector('.st').textContent = row.st || '';
      if (li._pts !== row.pts) {
        FX.countUp(li.querySelector('.pt'), li._pts, row.pts, 700);
        if (row.pts > li._pts) { li.classList.remove('bump'); void li.offsetWidth; li.classList.add('bump'); }
        li._pts = row.pts;
      }
      ol.appendChild(li);
    });
    [...ol.children].forEach(li => { if (!keep.has(li.dataset.id)) li.remove(); });
    fillSlots(ol);
    [...ol.children].forEach(li => {
      const a = first.get(li.dataset.id); if (!a || !li.animate) return;
      const b = li.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (dx || dy) li.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    });
  }

  /* ───────── Fin de partie ───────── */
  function clearEnd() { L.endTimers.forEach(clearTimeout); L.endTimers = []; if (L.endIv) clearInterval(L.endIv); L.endIv = 0; }
  function startEnd() {
    stopRoundLoop(); cancelCountdown(); clearEnd();
    fadeOut(900); show('s-end');
    document.body.classList.remove('danger');
    const rows = scoreRows().filter(r => S.sc[r.id]);
    const pod = $('#podium'); pod.innerHTML = '';
    const top = rows.slice(0, 3), pods = [];
    [1, 0, 2].forEach(i => {
      const r = top[i]; if (!r) return;
      const d = document.createElement('div');
      d.className = 'pod p' + (i + 1);
      d.innerHTML = '<div class="who-pod">' + (r.rank === 1 ? '<div class="crown">👑</div>' : '') + slot(r.id) + '<div class="pn"></div></div>' +
        '<div class="bar-pod"><span class="medal">' + (r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉') + '</span><b class="ps">0</b></div>';
      d.querySelector('.pn').textContent = r.name;
      pod.appendChild(d); pods[i] = { el: d, r };
    });
    fillSlots(pod);
    const reveal = i => {
      const p = pods[i]; if (!p) return;
      p.el.classList.add('show');
      FX.countUp(p.el.querySelector('.ps'), 0, p.r.pts, 1300);
      FX.sfx.reveal();
    };
    const at = (ms, fn) => L.endTimers.push(setTimeout(fn, ms));
    FX.sfx.drum(3);
    at(500, () => reveal(2));
    at(1700, () => { FX.sfx.drum(3); reveal(1); });
    at(3200, () => FX.sfx.drum(6));
    at(4300, () => {
      reveal(0);
      FX.sfx.fanfare(); FX.flash('gold'); FX.shake(); FX.rain(160);
      const { W, H } = FX.size;
      FX.burst(W / 2, H * 0.4, 160, { speed: 14 });
      let n = 0;
      L.endIv = setInterval(() => {
        FX.firework(Math.random() * W, Math.random() * H * 0.55);
        if (++n % 3 === 0) FX.rain(40);
        if (n > 14) { clearInterval(L.endIv); L.endIv = 0; }
      }, 650);
    });
    const list = $('#final-list'); list.innerHTML = '';
    renderBoard(list, rows.map(r => Object.assign({}, r, { st: '' })));
    $('#btn-again').hidden = !isHost(); $('#end-wait').hidden = isHost();
    reportResult(rows);
  }
  function reportResult(rows) {
    const me = L.me.id;
    if (!S.sc[me] || L.reported[S.gid] || rows.length < 2) return;
    L.reported[S.gid] = true;
    if (!(window.ChadGang && ChadGang.finPartie)) return;
    const mine = S.sc[me][0], best = Math.max.apply(null, rows.map(r => r.pts));
    Promise.resolve()
      .then(() => ChadGang.finPartie({ gagne: mine === best && best > 0, partie: S.gid, score: mine }))
      .then(res => { if (res && res.record) toast('🏅 Nouveau record du hub !'); })
      .catch(() => {});
  }

  /* ───────── Salle d'attente ───────── */
  function seg(id, values, cur, fmt, host) {
    const box = $('#' + id); box.classList.toggle('locked', !host);
    box.innerHTML = values.map(v => '<button type="button" data-v="' + v + '" class="' + (v === cur ? 'on' : '') + '">' + fmt(v) + '</button>').join('');
  }
  function renderLobby() {
    $('#room-code').textContent = L.code;
    const ul = $('#lobby-players'); ul.innerHTML = '';
    L.players.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = slot(p.id) + '<span class="nm"></span>' + (p.id === L.hostId ? '<span class="tag">👑 hôte</span>' : '') + (p.id === L.me.id ? '<span class="tag">toi</span>' : '');
      li.querySelector('.nm').textContent = nameOf(p.id);
      ul.appendChild(li);
    });
    fillSlots(ul);
    $('#pl-count').textContent = L.players.length;
    const host = isHost();
    const cats = $('#cfg-cats'); cats.classList.toggle('locked', !host);
    cats.innerHTML = ALL_CATS.map(c => '<button class="chip' + (S.cfg.cat === c.id ? ' on' : '') + '" data-cat="' + esc(c.id) + '" type="button">' + c.emoji + ' ' + esc(c.nom) + '</button>').join('');
    seg('cfg-n', N_CHOICES, S.cfg.n, v => v, host);
    seg('cfg-d', D_CHOICES, S.cfg.d, v => v + ' s', host);
    $('#lobby-err').textContent = S.err || '';
    $('#btn-start').hidden = !host; $('#lobby-wait').hidden = host;
    $('#btn-start').disabled = S.ph !== 'lobby';
  }

  /* ───────── Règles ───────── */
  function openRules() { $('#rules').hidden = false; store('bt_rules_seen', '1'); }
  function closeRules() { $('#rules').hidden = true; }

  /* ───────── Branchements ───────── */
  function genCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c = ''; for (let i = 0; i < 4; i++) c += a[Math.floor(Math.random() * a.length)]; return c; }
  const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

  function wire() {
    $('#btn-create').onclick = () => enter(genCode(), true);
    const join = () => {
      const c = cleanCode($('#code').value);
      if (c.length < 4) { $('#home-msg').textContent = 'Entre le code de la salle (4 lettres ou plus).'; return; }
      enter(c, false);
    };
    $('#btn-join').onclick = join;
    $('#code').addEventListener('input', e => { e.target.value = cleanCode(e.target.value); });
    $('#code').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
    $('#code-copy').onclick = () => {
      try { navigator.clipboard.writeText(L.code).then(() => toast('Code copié : ' + L.code)).catch(() => toast('Code : ' + L.code)); } catch (e) { toast('Code : ' + L.code); }
    };
    $('#btn-leave').onclick = () => leaveRoom();
    $('#btn-leave2').onclick = () => leaveRoom();
    $('#btn-start').onclick = () => { FX.unlock(); unlockAudio(); hostStart(); };
    $('#btn-again').onclick = () => { if (isHost()) commit({ ph: 'lobby', tr: [], r: 0, fd: {}, sc: {}, err: '' }); };
    $('#btn-skip').onclick = () => { if (isHost()) endRound(); };
    $('#cfg-cats').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]'); if (!b || !isHost() || S.ph !== 'lobby') return;
      commit({ cfg: Object.assign({}, S.cfg, { cat: b.dataset.cat }) });
    });
    $('#cfg-n').addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b || !isHost() || S.ph !== 'lobby') return;
      commit({ cfg: Object.assign({}, S.cfg, { n: +b.dataset.v }) });
    });
    $('#cfg-d').addEventListener('click', e => {
      const b = e.target.closest('[data-v]'); if (!b || !isHost() || S.ph !== 'lobby') return;
      commit({ cfg: Object.assign({}, S.cfg, { d: +b.dataset.v }) });
    });
    $('#guess-form').addEventListener('submit', e => { e.preventDefault(); submitGuess($('#guess').value); });
    $('#guess').addEventListener('animationend', e => e.target.classList.remove('bad'));
    $('#btn-rules').onclick = openRules;
    $('#rules-x').onclick = closeRules; $('#rules-ok').onclick = closeRules;
    $('#rules').addEventListener('click', e => { if (e.target.id === 'rules') closeRules(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeRules(); });
    $('#btn-mute').onclick = () => setMuted(!L.muted);
    $('#vol').addEventListener('input', e => { setVolume(e.target.value / 100); store('bt_vol', e.target.value); });
    $('#gate-btn').onclick = () => {
      FX.unlock();
      audio.play().then(() => { $('#gate').hidden = true; $('#s-game').classList.add('playing'); })
        .catch(() => { $('#gate').hidden = true; });
    };
    // équaliseur décoratif
    const eq = $('#eq');
    for (let i = 0; i < 28; i++) {
      const b = document.createElement('i');
      b.style.setProperty('--d', (0.32 + Math.random() * 0.6).toFixed(2) + 's');
      b.style.setProperty('--o', (-Math.random()).toFixed(2) + 's');
      eq.appendChild(b);
    }
  }

  async function getMe() {
    if (window.ChadGang && typeof ChadGang.me === 'function') {
      try {
        const m = await Promise.race([ChadGang.me(), sleep(5000).then(() => null)]);
        if (m && m.id) return { id: String(m.id), name: String(m.name || 'Joueur'), avatar: m.avatar || null, hub: typeof ChadGang.join === 'function' };
      } catch (e) { /* mode de secours ci-dessous */ }
    }
    let id = null;
    try { id = sessionStorage.getItem('bt_lid'); } catch (e) { /* ignoré */ }
    if (!id) { id = 'local-' + Math.random().toString(36).slice(2, 9); try { sessionStorage.setItem('bt_lid', id); } catch (e) { /* ignoré */ } }
    return { id, name: store('bt_name') || 'Joueur' + (10 + Math.floor(Math.random() * 90)), avatar: null, hub: false };
  }

  async function boot() {
    wire();
    const v = store('bt_vol'); if (v !== null && v !== '') { $('#vol').value = v; }
    setVolume($('#vol').value / 100);
    setMuted(store('bt_muted') === '1');
    L.me = await getMe();
    L.names[L.me.id] = L.me.name; L.avatars[L.me.id] = L.me.avatar || '';
    if (L.me.hub) {
      const w = $('#who'); w.hidden = false;
      w.innerHTML = slot(L.me.id) + '<span>Salut <b></b> !</span>'; w.querySelector('b').textContent = L.me.name;
      fillSlots(w);
    } else {
      $('#pseudo-row').hidden = false; $('#pseudo').value = L.me.name;
    }
    let inv = '';
    try { inv = (window.ChadGang && ChadGang.room && ChadGang.room()) || new URLSearchParams(location.search).get('room') || ''; } catch (e) { /* ignoré */ }
    inv = cleanCode(inv);
    if (inv) { $('#code').value = inv; $('#home-msg').textContent = '🎉 Invitation reçue pour la salle ' + inv + ' : clique sur Rejoindre !'; }
  }

  window.BT_DEBUG = { state: () => S, local: () => L, judge, maskText, norm, size: () => JSON.stringify(S).length };   // pratique pour les tests
  boot();
})();
