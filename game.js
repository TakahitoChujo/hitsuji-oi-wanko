(() => {
  const cvs = document.getElementById('cvs');
  const ctx = cvs.getContext('2d');
  const stage = document.getElementById('stage');
  const $count = document.getElementById('count');
  const $time = document.getElementById('time');
  const $goal = document.getElementById('goal');
  const titleOv = document.getElementById('titleOv');
  const winOv = document.getElementById('winOv');
  const gateBtns = [...document.querySelectorAll('.gateBtn')];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const N_SHEEP = 12, SHEEP_R = 11, DOG_R = 12;
  const FLEE_R = 150, BARK_R = 230, EYE_R = 210, GATE_REACH = 95;
  let W = 960, H = 600, scale = 1, ox = 0, oy = 0, dpr = 1;
  let pen, fences, trees, grass;
  let sheep = [], dog, rings = [], parts = [], pops = [];
  let phase = 'title', elapsed = 0, barkCd = 0, t = 0, winDelay = 0, shake = 0;
  let gateClosed = false, gateAnim = 0, nearGate = false;
  let pointer = null;               // mouse steering target (world)
  let joy = null;                   // touch joystick {id, sx, sy, x, y} (client px)
  let downHeld = false, mouseHeld = false;
  const keys = {};
  let best = null, muted = false;

  try { const b = parseFloat(localStorage.getItem('hitsuji-best')); if (b > 0) best = b; } catch (e) {}
  try { muted = localStorage.getItem('hitsuji-muted') === '1'; } catch (e) {}

  // ---------- world ----------
  function buildWorld() {
    const portrait = stage.clientHeight > stage.clientWidth * 1.1;
    W = portrait ? 600 : 960;
    H = portrait ? 900 : 600;
    const pw = 210, ph = 180, px = W - pw - 30, py = 30, gap = 92;
    const gTop = py + (ph - gap) / 2, gBot = gTop + gap;
    pen = { x: px, y: py, w: pw, h: ph, gTop, gBot, gap };
    fences = [
      [px, py, px + pw, py], [px + pw, py, px + pw, py + ph], [px, py + ph, px + pw, py + ph],
      [px, py, px, gTop], [px, gBot, px, py + ph],
    ];
    trees = portrait
      ? [{ x: 200, y: 330, r: 34 }, { x: 430, y: 520, r: 30 }, { x: 150, y: 640, r: 26, rock: true }, { x: 470, y: 330, r: 22, rock: true }]
      : [{ x: 430, y: 220, r: 34 }, { x: 300, y: 450, r: 30 }, { x: 650, y: 430, r: 26, rock: true }, { x: 560, y: 120, r: 22, rock: true }];
    renderGrass();
  }

  // gate swings from pointing outward (open, lies along the outside like a wing) to closing the opening
  function gateSeg() {
    const phi = (1 - gateAnim) * Math.PI / 2;
    const hx = pen.x, hy = pen.gTop;
    return [hx, hy, hx - Math.sin(phi) * pen.gap, hy + Math.cos(phi) * pen.gap];
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function inPen(o) { return o.x > pen.x + 2 && o.x < pen.x + pen.w && o.y > pen.y && o.y < pen.y + pen.h; }

  function resetGame() {
    buildWorld();
    sheep = [];
    const cx = W * 0.25, cy = H * 0.72;
    while (sheep.length < N_SHEEP) {
      const s = { x: cx + rand(-110, 110), y: cy + rand(-90, 90), vx: 0, vy: 0, ang: rand(0, 6.28), wa: rand(0, 6.28), fear: 0, inside: false, phase: rand(0, 6.28), alarm: 0, pitch: rand(.85, 1.2) };
      if (s.x < 30 || s.y > H - 30 || s.y < 30) continue;
      if (trees.some(tr => Math.hypot(s.x - tr.x, s.y - tr.y) < tr.r + 20)) continue;
      if (sheep.some(o => Math.hypot(s.x - o.x, s.y - o.y) < 26)) continue;
      sheep.push(s);
    }
    dog = { x: W * 0.55, y: H * 0.85, vx: 0, vy: 0, ang: -Math.PI / 2, down: false };
    pointer = null; joy = null;
    rings = []; parts = []; pops = [];
    elapsed = 0; barkCd = 0; winDelay = 0; shake = 0;
    gateClosed = false; gateAnim = 0;
    lastHud = ''; lastGoal = '';
    updateHud(0);
    resize();
  }

  function renderGrass() {
    grass = document.createElement('canvas');
    const k = 2;
    grass.width = W * k; grass.height = H * k;
    const g = grass.getContext('2d');
    g.scale(k, k);
    g.fillStyle = '#7fae5a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < W + H; i += 60) {
      g.fillStyle = 'rgba(255,255,255,0.035)';
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 30, 0); g.lineTo(i + 30 - H, H); g.lineTo(i - H, H); g.fill();
    }
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      g.strokeStyle = Math.random() < .5 ? 'rgba(52,80,36,.35)' : 'rgba(170,205,120,.35)';
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y - rand(3, 6)); g.stroke();
    }
    for (let i = 0; i < 70; i++) {
      g.fillStyle = Math.random() < .6 ? '#f2c230' : '#f6f4ee';
      g.beginPath(); g.arc(Math.random() * W, Math.random() * H, rand(1.4, 2.4), 0, 6.28); g.fill();
    }
    g.fillStyle = '#d8c487';
    g.fillRect(pen.x, pen.y, pen.w, pen.h);
    for (let i = 0; i < 260; i++) {
      const x = pen.x + Math.random() * pen.w, y = pen.y + Math.random() * pen.h, a = rand(0, 3.14);
      g.strokeStyle = Math.random() < .5 ? 'rgba(160,130,60,.5)' : 'rgba(250,235,180,.6)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); g.stroke();
    }
    g.fillStyle = 'rgba(140,110,60,.28)';
    g.beginPath(); g.ellipse(pen.x - 10, (pen.gTop + pen.gBot) / 2, 40, 50, 0, 0, 6.28); g.fill();
  }

  // ---------- physics helpers ----------
  function pushFromSegment(o, r, [x1, y1, x2, y2]) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let u = ((o.x - x1) * dx + (o.y - y1) * dy) / l2;
    u = Math.max(0, Math.min(1, u));
    const cx = x1 + u * dx, cy = y1 + u * dy;
    let ex = o.x - cx, ey = o.y - cy;
    const d = Math.hypot(ex, ey), min = r + 4;
    if (d < min) {
      if (d < 0.001) { ex = 0; ey = -1; } else { ex /= d; ey /= d; }
      o.x = cx + ex * min; o.y = cy + ey * min;
      const vn = o.vx * ex + o.vy * ey;
      if (vn < 0) { o.vx -= vn * ex; o.vy -= vn * ey; }
    }
  }
  function collide(o, r) {
    for (const tr of trees) {
      const dx = o.x - tr.x, dy = o.y - tr.y, d = Math.hypot(dx, dy) || 1, min = tr.r + r;
      if (d < min) { o.x = tr.x + dx / d * min; o.y = tr.y + dy / d * min; }
    }
    for (const f of fences) pushFromSegment(o, r, f);
    pushFromSegment(o, r, gateSeg());
    const m = 14 + r;
    if (o.x < m) { o.x = m; o.vx = Math.abs(o.vx) * .3; }
    if (o.x > W - m) { o.x = W - m; o.vx = -Math.abs(o.vx) * .3; }
    if (o.y < m) { o.y = m; o.vy = Math.abs(o.vy) * .3; }
    if (o.y > H - m) { o.y = H - m; o.vy = -Math.abs(o.vy) * .3; }
  }
  function turnToward(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * Math.min(1, k);
  }

  // ---------- actions ----------
  function bark() {
    if (phase !== 'play' || barkCd > 0) return;
    barkCd = 0.7;
    rings.push({ x: dog.x, y: dog.y, t: 0 });
    if (!reduceMotion) shake = 0.18;
    for (const s of sheep) {
      const dx = s.x - dog.x, dy = s.y - dog.y, d = Math.hypot(dx, dy) || 1;
      if (d < BARK_R) {
        const k = 1 - d / BARK_R;
        s.vx += dx / d * (90 + 220 * k);
        s.vy += dy / d * (90 + 220 * k);
        s.fear = 1; s.alarm = 0.7;
      }
    }
    sfx.bark();
  }

  function toggleGate() {
    if (phase !== 'play' || !nearGate) return;
    gateClosed = !gateClosed;
    sfx.clack();
  }

  // ---------- update ----------
  function update(dt) {
    t += dt;
    barkCd = Math.max(0, barkCd - dt);
    shake = Math.max(0, shake - dt);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < 0.6);
    for (const p of parts) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.g || 0) * dt; p.vx *= Math.pow(p.drag ?? 0.2, dt); if (!p.g) p.vy *= Math.pow(p.drag ?? 0.2, dt);
      p.rot = (p.rot || 0) + (p.spin || 0) * dt;
    }
    parts = parts.filter(p => p.life > 0);
    for (const p of pops) { p.life -= dt; p.y -= 30 * dt; }
    pops = pops.filter(p => p.life > 0);

    const gTarget = gateClosed ? 1 : 0;
    gateAnim += Math.sign(gTarget - gateAnim) * Math.min(Math.abs(gTarget - gateAnim), dt * 5);

    if (phase !== 'play') return;
    elapsed += dt;

    // dog
    dog.down = downHeld || mouseHeld || !!keys.Shift;
    const MAXD = dog.down ? 75 : 250;
    let kx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
    let ky = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
    let desX = 0, desY = 0;
    if (kx || ky) {
      const l = Math.hypot(kx, ky); desX = kx / l * MAXD; desY = ky / l * MAXD; pointer = null;
    } else if (joy) {
      const jx = joy.x - joy.sx, jy = joy.y - joy.sy, jl = Math.hypot(jx, jy);
      if (jl > 6) { const k = Math.min(1, jl / 60); desX = jx / jl * k * MAXD; desY = jy / jl * k * MAXD; }
    } else if (pointer) {
      const dx = pointer.x - dog.x, dy = pointer.y - dog.y, d = Math.hypot(dx, dy);
      if (d > 4) { const sp = Math.min(MAXD, d * 5); desX = dx / d * sp; desY = dy / d * sp; }
    }
    const lk = Math.min(1, dt * 10);
    dog.vx += (desX - dog.vx) * lk; dog.vy += (desY - dog.vy) * lk;
    dog.x += dog.vx * dt; dog.y += dog.vy * dt;
    collide(dog, DOG_R);
    const dsp = Math.hypot(dog.vx, dog.vy);
    if (dsp > 10) dog.ang = turnToward(dog.ang, Math.atan2(dog.vy, dog.vx), dt * 12);
    if (!dog.down && dsp > 180 && Math.random() < dt * 20) dust(dog.x, dog.y, 1);

    const gcx = pen.x - 20, gcy = (pen.gTop + pen.gBot) / 2;
    nearGate = Math.hypot(dog.x - gcx, dog.y - gcy) < GATE_REACH && dog.x < pen.x;

    // sheep
    const pcx = pen.x + pen.w / 2 + 20, pcy = pen.y + pen.h / 2;
    for (const s of sheep) {
      let fx = 0, fy = 0;
      const dx = s.x - dog.x, dy = s.y - dog.y, d = Math.hypot(dx, dy) || 1;
      let calmCap = Infinity;
      if (dog.down && d < EYE_R) {
        // the "eye": steady, calm pressure
        const k = 1 - d / EYE_R;
        fx += dx / d * (120 + 160 * k); fy += dy / d * (120 + 160 * k);
        s.fear = Math.max(0, s.fear - dt * 1.6);
        calmCap = 62;
      } else if (d < FLEE_R) {
        const k = 1 - d / FLEE_R;
        fx += dx / d * k * 900; fy += dy / d * k * 900;
        s.fear = Math.min(1, s.fear + k * dt * 4);
      }
      s.fear = Math.max(0, s.fear - dt * 0.45);
      s.alarm = Math.max(0, s.alarm - dt);

      let cx = 0, cy = 0, ax = 0, ay = 0, n = 0;
      for (const o of sheep) {
        if (o === s) continue;
        const ex = o.x - s.x, ey = o.y - s.y, dd = Math.hypot(ex, ey) || 1;
        if (dd < 25) { fx -= ex / dd * (25 - dd) * 40; fy -= ey / dd * (25 - dd) * 40; }
        if (dd < 95 && o.inside === s.inside) { cx += o.x; cy += o.y; ax += o.vx; ay += o.vy; n++; }
      }
      if (n) {
        const coh = 0.5 + s.fear * 1.6;
        fx += (cx / n - s.x) * coh; fy += (cy / n - s.y) * coh;
        fx += (ax / n - s.vx) * s.fear * 1.5; fy += (ay / n - s.vy) * s.fear * 1.5;
      }
      s.wa += rand(-1, 1) * dt * 3;
      const wander = s.fear > .3 ? 10 : 28;
      fx += Math.cos(s.wa) * wander; fy += Math.sin(s.wa) * wander;
      if (s.inside && s.fear < .4) { fx += (pcx - s.x) * 0.35; fy += (pcy - s.y) * 0.35; }
      for (const tr of trees) {
        const ex = s.x - tr.x, ey = s.y - tr.y, dd = Math.hypot(ex, ey) || 1, rr = tr.r + SHEEP_R + 26;
        if (dd < rr) { fx += ex / dd * (rr - dd) * 12; fy += ey / dd * (rr - dd) * 12; }
      }
      // shy away from the outer fence so sheep don't wedge into corners the dog can't get behind
      const wm = 64;
      if (s.x < wm) fx += (wm - s.x) * 9;
      if (s.x > W - wm) fx -= (s.x - (W - wm)) * 9;
      if (s.y < wm) fy += (wm - s.y) * 9;
      if (s.y > H - wm) fy -= (s.y - (H - wm)) * 9;

      s.vx += fx * dt; s.vy += fy * dt;
      const fr = Math.pow(0.25, dt);
      s.vx *= fr; s.vy *= fr;
      const max = Math.min(calmCap, (s.inside ? 30 : 38) + s.fear * 145);
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      collide(s, SHEEP_R);
      if (sp > 6) s.ang = turnToward(s.ang, Math.atan2(s.vy, s.vx), dt * 6);
      if (sp > 120 && Math.random() < dt * 8) dust(s.x, s.y, 1);

      const now = inPen(s);
      if (now !== s.inside) {
        s.inside = now;
        if (now) {
          pops.push({ x: s.x, y: s.y - 18, text: '+1', color: '#f2c230', life: .9 });
          sparkle(s.x, s.y);
          sfx.baa(s.pitch);
        } else {
          pops.push({ x: s.x, y: s.y - 18, text: '脱走！', color: '#e04a2f', life: 1.1 });
          sfx.baa(s.pitch * 1.25);
        }
      }
    }

    const inside = sheep.filter(s => s.inside).length;
    updateHud(inside);
    for (const b of gateBtns) {
      b.disabled = !nearGate;
      const label = (gateClosed ? 'ゲートを開ける' : 'ゲートを閉める') + (b.classList.contains('desk') ? '(E)' : '');
      if (b.textContent !== label) b.textContent = label;
    }
    updateGoal(inside);

    if (gateClosed && gateAnim >= 1 && inside === N_SHEEP) {
      winDelay += dt;
      if (winDelay > 0.45) win();
    } else winDelay = 0;
  }

  function dust(x, y, n) {
    for (let i = 0; i < n; i++)
      parts.push({ kind: 'dust', x: x + rand(-4, 4), y: y + rand(2, 8), vx: rand(-20, 20), vy: rand(-20, 5), life: .5, max: .5, r: rand(3, 6) });
  }
  function sparkle(x, y) {
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * 6.28;
      parts.push({ kind: 'star', x, y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: .55, max: .55, r: 3 });
    }
  }
  function confetti() {
    const cols = ['#f2c230', '#f6f4ee', '#e04a2f', '#7fc4e8', '#c8783a'];
    for (let i = 0; i < 120; i++)
      parts.push({ kind: 'conf', x: rand(0, W), y: rand(-80, -10), vx: rand(-40, 40), vy: rand(40, 140), g: 60, drag: 0.6, life: rand(2.5, 4), max: 4, r: rand(4, 7), c: cols[i % cols.length], rot: rand(0, 6), spin: rand(-8, 8) });
  }

  function fmt(sec) {
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  let lastHud = '', lastGoal = '';
  function updateHud(inside) {
    const txt = inside + '|' + fmt(elapsed);
    if (txt === lastHud) return;
    lastHud = txt;
    $count.textContent = inside + ' / ' + N_SHEEP;
    $time.textContent = fmt(elapsed);
  }
  function updateGoal(inside) {
    let text, hot = false;
    const touch = matchMedia('(pointer: coarse)').matches;
    if (inside === N_SHEEP && !gateClosed) {
      hot = true;
      text = nearGate ? (touch ? 'いまだ！ゲートボタン' : 'いまだ！Eキーでゲートを閉める') : '全部入った！入口へ走ってゲートを閉めよう';
    } else if (gateClosed && inside < N_SHEEP) {
      text = 'ゲートが閉まってるよ。開けて残りを入れよう';
    } else if (elapsed < 6) {
      text = '羊のうしろに回り込んで、右上の小屋へ押していこう';
    } else if (inside >= 8) {
      text = 'あと' + (N_SHEEP - inside) + '頭！ふせでそっと押すと逃げにくい';
    } else {
      text = '';
    }
    const key = text + hot;
    if (key === lastGoal) return;
    lastGoal = key;
    $goal.hidden = !text;
    $goal.textContent = text;
    $goal.classList.toggle('hot', hot);
  }

  function win() {
    phase = 'win';
    if (best == null || elapsed < best) {
      best = elapsed;
      try { localStorage.setItem('hitsuji-best', String(best)); } catch (e) {}
    }
    document.getElementById('winTime').textContent = fmt(elapsed);
    document.getElementById('bestTime').textContent = fmt(best);
    document.getElementById('rank').textContent =
      elapsed < 50 ? 'チャンピオン牧羊犬' : elapsed < 90 ? '一人前の牧羊犬' : '見習いワンコ';
    $goal.hidden = true;
    for (const b of gateBtns) b.disabled = true;
    if (!reduceMotion) confetti();
    sfx.fanfare();
    setTimeout(() => {
      if (phase !== 'win') return;
      winOv.hidden = false;
      document.getElementById('againBtn').focus();
    }, 1100);
  }

  // ---------- draw ----------
  function draw() {
    const cw = cvs.width, ch = cvs.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5d8a3e';
    ctx.fillRect(0, 0, cw, ch);
    const sx = shake > 0 ? rand(-3, 3) * shake / .18 : 0, sy = shake > 0 ? rand(-3, 3) * shake / .18 : 0;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sx), dpr * (oy + sy));
    ctx.drawImage(grass, 0, 0, W, H);

    drawFenceLine(8, 8, W - 8, 8, 40); drawFenceLine(W - 8, 8, W - 8, H - 8, 40);
    drawFenceLine(W - 8, H - 8, 8, H - 8, 40); drawFenceLine(8, H - 8, 8, 8, 40);

    ctx.fillStyle = 'rgba(36,51,31,.55)';
    ctx.font = '700 15px "M PLUS Rounded 1c", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ひつじ小屋', pen.x + pen.w / 2, pen.y + pen.h - 14);

    // gate reach hint
    if (phase === 'play') {
      const gcx = pen.x - 20, gcy = (pen.gTop + pen.gBot) / 2;
      ctx.strokeStyle = nearGate ? 'rgba(242,194,48,.9)' : 'rgba(246,244,238,.28)';
      ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gcx, gcy, GATE_REACH - 10, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const p of parts) if (p.kind === 'dust') {
      ctx.fillStyle = 'rgba(205,190,150,' + (0.45 * p.life / p.max) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - p.life / p.max), 0, 6.28); ctx.fill();
    }

    const items = [];
    for (const s of sheep) items.push({ y: s.y, f: () => drawSheep(s) });
    items.push({ y: dog.y, f: drawDog });
    for (const tr of trees) items.push({ y: tr.y + 6, f: () => drawTree(tr) });
    items.sort((a, b) => a.y - b.y);

    for (const f of fences) drawFenceLine(...f, 30);
    drawGate();
    for (const it of items) it.f();

    if (dog.down && phase === 'play') {
      ctx.strokeStyle = 'rgba(242,194,48,.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(dog.x, dog.y, EYE_R, dog.ang - .7, dog.ang + .7); ctx.stroke();
    }

    for (const r of rings) {
      const k = r.t / 0.6;
      ctx.strokeStyle = 'rgba(246,244,238,' + (0.7 * (1 - k)) + ')';
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, 20 + k * (BARK_R - 20), 0, 6.28); ctx.stroke();
    }
    ctx.textAlign = 'center';
    if (rings.length) {
      const r = rings[rings.length - 1];
      if (r.t < 0.35) outlined('ワン！', dog.x, dog.y - 26 - r.t * 30, 22, '#f2c230');
    }
    for (const p of parts) {
      if (p.kind === 'star') {
        ctx.fillStyle = 'rgba(242,194,48,' + (p.life / p.max) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
      } else if (p.kind === 'conf') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, p.life);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      }
    }
    for (const p of pops) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      outlined(p.text, p.x, p.y, 17, p.color);
      ctx.globalAlpha = 1;
    }

    // touch joystick (screen space)
    if (joy) {
      const r = cvs.getBoundingClientRect();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bx = joy.sx - r.left, by = joy.sy - r.top;
      let jx = joy.x - joy.sx, jy = joy.y - joy.sy;
      const jl = Math.hypot(jx, jy); if (jl > 60) { jx *= 60 / jl; jy *= 60 / jl; }
      ctx.fillStyle = 'rgba(36,51,31,.25)'; ctx.strokeStyle = 'rgba(246,244,238,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, 60, 0, 6.28); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(246,244,238,.85)';
      ctx.beginPath(); ctx.arc(bx + jx, by + jy, 24, 0, 6.28); ctx.fill();
    }
  }

  function outlined(text, x, y, size, fill) {
    ctx.font = size + 'px "Dela Gothic One", sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = '#24331f'; ctx.fillStyle = fill;
    ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
  }

  function drawFenceLine(x1, y1, x2, y2, step) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    ctx.strokeStyle = '#6b4526'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = '#a8743f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x1, y1 - 1); ctx.lineTo(x2, y2 - 1); ctx.stroke();
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i <= n; i++) {
      const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
      ctx.fillStyle = '#5a3a20'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#b8844d'; ctx.beginPath(); ctx.arc(x - 1, y - 1, 3, 0, 6.28); ctx.fill();
    }
  }

  function drawGate() {
    const [x1, y1, x2, y2] = gateSeg();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#7a4d26'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = '#d9a35c'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.fillStyle = '#5a3a20';
    ctx.beginPath(); ctx.arc(x1, y1, 7, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.arc(pen.x, pen.gBot, 7, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#f2c230';
    ctx.beginPath(); ctx.arc(x2, y2, 4, 0, 6.28); ctx.fill();
  }

  function drawTree(tr) {
    ctx.fillStyle = 'rgba(30,45,20,.25)';
    ctx.beginPath(); ctx.ellipse(tr.x + 6, tr.y + 8, tr.r * 1.05, tr.r * .8, 0, 0, 6.28); ctx.fill();
    if (tr.rock) {
      ctx.fillStyle = '#8a8d80'; ctx.beginPath(); ctx.ellipse(tr.x, tr.y, tr.r, tr.r * .85, .3, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#a9ab9e'; ctx.beginPath(); ctx.ellipse(tr.x - tr.r * .25, tr.y - tr.r * .25, tr.r * .55, tr.r * .4, .3, 0, 6.28); ctx.fill();
      return;
    }
    const blobs = [[0, 0, 1], [-.45, -.3, .65], [.45, -.25, .6], [.1, .4, .6], [-.35, .35, .5]];
    ctx.fillStyle = '#3f6b2c';
    for (const [bx, by, br] of blobs) { ctx.beginPath(); ctx.arc(tr.x + bx * tr.r, tr.y + by * tr.r, br * tr.r, 0, 6.28); ctx.fill(); }
    ctx.fillStyle = '#558a3a';
    for (const [bx, by, br] of blobs) { ctx.beginPath(); ctx.arc(tr.x + bx * tr.r - 4, tr.y + by * tr.r - 5, br * tr.r * .6, 0, 6.28); ctx.fill(); }
  }

  function drawSheep(s) {
    const r = SHEEP_R;
    const sp = Math.hypot(s.vx, s.vy);
    const bob = reduceMotion ? 0 : Math.sin(t * 16 + s.phase) * Math.min(1, sp / 80) * 1.5;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = 'rgba(30,45,20,.22)';
    ctx.beginPath(); ctx.ellipse(2, 5, r * 1.25, r * .85, 0, 0, 6.28); ctx.fill();
    ctx.translate(0, bob);
    ctx.rotate(s.ang);
    ctx.fillStyle = '#3a3530';
    ctx.beginPath(); ctx.ellipse(r * .2, -6, 3, 4.5, -.5, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * .2, 6, 3, 4.5, .5, 0, 6.28); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 1.05, 0, 6, 4.8, 0, 0, 6.28); ctx.fill();
    const puffs = [[-7, -4, .6], [-7, 4, .6], [-3, 0, .85], [3, -4, .7], [3, 4, .7]];
    ctx.fillStyle = '#d9d4c6';
    for (const [px, py, pr] of puffs) { ctx.beginPath(); ctx.arc(px + .8, py + .8, pr * r, 0, 6.28); ctx.fill(); }
    ctx.fillStyle = s.inside ? '#fffdf6' : '#f6f4ee';
    for (const [px, py, pr] of puffs) { ctx.beginPath(); ctx.arc(px, py, pr * r - .6, 0, 6.28); ctx.fill(); }
    ctx.restore();
    if (s.alarm > 0) {
      ctx.font = '16px "Dela Gothic One", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e04a2f';
      ctx.fillText('!', s.x, s.y - 16 - (0.7 - s.alarm) * 12);
    }
  }

  function drawDog() {
    const d = dog;
    const sp = Math.hypot(d.vx, d.vy);
    const gait = reduceMotion ? 0 : Math.sin(t * (d.down ? 10 : 22)) * Math.min(1, sp / 120);
    const low = d.down ? 0.82 : 1;
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(30,45,20,.25)';
    ctx.beginPath(); ctx.ellipse(2, d.down ? 3 : 6, 18, 10, d.ang, 0, 6.28); ctx.fill();
    ctx.rotate(d.ang);
    ctx.scale(d.down ? 1.08 : 1, low);
    ctx.fillStyle = '#9c5726';
    for (const [lx, ly, ph] of [[8, -7, 1], [8, 7, -1], [-8, -7, -1], [-8, 7, 1]]) {
      ctx.beginPath(); ctx.ellipse(lx + gait * 3 * ph, ly * (d.down ? 1.25 : 1), 3.5, 2.6, 0, 0, 6.28); ctx.fill();
    }
    const wag = reduceMotion || d.down ? 0 : Math.sin(t * 18) * .5;
    ctx.save(); ctx.translate(-14, 0); ctx.rotate(wag);
    ctx.strokeStyle = '#c8783a'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-4, 0, 4, -1.2, 3.6); ctx.stroke();
    ctx.strokeStyle = '#f3e3cc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-4, 0, 4, 0.5, 2.6); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#c8783a';
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 8.5, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#d98e4f';
    ctx.beginPath(); ctx.ellipse(-1, -1.5, 9, 4, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#c8783a';
    ctx.beginPath(); ctx.arc(13, 0, 7.5, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#a8602b';
    ctx.beginPath(); ctx.moveTo(9, -5); ctx.lineTo(13, -11); ctx.lineTo(15, -5); ctx.fill();
    ctx.beginPath(); ctx.moveTo(9, 5); ctx.lineTo(13, 11); ctx.lineTo(15, 5); ctx.fill();
    ctx.fillStyle = '#f3e3cc';
    ctx.beginPath(); ctx.ellipse(18.5, 0, 4.2, 3.6, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#2b2522';
    ctx.beginPath(); ctx.arc(22, 0, 1.8, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  // ---------- sound ----------
  let actx = null;
  function ac() {
    if (muted) return null;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tone({ type = 'sine', f0, f1 = f0, at = 0, dur = .12, vol = .2, lp = 0, vib = 0 }) {
    const a = ac(); if (!a) return;
    const now = a.currentTime + at;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f1, now + dur);
    let node = o;
    if (lp) { const fl = a.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
    if (vib) {
      const l = a.createOscillator(), lg = a.createGain();
      l.frequency.value = vib; lg.gain.value = f0 * .06;
      l.connect(lg); lg.connect(o.frequency); l.start(now); l.stop(now + dur + .02);
    }
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + Math.min(.03, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    node.connect(g); g.connect(a.destination);
    o.start(now); o.stop(now + dur + .02);
  }
  const sfx = {
    bark() {
      tone({ type: 'sawtooth', f0: 520, f1: 230, dur: .12, vol: .25, lp: 1400 });
      tone({ type: 'sawtooth', f0: 600, f1: 270, at: .13, dur: .12, vol: .22, lp: 1400 });
    },
    baa(p = 1) { tone({ type: 'triangle', f0: 330 * p, f1: 290 * p, dur: .45, vol: .14, lp: 1800, vib: 8 }); },
    clack() {
      tone({ type: 'square', f0: 180, f1: 90, dur: .07, vol: .18, lp: 900 });
      tone({ type: 'square', f0: 140, f1: 70, at: .06, dur: .06, vol: .12, lp: 700 });
    },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, at: i * .12, dur: i === 3 ? .5 : .14, vol: .18 }));
    },
  };
  const muteBtn = document.getElementById('muteBtn');
  function renderMute() { muteBtn.textContent = muted ? '音 OFF' : '音 ON'; muteBtn.setAttribute('aria-pressed', String(muted)); }
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('hitsuji-muted', muted ? '1' : '0'); } catch (e) {}
    renderMute();
  });
  renderMute();

  // ---------- input ----------
  function toWorld(e) {
    const r = cvs.getBoundingClientRect();
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  }
  cvs.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') pointer = toWorld(e);
    else if (joy && e.pointerId === joy.id) { joy.x = e.clientX; joy.y = e.clientY; }
  });
  cvs.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') {
      pointer = toWorld(e);
      if (e.button === 2) bark(); else if (e.button === 0) mouseHeld = true;
      return;
    }
    if (joy) return;
    joy = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY };
    cvs.setPointerCapture(e.pointerId);
  });
  const endJoy = e => {
    if (e.pointerType === 'mouse' && e.button === 0) mouseHeld = false;
    if (joy && e.pointerId === joy.id) joy = null;
  };
  cvs.addEventListener('pointerup', endJoy);
  cvs.addEventListener('pointercancel', endJoy);
  cvs.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { pointer = null; mouseHeld = false; } });
  cvs.addEventListener('contextmenu', e => e.preventDefault());

  addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ') { e.preventDefault(); if (phase === 'play') bark(); return; }
    if (k === 'e') { toggleGate(); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    keys[k] = true;
  });
  addEventListener('keyup', e => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; downHeld = false; mouseHeld = false; });

  const downBtn = document.getElementById('downBtn');
  const setDown = v => { downHeld = v; downBtn.classList.toggle('held', v); };
  downBtn.addEventListener('pointerdown', e => { e.preventDefault(); setDown(true); downBtn.setPointerCapture(e.pointerId); });
  downBtn.addEventListener('pointerup', () => setDown(false));
  downBtn.addEventListener('pointercancel', () => setDown(false));
  downBtn.addEventListener('contextmenu', e => e.preventDefault());
  const barkBtn = document.getElementById('barkBtn');
  barkBtn.addEventListener('pointerdown', e => { e.preventDefault(); bark(); });
  barkBtn.addEventListener('keydown', e => { if (e.key === 'Enter') bark(); });
  for (const b of gateBtns) b.addEventListener('click', toggleGate);

  function start() {
    resetGame();
    phase = 'play';
    titleOv.hidden = true; winOv.hidden = true;
    ac();
  }
  document.getElementById('startBtn').addEventListener('click', start);
  document.getElementById('againBtn').addEventListener('click', start);
  document.getElementById('restartBtn').addEventListener('click', () => { if (phase === 'title') return; start(); });

  // ---------- loop ----------
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = stage.clientWidth, ch = stage.clientHeight;
    cvs.width = Math.round(cw * dpr); cvs.height = Math.round(ch * dpr);
    // keep the thumb pad off the field: reserve a strip below (portrait) or to the right (landscape)
    let aw = cw, ah = ch;
    if (matchMedia('(pointer: coarse)').matches) { if (cw >= ch) aw = cw - 112; else ah = ch - 108; }
    scale = Math.min(aw / W, ah / H);
    ox = (aw - W * scale) / 2; oy = (ah - H * scale) / 2;
  }
  addEventListener('resize', resize);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function boot(data) {
    if (data && data.best > 0 && (best == null || data.best < best)) best = data.best;
    resetGame();
    requestAnimationFrame(frame);
  }
  boot({});
})();
