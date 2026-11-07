/* Effets spéciaux du Blind Test : confettis, feux d'artifice, sons synthétisés, secousses, flashs. */
(() => {
  'use strict';

  const cv = document.getElementById('fx');
  const ctx = cv.getContext('2d');
  const COLORS = ['#ffd426', '#ff4fa3', '#22d67a', '#ffffff', '#4ad8ff', '#ff8a2b', '#b57bff'];
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, parts = [], running = false, last = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  function add(p) { if (parts.length < 900) parts.push(p); }

  /** Explosion de confettis (ou de notes) à partir d'un point. */
  function burst(x, y, n = 60, o = {}) {
    if (reduced) n = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) {
      const a = o.angle !== undefined ? o.angle + rnd(-(o.spread || 1), (o.spread || 1)) : rnd(0, Math.PI * 2);
      const s = (o.speed || 9) * rnd(.35, 1.1);
      add({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 0),
        g: o.gravity !== undefined ? o.gravity : .3, drag: o.drag || .985,
        age: 0, max: (o.life || 95) * rnd(.7, 1.3),
        size: rnd(5, 10), color: o.color || pick(COLORS),
        rot: rnd(0, 6.28), vr: rnd(-.3, .3),
        shape: o.shape || (Math.random() < .15 ? 'note' : (Math.random() < .5 ? 'rect' : 'circle')),
      });
    }
    kick();
  }

  /** Pluie de confettis qui tombe du haut de l'écran. */
  function rain(n = 80) {
    if (reduced) n = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) {
      add({
        x: rnd(0, W), y: rnd(-H * .3, -10), vx: rnd(-1.2, 1.2), vy: rnd(2, 5),
        g: .05, drag: .995, age: 0, max: 260, size: rnd(6, 11), color: pick(COLORS),
        rot: rnd(0, 6.28), vr: rnd(-.25, .25), shape: Math.random() < .2 ? 'note' : 'rect',
      });
    }
    kick();
  }

  /** Feu d'artifice : éclat circulaire + étincelles. */
  function firework(x, y) {
    const color = pick(COLORS);
    for (let i = 0; i < (reduced ? 12 : 46); i++) {
      const a = (i / 46) * Math.PI * 2 + rnd(-.05, .05);
      const s = rnd(4, 9);
      add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: .12, drag: .965, age: 0, max: rnd(55, 85), size: rnd(3, 5), color, rot: 0, vr: 0, shape: 'spark' });
    }
    kick();
  }

  function kick() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); } }

  function loop(t) {
    const dt = Math.min(2.2, (t - last) / 16.67); last = t;
    ctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age > p.max || p.y > H + 40) { parts.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt); p.vy = p.vy * Math.pow(p.drag, dt) + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const life = 1 - p.age / p.max;
      ctx.globalAlpha = Math.max(0, Math.min(1, life * 2.2));
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(p.age * .15 + p.rot)) * .9 + .1);
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * .66); ctx.restore();
      } else if (p.shape === 'note') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * .3);
        ctx.font = (p.size * 2.2) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(Math.random() < .5 ? '♪' : '♫', 0, 0); ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.shape === 'spark' ? p.size * life + .5 : p.size / 2, 0, 6.2832); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(loop);
    else { running = false; ctx.clearRect(0, 0, W, H); }
  }

  /** Centre d'un élément (pour lancer des confettis dessus). */
  function centerOf(el) {
    if (!el) return { x: W / 2, y: H / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ───────── Écran : secousse, flash, vibration ───────── */
  function shake() {
    if (reduced) return;
    document.body.classList.remove('shake'); void document.body.offsetWidth;
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 600);
  }
  function flash(kind) {
    const f = document.getElementById('flash');
    f.className = ''; void f.offsetWidth;
    f.className = kind || 'go';
  }
  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignoré */ } }

  /* ───────── Sons synthétisés (aucun fichier à charger) ───────── */
  const A = { ctx: null, muted: false, vol: .8 };
  function ac() {
    if (!A.ctx) { try { A.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    return A.ctx;
  }
  function unlock() { const c = ac(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }
  function tone(f, d = .12, type = 'square', v = .18, at = 0, slideTo) {
    const c = ac(); if (!c || A.muted || A.vol <= 0) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + d);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002, v * A.vol), t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + d + .03);
  }
  const SFX = {
    count(n) { n === 0 ? [660, 880, 1320].forEach((f, i) => tone(f, .22, 'square', .2, i * .06)) : tone(520 + n * 60, .16, 'square', .2); },
    tick() { tone(1000, .05, 'square', .12); },
    good() { [660, 880, 1100].forEach((f, i) => tone(f, .14, 'triangle', .28, i * .07)); },
    great() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, .18, 'triangle', .28, i * .06)); tone(262, .6, 'sawtooth', .1, 0); },
    other() { tone(900, .08, 'sine', .14); tone(1200, .1, 'sine', .12, .06); },
    wrong() { tone(220, .28, 'sawtooth', .2, 0, 90); },
    reveal() { [392, 523, 659, 784].forEach((f, i) => tone(f, .2, 'triangle', .25, i * .09)); },
    join() { tone(700, .08, 'sine', .15); tone(1000, .1, 'sine', .15, .08); },
    drum(n) { for (let i = 0; i < n; i++) tone(110, .09, 'triangle', .3, i * .12, 60); },
    fanfare() {
      const seq = [[523, 0], [523, .14], [523, .28], [659, .42], [523, .62], [659, .78], [784, .98]];
      seq.forEach(([f, at]) => { tone(f, .3, 'square', .17, at); tone(f / 2, .3, 'triangle', .22, at); });
      [1047, 1319, 1568].forEach((f, i) => tone(f, .7, 'triangle', .2, 1.2 + i * .05));
    },
  };

  /* ───────── Notes de musique qui flottent en fond ───────── */
  function initNotes() {
    const box = document.getElementById('notes');
    if (!box || reduced) return;
    const glyphs = ['♪', '♫', '♬', '♩'];
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.textContent = glyphs[i % glyphs.length];
      s.style.left = (Math.random() * 100) + 'vw';
      s.style.fontSize = (18 + Math.random() * 30) + 'px';
      s.style.animationDuration = (12 + Math.random() * 16) + 's';
      s.style.animationDelay = (-Math.random() * 20) + 's';
      box.appendChild(s);
    }
  }
  initNotes();

  /** Compteur animé (0 → n). */
  function countUp(el, from, to, ms = 700) {
    if (!el) return;
    if (el._cu) cancelAnimationFrame(el._cu);
    if (from === to || reduced) { el.textContent = to; return; }
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) el._cu = requestAnimationFrame(step);
    };
    el._cu = requestAnimationFrame(step);
  }

  window.FX = {
    burst, rain, firework, centerOf, shake, flash, vibrate, sfx: SFX, unlock, countUp,
    setMuted(m) { A.muted = !!m; },
    setVolume(v) { A.vol = Math.max(0, Math.min(1, v)); },
    get size() { return { W, H }; },
  };
})();
