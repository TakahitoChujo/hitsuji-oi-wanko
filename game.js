(() => {
  const cvs = document.getElementById('cvs');
  const ctx = cvs.getContext('2d');
  const stage = document.getElementById('stage');
  const $count = document.getElementById('count');
  const $time = document.getElementById('time');
  const $goal = document.getElementById('goal');
  const titleOv = document.getElementById('titleOv');
  const stageOv = document.getElementById('stageOv');
  const winOv = document.getElementById('winOv');
  const shareOv = document.getElementById('shareOv');
  const pauseOv = document.getElementById('pauseOv');
  const pauseBtn = document.getElementById('pauseBtn');
  const gateBtns = [...document.querySelectorAll('.gateBtn')];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SITE = 'https://takahitochujo.github.io/hitsuji-oi-wanko/';

  const DOG_R = 12;
  // touch stick: full speed at JOY_FULL px of thumb travel; past JOY_R the base trails the thumb
  const JOY_R = 50, JOY_FULL = 40;
  const MSG_H = 54;   // px band above the field for the message banner (two lines at most)
  const FLEE_R = 150, BARK_R = 230, EYE_R = 210, GATE_REACH = 95;
  let W = 960, H = 600, scale = 1, ox = 0, oy = 0, dpr = 1;
  let pen, fences, trees, walls, muds, bridge, grass;
  let sheep = [], dog, rings = [], parts = [], pops = [];
  let phase = 'title', elapsed = 0, barkCd = 0, t = 0, winDelay = 0, shake = 0;
  let gateClosed = false, gateAnim = 0, nearGate = false;
  let pointer = null;               // mouse steering target (world)
  let joy = null;                   // touch joystick {id, sx, sy, x, y} (client px)
  let downHeld = false, mouseHeld = false;
  const keys = {};
  let muted = false;

  try { muted = localStorage.getItem('hitsuji-muted') === '1'; } catch (e) {}
  try { localStorage.removeItem('hitsuji-best'); } catch (e) {}   // pre-v0.4 single best time, replaced by per-stage progress

  // iPhone mutes web audio when the silent switch is on; say so where sound is mentioned
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) for (const el of document.querySelectorAll('.ios-only')) el.hidden = false;

  // In-app browsers close on a downward swipe and keep their own bars on screen. LINE opens the page in the
  // phone's real browser when the URL carries openExternalBrowser=1, so offer exactly that.
  const inApp = / Line\//i.test(navigator.userAgent) ? 'line' : /Instagram|FBAN|FBAV/i.test(navigator.userAgent) ? 'other' : null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const withExternal = url => { const u = new URL(url); u.hash = ''; u.searchParams.set('openExternalBrowser', '1'); return u.toString(); };
  if (inApp) {
    document.getElementById('inAppNotice').hidden = false;
    const open = document.getElementById('openBrowser');
    if (inApp === 'line') open.href = withExternal(location.href);
    else { open.hidden = true; document.getElementById('inAppHow').textContent = '右上のメニュー（…）から「ブラウザで開く」を選んでください。'; }
  } else if (!standalone && matchMedia('(pointer: coarse)').matches) {
    // on a phone browser, the home-screen version runs full screen with no browser bars to hit by accident
    document.getElementById(isIOS ? 'homeTipIOS' : 'homeTipAndroid').hidden = false;
  }

  // ---------- stages ----------
  // sheep personalities: how hard they flee, how fast they panic, how fast they can run
  const TYPES = {
    normal:   { r: 11,   flee: 1,   fearGain: 1,   speed: 1 },
    black:    { r: 12,   flee: .38, fearGain: .45, speed: .85 },  // stubborn: barely moves for a walking dog
    lamb:     { r: 8,    flee: 1,   fearGain: 1.2, speed: 1.05 }, // sticks to its mother
    leader:   { r: 12,   flee: 1,   fearGain: .8,  speed: 1 },    // wears a bell; the flock follows it
    skittish: { r: 10.5, flee: 1.4, fearGain: 2.6, speed: 1.25 }, // panics and bolts away from the flock
  };
  // positions are fractions of the field (u = x / W, v = y / H) so one layout fits landscape and portrait.
  // Stars: ★1 clear, +1 for finishing within par seconds, +1 for the stage's mission. Par is roughly 4x the
  // best time of a herding bot; provisional until real playtests. Missions reward a technique (eye, sparing
  // barks, using the leader) without ever being required to progress.
  const STAGES = [
    // the first stage is a short, sure win: a small, tight flock already halfway to the pen and nothing in the way
    { name: 'はじめての牧場', flock: { normal: 5 }, par: 45, spawn: [.4, .58], spread: 40,
      trees: [[.15, .3, 30], [.75, .8, 26, 1]],
      mission: { text: 'ワン！を使わずにクリア', ok: r => r.barks === 0 },
      hint: 'まずは5頭。羊のうしろに回り込んで、右上の小屋へ押していこう' },
    { name: '木立の牧場', flock: { normal: 10, leader: 1 }, par: 90,
      trees: [[.45, .37, 34], [.31, .75, 30], [.68, .72, 26, 1], [.58, .2, 22, 1]],
      mission: { text: 'リーダー羊を一番最初に小屋に入れる', ok: r => r.firstIn === 'leader' },
      hint: 'ベルをつけたリーダー羊に、みんながついていくよ' },
    { name: 'ぬかるみ', flock: { normal: 8, black: 2 }, par: 110,
      trees: [[.5, .3, 28], [.2, .4, 24, 1]],
      mud: [[.42, .62, 120, 70], [.7, .5, 80, 110]],
      mission: { text: 'ワン！3回以内でクリア', ok: r => r.barks <= 3 },
      hint: 'ぬかるみでは足が遅くなる。頑固な黒羊は、ワン！で動かそう' },
    { name: '川と橋', flock: { normal: 8, lamb: 2 }, par: 130,
      trees: [[.3, .35, 28], [.18, .58, 22, 1]],
      river: true,
      // 8: a deliberate, mostly lying-down approach gets 5-10 panics in bot runs; 3 was out of reach
      mission: { text: '羊のパニック8回以内でクリア', ok: r => r.panics <= 8 },
      hint: '橋をわたらせよう。子羊はお母さんについていくよ' },
    { name: '夕暮れの大放牧', flock: { normal: 9, leader: 1, black: 2, lamb: 2, skittish: 2 }, par: 190,
      trees: [[.45, .3, 30], [.3, .8, 28], [.64, .7, 24, 1]],
      mud: [[.5, .55, 90, 60]], dusk: true,
      mission: { text: '臆病な羊を一度もパニックにさせずにクリア', ok: r => r.skittishPanics === 0 },
      hint: '全員集合！臆病な羊はすぐ逃げるから、ふせでそっと押そう' },
  ];
  const RANKS = { 1: '見習いワンコ', 2: '一人前の牧羊犬', 3: 'チャンピオン牧羊犬' };
  let stageIdx = 0, ST = STAGES[0];

  // per-stage progress: best time, and whether par time / the mission has ever been achieved
  function loadProgress() {
    const out = { v: 2, best: {}, time: {}, mission: {}, cleared: {}, notice: false };
    try {
      const p = JSON.parse(localStorage.getItem('hitsuji-progress'));
      if (!p || typeof p !== 'object') return out;
      STAGES.forEach((_, i) => {
        const b = Number(p.best && p.best[i]);
        if (b > 0) out.best[i] = b;
        if (p.v === 2) {
          if (p.cleared && p.cleared[i] === true) out.cleared[i] = true;
          if (p.time && p.time[i] === true) out.time[i] = true;
          if (p.mission && p.mission[i] === true) out.mission[i] = true;
        } else {
          // v0.4-0.5 kept 1-3 time-based stars. ★2 and the old gold ★3 both mean "made par"; the mission is new.
          const s = Number(p.stars && p.stars[i]);
          if (s >= 1) out.cleared[i] = true;
          if (s >= 2) out.time[i] = true;
          if (s >= 3) out.notice = true;   // their ★3 drops to ★2: explain once on the stage list
        }
      });
      if (p.v === 2 && p.notice === true) out.notice = true;
      return out;
    } catch (e) { return out; }
  }
  let progress = loadProgress();
  function saveProgress() { try { localStorage.setItem('hitsuji-progress', JSON.stringify(progress)); } catch (e) {} }
  const savedStars = i => (progress.cleared[i] ? 1 + (progress.time[i] ? 1 : 0) + (progress.mission[i] ? 1 : 0) : 0);
  const unlocked = i => i === 0 || !!progress.cleared[i - 1];
  const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);

  // what the player did this run, for the mission and for the "try lying down" tip
  let run;
  const newRun = () => ({ barks: 0, panics: 0, skittishPanics: 0, firstIn: null, usedDown: false, panicTimes: [], tipUntil: 0, tipShown: false });

  // ---------- world ----------
  function inBox(b, x, y, m = 0) { return x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m; }

  function buildWorld() {
    const portrait = stage.clientHeight > stage.clientWidth * 1.1;
    W = portrait ? 600 : 960;
    H = portrait ? 900 : 600;
    // the pen sits flush against the right fence: any strip left between them traps sheep the dog can't get behind
    const pw = 210, ph = 180, px = W - pw - 8, py = 30, gap = 92;
    const gTop = py + (ph - gap) / 2, gBot = gTop + gap;
    pen = { x: px, y: py, w: pw, h: ph, gTop, gBot, gap };
    fences = [
      [px, py, px + pw, py], [px + pw, py, px + pw, py + ph], [px, py + ph, px + pw, py + ph],
      [px, py, px, gTop], [px, gBot, px, py + ph],
    ];
    // the river runs between the flock and the pen, with one bridge
    walls = []; bridge = null;
    if (ST.river) {
      if (!portrait) {
        const x0 = W * .55, x1 = W * .62, g0 = H * .52, g1 = H * .74;
        walls = [{ x0, y0: 0, x1, y1: g0 }, { x0, y0: g1, x1, y1: H }];
        bridge = { x0, y0: g0, x1, y1: g1, across: 'x' };
      } else {
        const y0 = H * .4, y1 = H * .45, g0 = W * .12, g1 = W * .34;
        walls = [{ x0: 0, y0, x1: g0, y1 }, { x0: g1, y0, x1: W, y1 }];
        bridge = { x0: g0, y0, x1: g1, y1, across: 'y' };
      }
    }
    const penBox = { x0: pen.x - 60, y0: 0, x1: W, y1: pen.y + pen.h + 50 };
    const blocked = (x, y, m) => inBox(penBox, x, y, m) || walls.some(w => inBox(w, x, y, m));
    trees = ST.trees.map(([u, v, r, rock]) => ({ x: u * W, y: v * H, r, rock: !!rock })).filter(tr => !blocked(tr.x, tr.y, tr.r + 10));
    muds = (ST.mud || []).map(([u, v, rx, ry]) => ({ x: u * W, y: v * H, rx, ry })).filter(m => !blocked(m.x, m.y, 0));
    renderGrass();
  }

  // gate swings from open (angled up-left like a wing, its tip reaching the top fence) to closing the opening.
  // The open angle matters: pointing straight left left a pocket between the gate and the top fence where
  // sheep wedged in and the dog could never get behind them.
  function gateSeg() {
    const phi = (1 - gateAnim) * Math.PI * .75;
    const hx = pen.x, hy = pen.gTop;
    return [hx, hy, hx - Math.sin(phi) * pen.gap, hy + Math.cos(phi) * pen.gap];
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function inPen(o) { return o.x > pen.x + 2 && o.x < pen.x + pen.w && o.y > pen.y && o.y < pen.y + pen.h; }
  function inMud(o) { return muds.some(m => ((o.x - m.x) / m.rx) ** 2 + ((o.y - m.y) / m.ry) ** 2 < 1); }

  function makeSheep(type, x, y) {
    const T = TYPES[type];
    const pitch = type === 'lamb' ? rand(1.3, 1.5) : type === 'black' ? rand(.7, .82) : rand(.85, 1.2);
    return { type, T, r: T.r, x, y, vx: 0, vy: 0, ang: rand(0, 6.28), wa: rand(0, 6.28), fear: 0, inside: false,
      phase: rand(0, 6.28), alarm: 0, pitch, mother: null, child: null };
  }
  function spawnFlock() {
    sheep = [];
    const order = [];
    for (const [type, n] of Object.entries(ST.flock)) for (let i = 0; i < n; i++) order.push(type);
    order.sort((a, b) => (a === 'lamb') - (b === 'lamb'));   // lambs last, so each can stand by a mother
    const [su, sv] = ST.spawn || [.25, .72];
    const cx = W * su, cy = H * sv, spread = ST.spread || 90 + order.length * 6;
    const penBox = { x0: pen.x - 40, y0: 0, x1: W, y1: pen.y + pen.h + 30 };
    for (const type of order) {
      const r = TYPES[type].r;
      const mother = type === 'lamb' ? sheep.find(o => o.type === 'normal' && !o.child) : null;
      let s = null;
      for (let tries = 0; tries < 400 && !s; tries++) {
        const x = mother ? mother.x + rand(-30, 30) : cx + rand(-spread, spread);
        const y = mother ? mother.y + rand(-30, 30) : cy + rand(-spread * .8, spread * .8);
        if (x < 40 || x > W - 40 || y < 40 || y > H - 40) continue;
        if (inBox(penBox, x, y) || walls.some(w => inBox(w, x, y, r + 8))) continue;
        if (trees.some(tr => Math.hypot(x - tr.x, y - tr.y) < tr.r + r + 10)) continue;
        if (sheep.some(o => Math.hypot(x - o.x, y - o.y) < r + o.r + 5)) continue;
        s = makeSheep(type, x, y);
      }
      if (!s) s = makeSheep(type, cx + rand(-30, 30), cy + rand(-30, 30));
      if (mother) { s.mother = mother; mother.child = s; }
      sheep.push(s);
    }
  }

  function resetGame() {
    buildWorld();
    spawnFlock();
    dog = { x: W * .45, y: H * .88, vx: 0, vy: 0, ang: -Math.PI / 2, down: false };
    pointer = null; joy = null;
    rings = []; parts = []; pops = [];
    elapsed = 0; barkCd = 0; winDelay = 0; shake = 0;
    gateClosed = false; gateAnim = 0;
    run = newRun();
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
    for (const m of muds) {
      g.fillStyle = '#6e5233';
      g.beginPath(); g.ellipse(m.x, m.y, m.rx + 6, m.ry + 6, 0, 0, 6.28); g.fill();
      g.fillStyle = '#86653f';
      g.beginPath(); g.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, 6.28); g.fill();
      for (let i = 0; i < 18; i++) {
        const a = rand(0, 6.28), d = Math.sqrt(Math.random()) * .8;
        g.fillStyle = Math.random() < .5 ? 'rgba(60,42,24,.45)' : 'rgba(170,140,100,.35)';
        g.beginPath(); g.ellipse(m.x + Math.cos(a) * m.rx * d, m.y + Math.sin(a) * m.ry * d, rand(4, 10), rand(3, 6), a, 0, 6.28); g.fill();
      }
    }
    for (const w of walls) {
      g.fillStyle = '#4f8fc0'; g.fillRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
      g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 2;
      for (let i = 0; i < (w.x1 - w.x0) * (w.y1 - w.y0) / 900; i++) {
        const x = rand(w.x0 + 6, w.x1 - 14), y = rand(w.y0 + 4, w.y1 - 4);
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 4, y - 3, x + 8, y); g.stroke();
      }
      g.strokeStyle = '#5d7f3a'; g.lineWidth = 4; g.strokeRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
    }
    if (bridge) {
      const b = bridge;
      g.fillStyle = '#4f8fc0'; g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.fillStyle = '#b07a44'; g.fillRect(b.x0 - 4, b.y0, b.x1 - b.x0 + 8, b.y1 - b.y0);
      if (b.across === 'y') g.fillRect(b.x0, b.y0 - 4, b.x1 - b.x0, b.y1 - b.y0 + 8);
      g.strokeStyle = '#7a4d26'; g.lineWidth = 2;
      if (b.across === 'x') for (let x = b.x0; x <= b.x1; x += 10) { g.beginPath(); g.moveTo(x, b.y0); g.lineTo(x, b.y1); g.stroke(); }
      else for (let y = b.y0; y <= b.y1; y += 10) { g.beginPath(); g.moveTo(b.x0, y); g.lineTo(b.x1, y); g.stroke(); }
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
  function pushFromRect(o, r, w) {
    const cx = Math.max(w.x0, Math.min(w.x1, o.x)), cy = Math.max(w.y0, Math.min(w.y1, o.y));
    let ex = o.x - cx, ey = o.y - cy;
    const d = Math.hypot(ex, ey);
    if (d >= r) return;
    if (d < 0.001) {
      // centre is inside the water: leave through the nearest bank
      const [gap, nx, ny] = [[o.x - w.x0, -1, 0], [w.x1 - o.x, 1, 0], [o.y - w.y0, 0, -1], [w.y1 - o.y, 0, 1]].sort((a, b) => a[0] - b[0])[0];
      o.x += nx * (gap + r); o.y += ny * (gap + r);
      return;
    }
    ex /= d; ey /= d;
    o.x = cx + ex * r; o.y = cy + ey * r;
    const vn = o.vx * ex + o.vy * ey;
    if (vn < 0) { o.vx -= vn * ex; o.vy -= vn * ey; }
  }
  function collide(o, r) {
    for (const tr of trees) {
      const dx = o.x - tr.x, dy = o.y - tr.y, d = Math.hypot(dx, dy) || 1, min = tr.r + r;
      if (d < min) { o.x = tr.x + dx / d * min; o.y = tr.y + dy / d * min; }
    }
    for (const w of walls) pushFromRect(o, r, w);
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
  // same effect every time; only the voice and the word vary, so it stays one simple action
  const BARKS = [
    { text: 'ワン！', notes: [[520, 230, 0, .12]] },
    { text: 'ワンワン！', notes: [[520, 230, 0, .12], [600, 270, .13, .12]] },
    { text: 'ワォン！', notes: [[380, 620, 0, .1], [620, 420, .1, .16]] },
    { text: 'ワフッ！', notes: [[360, 190, 0, .08]] },
  ];
  let lastBark = -1;
  function bark() {
    if (phase !== 'play' || barkCd > 0) return;
    barkCd = 0.7;
    run.barks++;
    let v = Math.floor(Math.random() * (BARKS.length - 1));
    if (v >= lastBark) v++;   // never the same variant twice in a row
    if (lastBark < 0) v = 0;
    lastBark = v;
    rings.push({ x: dog.x, y: dog.y, t: 0, text: BARKS[v].text });
    if (!reduceMotion) shake = 0.18;
    for (const s of sheep) {
      const dx = s.x - dog.x, dy = s.y - dog.y, d = Math.hypot(dx, dy) || 1;
      if (d < BARK_R) {
        const k = 1 - d / BARK_R, push = (90 + 220 * k) * (s.type === 'black' ? 1.25 : 1);
        s.vx += dx / d * push;
        s.vy += dy / d * push;
        s.fear = s.type === 'black' ? .8 : 1; s.alarm = 0.7;
      }
    }
    sfx.bark(BARKS[v].notes, SIZES[look.size].pitch);
  }

  function toggleGate() {
    if (phase !== 'play' || !nearGate) return;
    gateClosed = !gateClosed;
    sfx.clack();
  }

  // ---------- update ----------
  function update(dt) {
    if (phase === 'paused') return; // freeze everything, effects included
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
    if (dog.down) run.usedDown = true;
    const MAXD = (dog.down ? 75 : 250) * (inMud(dog) ? .5 : 1);
    let kx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
    let ky = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
    let desX = 0, desY = 0;
    if (kx || ky) {
      const l = Math.hypot(kx, ky); desX = kx / l * MAXD; desY = ky / l * MAXD; pointer = null;
    } else if (joy) {
      const jx = joy.x - joy.sx, jy = joy.y - joy.sy, jl = Math.hypot(jx, jy);
      if (jl > 6) { const k = Math.min(1, jl / JOY_FULL); desX = jx / jl * k * MAXD; desY = jy / jl * k * MAXD; }
    } else if (pointer) {
      const dx = pointer.x - dog.x, dy = pointer.y - dog.y, d = Math.hypot(dx, dy);
      if (d > 4) { const sp = Math.min(MAXD, d * 5); desX = dx / d * sp; desY = dy / d * sp; }
    }
    const lk = Math.min(1, dt * 16);   // reaches full speed in ~0.15 s: quick to answer the thumb, still smooth
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
    const leader = sheep.find(s => s.type === 'leader');
    // a dog that walks up calmly moves sheep without panicking them; one that charges in scares them.
    // Sheep still step away either way: only how fast fear builds depends on the dog's speed.
    const charge = .3 + .7 * Math.min(1, Math.hypot(dog.vx, dog.vy) / 220);
    for (const s of sheep) {
      const T = s.T;
      let fx = 0, fy = 0;
      const dx = s.x - dog.x, dy = s.y - dog.y, d = Math.hypot(dx, dy) || 1;
      let calmCap = Infinity;
      if (dog.down && d < EYE_R) {
        // the "eye": steady, calm pressure
        const k = 1 - d / EYE_R, f = (120 + 160 * k) * (.5 + .5 * T.flee);
        fx += dx / d * f; fy += dy / d * f;
        s.fear = Math.max(0, s.fear - dt * 1.6);
        calmCap = 62 * T.speed;
      } else if (d < FLEE_R) {
        const k = 1 - d / FLEE_R;
        fx += dx / d * k * 900 * T.flee; fy += dy / d * k * 900 * T.flee;
        s.fear = Math.min(1, s.fear + k * dt * 4 * T.fearGain * charge);
      }
      s.fear = Math.max(0, s.fear - dt * 0.45);
      s.alarm = Math.max(0, s.alarm - dt);
      // a panic is fear reaching .9; the same sheep counts again only after it has calmed below .5
      if (s.fear >= .9 && !s.panicked) { s.panicked = true; onPanic(s); }
      else if (s.fear < .5) s.panicked = false;

      let cx = 0, cy = 0, ax = 0, ay = 0, n = 0;
      for (const o of sheep) {
        if (o === s) continue;
        const ex = o.x - s.x, ey = o.y - s.y, dd = Math.hypot(ex, ey) || 1, sep = s.r + o.r + 3;
        if (dd < sep) { fx -= ex / dd * (sep - dd) * 40; fy -= ey / dd * (sep - dd) * 40; }
        if (dd < 95 && o.inside === s.inside) { cx += o.x; cy += o.y; ax += o.vx; ay += o.vy; n++; }
      }
      let coh = 0.5 + s.fear * 1.6, align = s.fear * 1.5;
      if (s.type === 'leader') coh *= .3;                           // the leader leads, it doesn't follow
      if (s.type === 'skittish' && s.fear > .5) coh = align = 0;    // a panicking sheep bolts alone
      if (n) {
        fx += (cx / n - s.x) * coh; fy += (cy / n - s.y) * coh;
        fx += (ax / n - s.vx) * align; fy += (ay / n - s.vy) * align;
      }
      if (leader && s !== leader && leader.inside === s.inside) {
        const lx = leader.x - s.x, ly = leader.y - s.y, ld = Math.hypot(lx, ly);
        if (ld > 30 && ld < 220) { fx += lx / ld * 45 * (1 + s.fear); fy += ly / ld * 45 * (1 + s.fear); }
      }
      if (s.mother && s.mother.inside === s.inside) {
        const mx = s.mother.x - s.x, my = s.mother.y - s.y, md = Math.hypot(mx, my);
        if (md > 20) { const f = Math.min(220, md * 3); fx += mx / md * f; fy += my / md * f; }
      }
      s.wa += rand(-1, 1) * dt * (s.type === 'skittish' ? 7 : 3);
      const wander = s.fear > .3 ? 10 : 28;
      fx += Math.cos(s.wa) * wander; fy += Math.sin(s.wa) * wander;
      if (s.inside && s.fear < .4) { fx += (pcx - s.x) * 0.35; fy += (pcy - s.y) * 0.35; }
      for (const tr of trees) {
        const ex = s.x - tr.x, ey = s.y - tr.y, dd = Math.hypot(ex, ey) || 1, rr = tr.r + s.r + 26;
        if (dd < rr) { fx += ex / dd * (rr - dd) * 12; fy += ey / dd * (rr - dd) * 12; }
      }
      // outside sheep keep off the pen's outer walls too, so none ends up pinned along the bottom of the pen
      if (!s.inside && s.y > pen.y + pen.h && s.y < pen.y + pen.h + 50 && s.x > pen.x - 10) fy += (pen.y + pen.h + 50 - s.y) * 7;
      // and drift out of the pocket between the pen and the right fence, back toward the gate side
      if (!s.inside && s.y > pen.y + pen.h && s.y < pen.y + pen.h + 100 && s.x > pen.x) fx -= 90;
      for (const w of walls) {
        const qx = Math.max(w.x0, Math.min(w.x1, s.x)), qy = Math.max(w.y0, Math.min(w.y1, s.y));
        const ex = s.x - qx, ey = s.y - qy, dd = Math.hypot(ex, ey) || 1, rr = s.r + 24;
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
      const max = Math.min(calmCap, ((s.inside ? 30 : 38) + s.fear * 145) * T.speed) * (inMud(s) ? .45 : 1);
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      collide(s, s.r);
      if (sp > 6) s.ang = turnToward(s.ang, Math.atan2(s.vy, s.vx), dt * 6);
      if (sp > 120 && Math.random() < dt * 8) dust(s.x, s.y, 1);

      const now = inPen(s);
      if (now !== s.inside) {
        s.inside = now;
        if (now) {
          if (!run.firstIn) run.firstIn = s.type;
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

    if (gateClosed && gateAnim >= 1 && inside === sheep.length) {
      winDelay += dt;
      if (winDelay > 0.45) win();
    } else winDelay = 0;
  }

  function onPanic(s) {
    run.panics++;
    if (s.type === 'skittish') run.skittishPanics++;
    // a player who keeps panicking the flock and has never lain down gets one nudge toward the eye
    run.panicTimes = run.panicTimes.filter(at => at > elapsed - 8);
    run.panicTimes.push(elapsed);
    if (!run.usedDown && !run.tipShown && run.panicTimes.length >= 3) { run.tipShown = true; run.tipUntil = elapsed + 5; }
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
    const txt = inside + '/' + sheep.length + '|' + fmt(elapsed);
    if (txt === lastHud) return;
    lastHud = txt;
    $count.textContent = inside + ' / ' + sheep.length;
    $time.textContent = fmt(elapsed);
  }
  function updateGoal(inside) {
    let text, hot = false;
    const total = sheep.length, touch = matchMedia('(pointer: coarse)').matches;
    if (inside === total && !gateClosed) {
      hot = true;
      text = nearGate ? (touch ? 'いまだ！ゲートボタン' : 'いまだ！Eキーでゲートを閉める') : '全部入った！入口へ走ってゲートを閉めよう';
    } else if (gateClosed && inside < total) {
      text = 'ゲートが閉まってるよ。開けて残りを入れよう';
    } else if (orientationChanged()) {
      text = '画面の向きが変わったよ。一時停止→「最初からやり直す」で牧場が画面に合います';
    } else if (run.tipUntil > elapsed) {
      text = 'ふせ（' + (touch ? 'ふせボタン' : 'Shift か左クリック長押し') + '）でそっと押すと、羊が落ち着くよ';
    } else if (elapsed < 3) {
      text = 'ステージ' + (stageIdx + 1) + '「' + ST.name + '」';
    } else if (elapsed < 7) {
      text = 'お題：' + ST.mission.text;
    } else if (elapsed < 12) {
      text = ST.hint;
    } else if (inside > 0 && total - inside <= 3) {
      text = 'あと' + (total - inside) + '頭！ふせでそっと押すと逃げにくい';
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

  let lastResult = null, cardBlob = null, cardPromise = null;
  function win() {
    phase = 'win';
    renderPauseBtn();
    // stars for this run; the stage list keeps the best of every run (time and mission can come from different runs)
    const timeOk = elapsed <= ST.par, missionOk = ST.mission.ok(run);
    const stars = 1 + (timeOk ? 1 : 0) + (missionOk ? 1 : 0);
    const prevBest = progress.best[stageIdx];
    const newBest = !(prevBest > 0) || elapsed < prevBest;
    if (newBest) progress.best[stageIdx] = elapsed;
    progress.cleared[stageIdx] = true;
    if (timeOk) progress.time[stageIdx] = true;
    if (missionOk) progress.mission[stageIdx] = true;
    saveProgress();
    const rank = RANKS[stars];
    lastResult = { stage: stageIdx, time: elapsed, stars, rank, name: dogName };

    document.getElementById('winStage').textContent = 'ステージ' + (stageIdx + 1) + '「' + ST.name + '」';
    const $stars = document.getElementById('winStars');
    $stars.textContent = starText(stars);
    $stars.setAttribute('aria-label', '星' + stars + 'つ');
    document.getElementById('winTime').textContent = fmt(elapsed);
    document.getElementById('bestTime').textContent = fmt(progress.best[stageIdx]) + (newBest ? '（新記録！）' : '');
    // the only place a missed mission is mentioned: no mid-game "failed" message (design decision 2026-11-12)
    setCheck('checkTime', timeOk, '目標タイム ' + ST.par + '秒以内');
    setCheck('checkMission', missionOk, 'お題：' + ST.mission.text);
    document.getElementById('rank').textContent = dogName ? dogName + 'は' + rank + '！' : rank;
    const nextBtn = document.getElementById('nextBtn');
    nextBtn.hidden = stageIdx === STAGES.length - 1;
    document.getElementById('allClear').hidden = !nextBtn.hidden;
    $goal.hidden = true;
    for (const b of gateBtns) b.disabled = true;
    if (!reduceMotion) confetti();
    bgmStop();
    sfx.fanfare();
    rebuildCard();
    // the hook of the game: offer "play as your own dog" once the player has had fun, not on the title screen
    document.getElementById('invite').hidden = !!dogPhoto || !!loadProfile().inviteDone;
    setTimeout(() => {
      if (phase !== 'win') return;
      winOv.hidden = false;
      (nextBtn.hidden ? document.getElementById('shareBtn') : nextBtn).focus();
    }, 1100);
  }

  function setCheck(id, ok, label) {
    const el = document.getElementById(id);
    el.textContent = (ok ? '✓ ' : '− ') + label;
    el.classList.toggle('ok', ok);
    el.setAttribute('aria-label', label + (ok ? '：達成' : '：まだ'));
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
    if (bridge) {
      const b = bridge;
      if (b.across === 'x') { drawFenceLine(b.x0 - 4, b.y0, b.x1 + 4, b.y0, 20); drawFenceLine(b.x0 - 4, b.y1, b.x1 + 4, b.y1, 20); }
      else { drawFenceLine(b.x0, b.y0 - 4, b.x0, b.y1 + 4, 20); drawFenceLine(b.x1, b.y0 - 4, b.x1, b.y1 + 4, 20); }
    }

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
    if (dogName) {
      // name tag over the hero, kept readable on small screens
      ctx.textAlign = 'center';
      ctx.globalAlpha = .9;
      outlined(dogName, dog.x, dog.y - 22 - faceR() * .6, Math.min(22, Math.max(13, 12 / scale)), '#f6f4ee', '800 {s}px "M PLUS Rounded 1c", sans-serif');
      ctx.globalAlpha = 1;
    }

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
      if (r.t < 0.35) outlined(r.text, dog.x, dog.y - 26 - r.t * 30, 22, '#f2c230');
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
      outlined(p.text, p.x, p.y, 17, p.color, '800 {s}px "M PLUS Rounded 1c", sans-serif');
      ctx.globalAlpha = 1;
    }

    if (ST.dusk) {
      ctx.fillStyle = 'rgba(255,128,48,.14)'; ctx.fillRect(0, 0, W, H);
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75);
      vg.addColorStop(0, 'rgba(40,20,40,0)'); vg.addColorStop(1, 'rgba(40,20,40,.38)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }

    // touch joystick (screen space)
    if (joy) {
      const r = cvs.getBoundingClientRect();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bx = joy.sx - r.left, by = joy.sy - r.top;
      let jx = joy.x - joy.sx, jy = joy.y - joy.sy;
      const jl = Math.hypot(jx, jy); if (jl > JOY_R) { jx *= JOY_R / jl; jy *= JOY_R / jl; }
      ctx.fillStyle = 'rgba(36,51,31,.25)'; ctx.strokeStyle = 'rgba(246,244,238,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx, by, JOY_R, 0, 6.28); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(246,244,238,.85)';
      ctx.beginPath(); ctx.arc(bx + jx, by + jy, 24, 0, 6.28); ctx.fill();
    }
  }

  // face: the logo face suits short kana like ワン！; anything with arbitrary kanji (a dog's name) needs the body face
  function outlined(text, x, y, size, fill, font = '{s}px "Dela Gothic One", sans-serif') {
    ctx.font = font.replace('{s}', size);
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

  function drawSheep(s, g = ctx) {
    const r = s.r, k = r / 11;
    const sp = Math.hypot(s.vx, s.vy);
    const bob = reduceMotion ? 0 : Math.sin(t * 16 + s.phase) * Math.min(1, sp / 80) * 1.5;
    const shiver = s.type === 'skittish' && s.fear > .3 && !reduceMotion ? rand(-1.2, 1.2) : 0;
    const black = s.type === 'black';
    g.save();
    g.translate(s.x + shiver, s.y);
    g.fillStyle = 'rgba(30,45,20,.22)';
    g.beginPath(); g.ellipse(2, 5 * k, r * 1.25, r * .85, 0, 0, 6.28); g.fill();
    g.translate(0, bob);
    g.rotate(s.ang);
    g.fillStyle = black ? '#1c1917' : '#3a3530';
    g.beginPath(); g.ellipse(r * .2, -6 * k, 3 * k, 4.5 * k, -.5, 0, 6.28); g.fill();
    g.beginPath(); g.ellipse(r * .2, 6 * k, 3 * k, 4.5 * k, .5, 0, 6.28); g.fill();
    g.beginPath(); g.ellipse(r * 1.05, 0, 6 * k, 4.8 * k, 0, 0, 6.28); g.fill();
    const puffs = [[-7, -4, .6], [-7, 4, .6], [-3, 0, .85], [3, -4, .7], [3, 4, .7]];
    g.fillStyle = black ? '#2a2523' : '#d9d4c6';
    for (const [px, py, pr] of puffs) { g.beginPath(); g.arc(px * k + .8, py * k + .8, pr * r, 0, 6.28); g.fill(); }
    g.fillStyle = black ? '#4a4441' : s.type === 'skittish' ? '#f1ebe0' : s.inside ? '#fffdf6' : '#f6f4ee';
    for (const [px, py, pr] of puffs) { g.beginPath(); g.arc(px * k, py * k, pr * r - .6, 0, 6.28); g.fill(); }
    if (s.type === 'leader') {
      g.fillStyle = '#c0392b'; g.fillRect(r * .5, -r * .55, 2.4, r * 1.1);       // collar
      g.fillStyle = '#f2c230'; g.strokeStyle = '#7a5a10'; g.lineWidth = 1;
      g.beginPath(); g.arc(r * .62, 0, 3.4, 0, 6.28); g.fill(); g.stroke();  // bell
    }
    g.restore();
    if (s.alarm > 0) {
      g.font = '16px "Dela Gothic One", sans-serif';
      g.textAlign = 'center';
      g.fillStyle = '#e04a2f';
      g.fillText('!', s.x, s.y - 16 - (0.7 - s.alarm) * 12);
    }
  }

  function drawDog() {
    paintDog(ctx, dog, { look, coat, photo: dogPhoto, k: SIZES[look.size].k, headR: faceR(), time: t });
  }
  // The hero, seen from above, facing d.ang. Shared by the game, the うちの子メーカー preview and the share card.
  // o: { look, coat, photo (image or null), k (size scale), headR (photo head radius before k), time (seconds) }
  function paintDog(g, d, o) {
    const lk = o.look, c = o.coat, k = o.k;
    const sp = Math.hypot(d.vx, d.vy);
    const gait = reduceMotion ? 0 : Math.sin(o.time * (d.down ? 10 : 22)) * Math.min(1, sp / 120);
    g.save();
    g.translate(d.x, d.y);
    g.scale(k, k);
    g.fillStyle = 'rgba(30,45,20,.25)';
    g.beginPath(); g.ellipse(2, d.down ? 3 : 6, 18, 10, d.ang, 0, 6.28); g.fill();
    g.rotate(d.ang);
    g.scale(d.down ? 1.08 : 1, d.down ? .82 : 1);
    g.fillStyle = lk.pattern === 'socks' ? c.sub : c.dark;
    for (const [lx, ly, ph] of [[8, -7, 1], [8, 7, -1], [-8, -7, -1], [-8, 7, 1]]) {
      g.beginPath(); g.ellipse(lx + gait * 3 * ph, ly * (d.down ? 1.25 : 1), 3.5, 2.6, 0, 0, 6.28); g.fill();
    }
    const wag = reduceMotion || d.down ? 0 : Math.sin(o.time * 18) * .5;
    g.save(); g.translate(-14, 0); g.rotate(wag);
    g.strokeStyle = g.fillStyle = c.main; g.lineCap = 'round';
    if (lk.tail === 'curl') {
      g.lineWidth = 5; g.beginPath(); g.arc(-4, 0, 4, -1.2, 3.6); g.stroke();
      g.strokeStyle = c.sub; g.lineWidth = 2; g.beginPath(); g.arc(-4, 0, 4, 0.5, 2.6); g.stroke();
    } else if (lk.tail === 'straight') {
      g.lineWidth = 3.6; g.beginPath(); g.moveTo(2, 0); g.lineTo(-11, 0); g.stroke();
    } else if (lk.tail === 'fluffy') {
      g.beginPath(); g.ellipse(-6, 0, 8, 4.4, 0, 0, 6.28); g.fill();
      g.fillStyle = c.light; g.beginPath(); g.ellipse(-8, -1, 4.5, 2, 0, 0, 6.28); g.fill();
    } else {
      g.beginPath(); g.ellipse(-1, 0, 3.4, 2.8, 0, 0, 6.28); g.fill();
    }
    g.restore();
    g.fillStyle = lk.pattern === 'saddle' ? c.sub : c.main;
    g.beginPath(); g.ellipse(0, 0, 14, 8.5, 0, 0, 6.28); g.fill();
    if (lk.pattern === 'saddle') {
      g.fillStyle = c.main; g.beginPath(); g.ellipse(-2, 0, 10, 6, 0, 0, 6.28); g.fill();
    } else if (lk.pattern === 'spots') {
      g.fillStyle = c.sub;
      for (const [x, y, r] of [[-6, -3, 3.4], [1, 3.2, 2.8], [-1, -4.4, 2.2], [6, -1.6, 2.4], [-9, 3, 2]]) { g.beginPath(); g.ellipse(x, y, r, r * .8, 0, 0, 6.28); g.fill(); }
    } else {
      g.fillStyle = c.light; g.beginPath(); g.ellipse(-1, -1.5, 9, 4, 0, 0, 6.28); g.fill();
    }
    if (lk.pattern === 'chest') { g.fillStyle = c.sub; g.beginPath(); g.ellipse(10, 0, 4.6, 6, 0, 0, 6.28); g.fill(); }
    if (!o.photo) {
      g.fillStyle = c.main; g.beginPath(); g.arc(13, 0, 7.5, 0, 6.28); g.fill();
      if (lk.ears === 'up') {
        g.fillStyle = c.ear;
        g.beginPath(); g.moveTo(9, -5); g.lineTo(13, -11); g.lineTo(15, -5); g.fill();
        g.beginPath(); g.moveTo(9, 5); g.lineTo(13, 11); g.lineTo(15, 5); g.fill();
      } else {
        g.fillStyle = c.dark;
        for (const sy of [-1, 1]) { g.beginPath(); g.ellipse(11, sy * 7.5, 4.2, 2.6, sy * .5, 0, 6.28); g.fill(); }
      }
      g.fillStyle = lk.pattern === 'solid' ? c.light : c.sub;
      g.beginPath(); g.ellipse(18.5, 0, 4.2, 3.6, 0, 0, 6.28); g.fill();
      g.fillStyle = '#2b2522'; g.beginPath(); g.arc(22, 0, 1.8, 0, 6.28); g.fill();
    }
    g.restore();
    if (o.photo) {
      // the photo head stays upright (a sideways face reads badly); drawn ears peek out around it
      const hr = o.headR * k * (d.down ? .85 : 1), reach = (15 + (o.headR - 13) * .5) * k;
      const hx = d.x + Math.cos(d.ang) * reach, hy = d.y + Math.sin(d.ang) * reach - (d.down ? 0 : 2 * k);
      if (lk.ears === 'up') {
        g.fillStyle = c.ear;
        for (const sx of [-1, 1]) {
          g.beginPath(); g.moveTo(hx + sx * hr * .4, hy - hr * .8); g.lineTo(hx + sx * hr * 1, hy - hr * 1.3); g.lineTo(hx + sx * hr * 1, hy - hr * .3); g.fill();
        }
      } else {
        g.fillStyle = c.dark;
        for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(hx + sx * hr * .98, hy, hr * .32, hr * .62, sx * .35, 0, 6.28); g.fill(); }
      }
      g.fillStyle = c.dark;
      g.beginPath(); g.arc(hx, hy, hr + 2, 0, Math.PI * 2); g.fill();
      drawFace(g, hx, hy, hr, o.photo);
    }
  }
  // photo head radius in world units: at least ~13 CSS px on screen, so the face reads on a phone
  function faceR() { return Math.min(22, Math.max(13, 13 / scale)); }

  // ---------- hero: the player's own dog (photo never leaves the device) ----------
  let dogPhoto = null, dogName = '';   // '' = the player didn't name the dog
  const $name = document.getElementById('dogName');
  const $photoErr = document.getElementById('photoErr');
  const photoInput = document.getElementById('photoInput');
  const photoClear = document.getElementById('photoClear');

  // The dog (name, photo, look) is shared by every うちの子ワークス game on this site, so it lives under a
  // series-wide key; this game's own progress stays under hitsuji-*. Older versions saved it as hitsuji-dog.
  const PROFILE_KEY = 'uchinoko-dog';
  try {
    if (localStorage.getItem(PROFILE_KEY) === null && localStorage.getItem('hitsuji-dog') !== null) {
      localStorage.setItem(PROFILE_KEY, localStorage.getItem('hitsuji-dog'));
      localStorage.removeItem('hitsuji-dog');
    }
  } catch (e) {}
  function loadProfile() {
    try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY)); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
  }
  function saveProfile(patch) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(Object.assign(loadProfile(), patch))); return true; } catch (e) { return false; }
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  // body colour = the dominant fur hue near the middle of the face (so a sky or wall behind the
  // ears doesn't win); a white, black or grey dog has no strong hue and falls back to the plain average
  function coatFrom(img) {
    const N = 32, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, N, N);
    const px = g.getImageData(0, 0, N, N).data;
    const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    let ar = 0, ag = 0, ab = 0, n = 0;
    const R2 = (N * .34) * (N * .34);
    for (let i = 0; i < px.length; i += 4) {
      const x = (i / 4) % N - N / 2 + .5, y = Math.floor(i / 4 / N) - N / 2 + .5;
      if (x * x + y * y > R2) continue;
      const pr = px[i], pg = px[i + 1], pb = px[i + 2];
      ar += pr; ag += pg; ab += pb; n++;
      const [ph, ps, pl] = rgbToHsl(pr, pg, pb);
      if (ps < .18 || pl < .12 || pl > .9) continue;
      const bin = bins[Math.floor(ph * 12) % 12];
      bin.w += ps; bin.r += pr * ps; bin.g += pg * ps; bin.b += pb * ps;
    }
    const top = bins.reduce((a, b) => (b.w > a.w ? b : a));
    const rgb = top.w > n * .06 ? [top.r / top.w, top.g / top.w, top.b / top.w] : [ar / n, ag / n, ab / n];
    const [h, s, l] = rgbToHsl(...rgb);
    return palette(h, Math.min(.6, s), Math.min(.68, Math.max(.3, l)));
  }
  // one fur colour -> the shades the drawing uses
  function palette(h, s, l) {
    const f = dl => `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(Math.min(.95, Math.max(.1, l + dl)) * 100)}%)`;
    return { main: f(0), dark: f(-.14), light: f(.08), ear: f(-.08) };
  }

  // ---------- うちの子メーカー: the dog's body. Looks only: size never changes speed or reach ----------
  const MAIN_COLORS = { red: '#c8783a', black: '#3a3532', white: '#eee9df', cream: '#e3cb98', brown: '#8b5a2b', choco: '#5c3b27', gray: '#8f8b86', gold: '#d9a441' };
  const SUB_COLORS = { white: '#f7f3eb', cream: '#efe0bf', tan: '#d2a46c', brown: '#8b5a2b', gray: '#a39e98', black: '#2b2624' };
  const LOOK_PARTS = [
    { key: 'main', label: '毛色', options: [['photo', '写真から'], ['red', '赤（柴）'], ['black', '黒'], ['white', '白'], ['cream', 'クリーム'], ['brown', '茶'], ['choco', 'チョコ'], ['gray', '灰'], ['gold', 'ゴールド']] },
    { key: 'sub', label: '模様の色', options: [['white', '白'], ['cream', 'クリーム'], ['tan', '薄茶'], ['brown', '茶'], ['gray', '灰'], ['black', '黒']] },
    { key: 'pattern', label: '模様', options: [['solid', 'なし'], ['chest', '胸が白'], ['socks', 'くつした'], ['spots', 'ぶち'], ['saddle', '背中だけ']] },
    { key: 'ears', label: '耳', options: [['up', '立ち耳'], ['down', '垂れ耳']] },
    { key: 'tail', label: 'しっぽ', options: [['curl', '巻き尾'], ['straight', 'まっすぐ'], ['fluffy', 'ふさふさ'], ['short', '短い']] },
    { key: 'size', label: '体格', options: [['s', '小型'], ['m', '中型'], ['l', '大型']] },
  ];
  const SIZES = { s: { k: .85, pitch: 1.25 }, m: { k: 1, pitch: 1 }, l: { k: 1.15, pitch: .8 } };
  const LOOK_DEFAULT = { main: 'photo', sub: 'cream', pattern: 'chest', ears: 'up', tail: 'curl', size: 'm' };
  // only values from the option lists survive loading, so a damaged or edited save can't break drawing
  function cleanLook(raw) {
    const out = { ...LOOK_DEFAULT };
    if (raw && typeof raw === 'object') for (const p of LOOK_PARTS) if (p.options.some(([v]) => v === raw[p.key])) out[p.key] = raw[p.key];
    return out;
  }
  let look = { ...LOOK_DEFAULT }, photoCoat = null;
  function coatFor(lk) {
    let base = lk.main === 'photo' ? photoCoat : null;   // "写真から" without a photo falls back to the shiba red
    if (!base) {
      const n = parseInt((MAIN_COLORS[lk.main] || MAIN_COLORS.red).slice(1), 16);
      base = palette(...rgbToHsl(n >> 16, (n >> 8) & 255, n & 255));
    }
    return { ...base, sub: SUB_COLORS[lk.sub] };
  }
  let coat = coatFor(look);

  // front-facing face for the round avatars: the photo, or a drawn face in the chosen colours and ears
  function drawFace(g, x, y, r, photo = dogPhoto, lk = look, c = coat) {
    if (photo) {
      g.save();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
      g.drawImage(photo, x - r, y - r, r * 2, r * 2);
      g.restore();
      return;
    }
    if (lk.ears === 'up') {
      g.fillStyle = c.ear;
      for (const sx of [-1, 1]) {
        g.beginPath(); g.moveTo(x + sx * r * .85, y - r * .15); g.lineTo(x + sx * r * .62, y - r * 1.02); g.lineTo(x + sx * r * .12, y - r * .62); g.fill();
      }
    }
    g.fillStyle = c.main; g.beginPath(); g.arc(x, y + r * .08, r * .8, 0, Math.PI * 2); g.fill();
    if (lk.ears === 'down') {
      g.fillStyle = c.dark;
      for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(x + sx * r * .78, y + r * .12, r * .24, r * .5, sx * .3, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = lk.pattern === 'solid' ? c.light : c.sub;
    g.beginPath(); g.ellipse(x, y + r * .4, r * .42, r * .3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b2522';
    for (const sx of [-1, 1]) { g.beginPath(); g.arc(x + sx * r * .3, y - r * .05, r * .09, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.arc(x, y + r * .26, r * .11, 0, Math.PI * 2); g.fill();
  }
  function renderAvatar(cv) {
    const g = cv.getContext('2d'), s = cv.width, ring = s * .05;
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#34482c'; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    drawFace(g, s / 2, s / 2, dogPhoto ? s / 2 - ring : s * .4);
    g.strokeStyle = '#f2c230'; g.lineWidth = ring;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - ring / 2, 0, Math.PI * 2); g.stroke();
  }
  function renderHero() {
    renderAvatar(document.getElementById('avatar'));
    renderAvatar(document.getElementById('winAvatar'));
    photoClear.hidden = !dogPhoto;
    // the dog's own photo is the point of the game, so until there is one it is the first thing offered
    const photoStart = document.getElementById('photoStart'), startBtn = document.getElementById('startBtn');
    photoStart.hidden = !!dogPhoto;
    document.getElementById('photoBtn').hidden = !dogPhoto;
    startBtn.classList.toggle('primary', !!dogPhoto);
    startBtn.textContent = dogPhoto ? 'あそぶ' : 'この子のまま遊ぶ';
  }
  let photoGen = 0;   // only the latest usePhoto() call may land; a slow earlier decode is dropped
  function usePhoto(src) {
    const gen = ++photoGen;
    if (!src) { dogPhoto = null; photoCoat = null; coat = coatFor(look); renderHero(); return; }
    const img = new Image();
    img.onload = () => {
      if (gen !== photoGen) return;
      dogPhoto = img; photoCoat = coatFrom(img); coat = coatFor(look); renderHero();
      if (phase === 'win') {   // picked from the result screen: the share card should show the new face
        document.getElementById('invite').hidden = true;
        rebuildCard();
      }
    };
    img.onerror = () => { if (gen !== photoGen) return; dogPhoto = null; photoCoat = null; coat = coatFor(look); renderHero(); };
    img.src = src;
  }
  // the photo can be picked from the title screen or from the result screen's invite; show the error where the player is
  function showPhotoErr(msg) {
    for (const el of [$photoErr, document.getElementById('inviteErr')]) { el.textContent = msg; el.hidden = !msg; }
  }

  {
    const p = loadProfile();
    if (typeof p.name === 'string') { $name.value = p.name.slice(0, 10); dogName = $name.value.trim(); }
    look = cleanLook(p.look);
    coat = coatFor(look);
    // only accept the small JPEG we wrote ourselves
    usePhoto(typeof p.photo === 'string' && p.photo.startsWith('data:image/jpeg;base64,') ? p.photo : null);
  }
  $name.addEventListener('input', () => { dogName = $name.value.trim().slice(0, 10); });
  // persist once editing ends (blur / Enter), not per keystroke: the record also holds the photo
  $name.addEventListener('change', () => saveProfile({ name: dogName }));

  // crop: pick where the face sits inside the circle
  const cropOv = document.getElementById('cropOv');
  const cropCv = document.getElementById('cropCv');
  const cg = cropCv.getContext('2d');
  const $zoom = document.getElementById('zoom');
  const CROP = 480, HOLE = 200;   // crop canvas size and circle radius (canvas px)
  const SRC_MAX = 1280;           // longest side kept from the original photo while cropping
  let crop = null;                // {img: downscaled canvas, base, zoom, x, y}
  let pickGen = 0;                // a slow decode of an earlier pick must not replace a newer one

  document.getElementById('photoBtn').addEventListener('click', () => { showPhotoErr(''); photoInput.click(); });
  document.getElementById('photoStart').addEventListener('click', () => { showPhotoErr(''); photoInput.click(); });
  photoInput.addEventListener('change', () => {
    const f = photoInput.files && photoInput.files[0];
    photoInput.value = '';
    if (!f) return;
    // some browsers report HEIC and camera formats with an empty type; let the decoder decide
    if (f.type && !/^image\//.test(f.type)) return showPhotoErr('画像ファイルを選んでください。');
    if (f.size > 30 * 1024 * 1024) return showPhotoErr('写真が大きすぎます。30MBまでの写真を選んでください。');
    const gen = ++pickGen;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      // shrink once so dragging doesn't resample a 12-48 MP photo on every move
      const k = Math.min(1, SRC_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const src = document.createElement('canvas');
      src.width = Math.max(1, Math.round(img.naturalWidth * k));
      src.height = Math.max(1, Math.round(img.naturalHeight * k));
      src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
      URL.revokeObjectURL(url);
      if (gen !== pickGen) return;
      crop = { img: src, base: HOLE * 2 / Math.min(src.width, src.height), zoom: 1, x: 0, y: 0 };
      $zoom.value = '1';
      cropOv.hidden = false;
      drawCrop();
      cropCv.focus();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (gen !== pickGen) return;
      showPhotoErr('この写真は読み込めませんでした。JPEG か PNG の写真で試してください。');
    };
    img.src = url;
  });
  function cropSize() { const s = crop.base * crop.zoom; return { w: crop.img.width * s, h: crop.img.height * s }; }
  // keep the circle fully covered by the photo; call after any move or zoom
  function clampCrop() {
    const { w, h } = cropSize(), mx = Math.max(0, w / 2 - HOLE), my = Math.max(0, h / 2 - HOLE);
    crop.x = Math.max(-mx, Math.min(mx, crop.x));
    crop.y = Math.max(-my, Math.min(my, crop.y));
  }
  function cropRect() {
    const { w, h } = cropSize();
    return { x: CROP / 2 - w / 2 + crop.x, y: CROP / 2 - h / 2 + crop.y, w, h };
  }
  function drawCrop() {
    const r = cropRect();
    cg.clearRect(0, 0, CROP, CROP);
    cg.drawImage(crop.img, r.x, r.y, r.w, r.h);
    cg.fillStyle = 'rgba(17,17,17,.62)';
    cg.beginPath(); cg.rect(0, 0, CROP, CROP); cg.arc(CROP / 2, CROP / 2, HOLE, 0, Math.PI * 2, true); cg.fill();
    cg.strokeStyle = '#f2c230'; cg.lineWidth = 5;
    cg.beginPath(); cg.arc(CROP / 2, CROP / 2, HOLE, 0, Math.PI * 2); cg.stroke();
  }
  function moveCrop(dx, dy) { crop.x += dx; crop.y += dy; clampCrop(); drawCrop(); }
  function setZoom(z) { crop.zoom = Math.max(1, Math.min(4, z)); $zoom.value = String(crop.zoom); clampCrop(); drawCrop(); }
  let drag = null;
  cropCv.addEventListener('pointerdown', e => {
    if (!crop) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { cropCv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cropCv.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = CROP / cropCv.getBoundingClientRect().width;
    moveCrop((e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = () => { drag = null; };
  cropCv.addEventListener('pointerup', endDrag);
  cropCv.addEventListener('pointercancel', endDrag);
  cropCv.addEventListener('wheel', e => { if (!crop) return; e.preventDefault(); setZoom(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
  cropCv.addEventListener('keydown', e => {
    if (!crop) return;
    const step = e.shiftKey ? 40 : 10;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); moveCrop(...mv); }       // arrows move the photo, same as dragging it
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(crop.zoom * 1.1); }
    else if (e.key === '-') { e.preventDefault(); setZoom(crop.zoom / 1.1); }
  });
  $zoom.addEventListener('input', () => { if (crop) setZoom(parseFloat($zoom.value)); });
  function closeCrop() {
    const wasOpen = !cropOv.hidden;
    crop = null; drag = null; cropOv.hidden = true;
    if (wasOpen) document.getElementById(!titleOv.hidden ? 'startBtn' : 'shareBtn').focus();
  }
  document.getElementById('cropCancel').addEventListener('click', closeCrop);
  document.getElementById('cropOk').addEventListener('click', () => {
    const OUT = 160, k = OUT / (HOLE * 2), r = cropRect();
    const oc = document.createElement('canvas');
    oc.width = oc.height = OUT;
    oc.getContext('2d').drawImage(crop.img, (r.x - (CROP / 2 - HOLE)) * k, (r.y - (CROP / 2 - HOLE)) * k, r.w * k, r.h * k);
    const data = oc.toDataURL('image/jpeg', 0.88);
    closeCrop();
    usePhoto(data);
    showPhotoErr('');
    // once a photo has been set the invite has done its job, even if the photo is removed later
    if (!saveProfile({ photo: data, inviteDone: true })) showPhotoErr('写真を保存できませんでした。今回はこの写真で遊べますが、次に開いたときは元に戻ります。');
  });
  photoClear.addEventListener('click', () => { saveProfile({ photo: null }); usePhoto(null); showPhotoErr(''); });

  // うちの子メーカー screen: edits a draft with a live preview; nothing changes until 決定
  const lookOv = document.getElementById('lookOv');
  const lookCv = document.getElementById('lookCv');
  const lookG = lookCv.getContext('2d');
  let draft = null;
  function renderLookRows() {
    document.getElementById('lookRows').replaceChildren(...LOOK_PARTS.map(p => {
      const row = el('div', 'look-row'), chips = el('div', 'chips');
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', p.label);
      for (const [v, label] of p.options) {
        const color = p.key === 'main' ? MAIN_COLORS[v] : p.key === 'sub' ? SUB_COLORS[v] : null;
        const b = el('button', color ? 'swatch' : 'chip', color ? null : (v === 'photo' && !dogPhoto ? 'おまかせ' : label));
        b.type = 'button';
        if (color) { b.style.background = color; b.setAttribute('aria-label', label); b.title = label; }
        b.setAttribute('aria-pressed', String(draft[p.key] === v));
        b.addEventListener('click', () => {
          draft[p.key] = v;
          for (const o of chips.children) o.setAttribute('aria-pressed', String(o === b));
          drawLookPreview();
        });
        chips.append(b);
      }
      row.append(el('span', 'hero-lbl', p.label), chips);
      return row;
    }));
  }
  function drawLookPreview(time = performance.now() / 1000) {
    const g = lookG, w = lookCv.width, h = lookCv.height;
    g.fillStyle = '#7fae5a'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = -h; i < w; i += 60) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 30, 0); g.lineTo(i + 30 + h, h); g.lineTo(i + h, h); g.fill(); }
    paintDog(g, { x: w / 2 - 20, y: h / 2 + 6, ang: 0, vx: 90, vy: 0, down: false },
      { look: draft, coat: coatFor(draft), photo: dogPhoto, k: 4.3 * SIZES[draft.size].k, headR: 13, time });
  }
  function lookLoop() {
    if (lookOv.hidden) return;
    drawLookPreview();
    requestAnimationFrame(lookLoop);
  }
  function openLook() {
    draft = { ...look };
    renderLookRows();
    lookOv.hidden = false;
    drawLookPreview();
    requestAnimationFrame(lookLoop);
    document.querySelector('#lookRows [aria-pressed="true"]').focus();
  }
  function closeLook() {
    const wasOpen = !lookOv.hidden;
    lookOv.hidden = true; draft = null;
    if (wasOpen) document.getElementById('lookBtn').focus();
  }
  document.getElementById('lookBtn').addEventListener('click', openLook);
  document.getElementById('lookCancel').addEventListener('click', closeLook);
  document.getElementById('lookOk').addEventListener('click', () => {
    look = cleanLook(draft);
    coat = coatFor(look);
    saveProfile({ look });
    renderHero();
    closeLook();
  });

  // ---------- share: a result card the player sends themselves (nothing is uploaded by the game) ----------
  // written as the owner's own brag ("Kuro became a sheepdog!"), with the game's unique tag and the series tag
  function shareText(r) {
    return (r.name ? r.name : 'うちの子') + '、牧羊犬になりました！ ' + r.rank + 'に認定 ' + starText(r.stars)
      + '（ステージ' + (r.stage + 1) + '「' + STAGES[r.stage].name + '」' + fmt(r.time) + '） #うちの子牧羊犬 #うちの子ワークス';
  }
  function fitFont(g, text, maxW, size, face) {
    let s = size;
    do { g.font = face.replace('{s}', s); s -= 2; } while (g.measureText(text).width > maxW && s > 18);
  }
  async function makeShareCard(r) {
    try { await Promise.all([document.fonts.load('64px "Dela Gothic One"'), document.fonts.load('800 40px "M PLUS Rounded 1c"')]); } catch (e) {}
    const S = 1080, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#7fae5a'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < S * 2; i += 70) {
      g.fillStyle = 'rgba(255,255,255,.05)';
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 35, 0); g.lineTo(i + 35 - S, S); g.lineTo(i - S, S); g.fill();
    }
    g.fillStyle = 'rgba(36,51,31,.93)';
    g.beginPath();
    if (g.roundRect) g.roundRect(70, 70, 940, 940, 48); else g.rect(70, 70, 940, 940);
    g.fill();
    // a strip of meadow behind the dog and sheep, so dark coats still read against the dark card
    g.fillStyle = '#6f9e4c';
    g.beginPath();
    if (g.roundRect) g.roundRect(100, 225, 880, 210, 105); else g.rect(100, 225, 880, 210);
    g.fill();
    // the hero
    g.fillStyle = '#34482c'; g.beginPath(); g.arc(540, 300, 160, 0, Math.PI * 2); g.fill();
    drawFace(g, 540, 300, dogPhoto ? 148 : 128);
    g.strokeStyle = '#f2c230'; g.lineWidth = 14; g.beginPath(); g.arc(540, 300, 154, 0, Math.PI * 2); g.stroke();
    // the whole dog herding a few sheep beside the face, so coat, pattern and tail show too
    paintDog(g, { x: 215, y: 330, ang: 0, vx: 120, vy: 0, down: false },
      { look, coat, photo: dogPhoto, k: 3.6 * SIZES[look.size].k, headR: 13, time: .2 });
    for (const [sx, sy] of [[835, 245], [915, 320], [840, 395]]) {
      g.save(); g.translate(sx, sy); g.scale(3, 3);
      drawSheep({ x: 0, y: 0, r: 11, vx: 0, vy: 0, ang: Math.PI * .08, type: 'normal', phase: 0, fear: 0, alarm: 0, inside: false }, g);
      g.restore();
    }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    // the rounded body face has full kanji coverage (the logo face lacks words like 牧羊犬)
    const headline = (r.name ? r.name : 'うちの子') + '、牧羊犬になりました！';
    g.fillStyle = '#f6f4ee'; fitFont(g, headline, 860, 66, '800 {s}px "M PLUS Rounded 1c", sans-serif');
    g.fillText(headline, 540, 545);
    const rankLine = r.rank + 'に認定';
    g.fillStyle = '#f2c230'; fitFont(g, rankLine, 860, 46, '800 {s}px "M PLUS Rounded 1c", sans-serif');
    g.fillText(rankLine, 540, 612);
    g.font = '96px "Hiragino Sans", "Yu Gothic", sans-serif';
    g.fillText(starText(r.stars), 540, 718);
    const stageLine = 'ステージ' + (r.stage + 1) + '「' + STAGES[r.stage].name + '」　タイム ' + fmt(r.time);
    g.fillStyle = '#b9c7a8'; fitFont(g, stageLine, 860, 40, '800 {s}px "M PLUS Rounded 1c", sans-serif');
    g.fillText(stageLine, 540, 800);
    g.fillStyle = '#f6f4ee'; g.font = '800 34px "M PLUS Rounded 1c", sans-serif';
    g.fillText('#うちの子牧羊犬', 540, 862);
    g.fillStyle = '#f2c230'; g.font = '800 40px "M PLUS Rounded 1c", sans-serif';
    g.fillText('うちの子、牧羊犬になる。', 540, 934);
    g.fillStyle = '#b9c7a8'; g.font = '700 24px "M PLUS Rounded 1c", sans-serif';
    g.fillText('うちの子ワークス　' + SITE.replace('https://', '').replace(/\/$/, ''), 540, 978);
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  }

  // build the share image as soon as the result is known (and again if the face changes), so the
  // share sheet can open straight from the tap; only the newest build may land
  let cardGen = 0;
  function rebuildCard() {
    const gen = ++cardGen, r = lastResult;
    cardBlob = null;
    if (!r) return;
    cardPromise = makeShareCard(r).then(b => { if (gen === cardGen) cardBlob = b; return b; }).catch(() => null);
  }

  const shareBtn = document.getElementById('shareBtn');
  let shareUrl = null;
  async function shareResult() {
    if (!lastResult) return;
    shareBtn.disabled = true;
    try {
      const blob = cardBlob || await cardPromise;
      if (!blob) return;
      const text = shareText(lastResult);
      const file = new File([blob], 'uchinoko-sheepdog.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: text + ' ' + SITE }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }   // other failures fall through to the sheet
      }
      openShareSheet(blob, text);
    } finally { shareBtn.disabled = false; }
  }
  function openShareSheet(blob, text) {
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(blob);
    document.getElementById('shareImg').src = shareUrl;
    document.getElementById('shareSave').href = shareUrl;
    document.getElementById('shareX').href = 'https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(SITE);
    // friends tapping the link inside LINE get the game in their real browser, where it's easier to play
    document.getElementById('shareLine').href = 'https://line.me/R/msg/text/?' + encodeURIComponent(text + ' ' + withExternal(SITE));
    document.getElementById('sharePhotoNote').hidden = !dogPhoto;
    document.getElementById('shareCopy').textContent = '文章をコピー';
    document.getElementById('shareTextWrap').hidden = true;
    shareOv.hidden = false;
    document.getElementById('shareClose').focus();
  }
  function closeShare() {
    shareOv.hidden = true;
    if (shareUrl) { URL.revokeObjectURL(shareUrl); shareUrl = null; }
    document.getElementById('shareImg').removeAttribute('src');
    shareBtn.focus();
  }
  shareBtn.addEventListener('click', shareResult);
  document.getElementById('shareClose').addEventListener('click', closeShare);
  document.getElementById('shareCopy').addEventListener('click', e => {
    const text = shareText(lastResult) + ' ' + SITE, btn = e.currentTarget;
    // no clipboard access (old browsers, some in-app browsers): hand the text over pre-selected instead
    const manual = () => {
      const wrap = document.getElementById('shareTextWrap'), box = document.getElementById('shareText');
      box.value = text; wrap.hidden = false;
      box.focus(); box.select();
      btn.textContent = '下の文章をコピーしてください';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => { btn.textContent = 'コピーしました'; }, manual);
    else manual();
  });

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
    // notes: [startHz, endHz, delay, duration]; pitch follows the dog's size (small dogs yap higher)
    bark(notes, pitch = 1) {
      for (const [f0, f1, at, dur] of notes) tone({ type: 'sawtooth', f0: f0 * pitch, f1: f1 * pitch, at, dur, vol: .24, lp: 1400 });
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
  // background music: a short pastoral tune generated on the fly (no audio files), C - F - Am - G
  const BGM_TEMPO = 96;
  const BGM_MELODY = [   // MIDI notes, 0 = rest; one entry per eighth note, 8 bars
    76, 0, 79, 0, 81, 0, 79, 76, 74, 0, 72, 0, 74, 0, 0, 0,
    76, 0, 79, 0, 81, 0, 84, 81, 79, 0, 76, 0, 79, 0, 0, 0,
    81, 0, 79, 0, 76, 0, 74, 76, 79, 0, 76, 0, 74, 0, 72, 0,
    74, 0, 76, 0, 79, 0, 76, 74, 72, 0, 0, 0, 0, 0, 0, 0,
  ];
  const BGM_BASS = [48, 53, 45, 43];   // C F A G roots, each held for two bars
  const bgm = { on: false, timer: 0, next: 0, step: 0, out: null };
  const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
  function bgmNote(m, at, dur, type, vol) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = midiHz(m);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + .02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(bgm.out);
    o.start(at); o.stop(at + dur + .05);
  }
  function bgmTick() {
    if (!bgm.on || !actx) return;
    const eighth = 60 / BGM_TEMPO / 2;
    while (bgm.next < actx.currentTime + .35) {   // schedule a little ahead so timer jitter never shows
      const i = bgm.step % BGM_MELODY.length;
      if (BGM_MELODY[i]) bgmNote(BGM_MELODY[i], bgm.next, eighth * 1.7, 'triangle', .045);
      if (i % 8 === 0) bgmNote(BGM_BASS[Math.floor(i / 16) % 4], bgm.next, eighth * 7.5, 'sine', .055);
      bgm.next += eighth; bgm.step++;
    }
  }
  function bgmStart() {
    const a = ac();
    if (!a || bgm.on) return;
    bgm.on = true;
    bgm.out = a.createGain();
    bgm.out.gain.setValueAtTime(0.0001, a.currentTime);
    bgm.out.gain.exponentialRampToValueAtTime(1, a.currentTime + 1.2);
    bgm.out.connect(a.destination);
    bgm.next = a.currentTime + .1;
    bgm.timer = setInterval(bgmTick, 100);
    bgmTick();
  }
  function bgmStop() {
    if (!bgm.on) return;
    bgm.on = false;
    clearInterval(bgm.timer);
    const out = bgm.out, now = actx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + .4);
    setTimeout(() => out.disconnect(), 600);
  }

  const muteBtn = document.getElementById('muteBtn');
  function renderMute() { muteBtn.textContent = muted ? '音 OFF' : '音 ON'; muteBtn.setAttribute('aria-pressed', String(muted)); }
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem('hitsuji-muted', muted ? '1' : '0'); } catch (e) {}
    if (muted) bgmStop();
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
    else if (joy && e.pointerId === joy.id) {
      joy.x = e.clientX; joy.y = e.clientY;
      // a floating stick: the base trails a thumb that goes past the rim, so reversing direction is instant
      const dx = joy.x - joy.sx, dy = joy.y - joy.sy, d = Math.hypot(dx, dy);
      if (d > JOY_R) { joy.sx = joy.x - dx / d * JOY_R; joy.sy = joy.y - dy / d * JOY_R; }
    }
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
    if (!cropOv.hidden) { if (e.key === 'Escape') closeCrop(); return; }
    if (!shareOv.hidden) { if (e.key === 'Escape') closeShare(); return; }
    if (!lookOv.hidden) { if (e.key === 'Escape') closeLook(); return; }
    if (!stageOv.hidden) { if (e.key === 'Escape') toTitle(); return; }
    if (e.target instanceof HTMLInputElement) return; // typing the dog's name
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'p' || k === 'Escape') {
      if (phase === 'play') pause(); else if (phase === 'paused') resume();
      return;
    }
    if (k === ' ') { e.preventDefault(); if (phase === 'play') bark(); return; }
    if (k === 'e') { toggleGate(); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    keys[k] = true;
  });
  addEventListener('keyup', e => { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; downHeld = false; mouseHeld = false; });
  // stop the clock only when the page is really hidden (app/tab switch). Not on blur:
  // phone browsers fire blur when a touch grazes the browser's own bars or edges.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  addEventListener('pagehide', pause);

  // Keep the page still on touch screens: a downward pull closes LINE's browser sheet, and the page must not
  // bounce or zoom while a thumb is steering. Overlays that actually scroll, and sliders, keep their gestures.
  document.addEventListener('touchmove', e => {
    if (e.target.closest('input')) return;
    const ov = e.target.closest('.overlay');
    if (ov && ov.scrollHeight > ov.clientHeight + 1) return;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());   // iOS pinch-zoom

  // An iPhone edge swipe (or Android back) mid-stage pauses the game instead of leaving the page.
  // Going back again from the pause menu really leaves.
  let backGuard = false;
  function guardBack() {
    if (backGuard) return;
    try { history.pushState({ uchinoko: 'stage' }, ''); backGuard = true; } catch (e) {}
  }
  addEventListener('popstate', () => {
    backGuard = false;
    if (phase === 'play') { pause(); guardBack(); }
  });

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

  // ---------- screens ----------
  function hideOverlays() { for (const o of [titleOv, stageOv, winOv, shareOv, pauseOv]) o.hidden = true; }
  function start() {
    resetGame();
    phase = 'play';
    hideOverlays();
    renderPauseBtn();
    guardBack();
    bgmStart();
  }
  function startStage(i) {
    if (!unlocked(i)) return;
    stageIdx = i; ST = STAGES[i];
    start();
  }
  function el(tag, cls, text) { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; }
  function openStages() {
    phase = 'title';
    bgmStop();
    renderPauseBtn();
    const list = document.getElementById('stageList');
    list.replaceChildren(...STAGES.map((S, i) => {
      const b = el('button', 'stage-btn');
      b.type = 'button';
      b.disabled = !unlocked(i);
      const stars = savedStars(i), best = progress.best[i], open = unlocked(i);
      const mark = ok => (ok ? '✓' : '−');
      b.append(
        el('span', 'st-num', String(i + 1)),
        el('span', 'st-name', S.name),
        el('span', 'st-stars', open ? starText(stars) : ''),
        el('span', 'st-meta', !open ? '前のステージをクリアすると遊べます'
          : best ? 'ベスト ' + fmt(best) + '　目標' + S.par + '秒 ' + mark(progress.time[i]) : 'まだクリアしていません'),
        el('span', 'st-mission', open ? 'お題：' + S.mission.text + ' ' + mark(progress.mission[i]) : ''),
      );
      b.setAttribute('aria-label', 'ステージ' + (i + 1) + ' ' + S.name + (open ? '、星' + stars + 'つ、お題：' + S.mission.text : '、まだ遊べません'));
      b.addEventListener('click', () => startStage(i));
      return b;
    }));
    // players whose old time-based ★3 became ★2 are told why, once
    const notice = document.getElementById('stageNotice');
    notice.hidden = !progress.notice;
    if (progress.notice) { progress.notice = false; saveProgress(); }
    hideOverlays();
    stageOv.hidden = false;
    // focus the furthest stage the player can play
    const btns = [...list.querySelectorAll('button:not(:disabled)')];
    (btns.find((b, i) => !progress.cleared[i]) || btns[btns.length - 1]).focus();
  }
  function pause() {
    if (phase !== 'play') return;
    phase = 'paused';
    joy = null; mouseHeld = false; setDown(false);
    for (const k in keys) keys[k] = false;
    bgmStop();
    document.getElementById('pauseMission').textContent = 'お題：' + ST.mission.text;
    pauseOv.hidden = false;
    renderPauseBtn();
    document.getElementById('resumeBtn').focus();
  }
  function resume() {
    if (phase !== 'paused') return;
    phase = 'play';
    pauseOv.hidden = true;
    renderPauseBtn();
    bgmStart();
  }
  function toTitle() {
    phase = 'title';
    bgmStop();
    hideOverlays();
    titleOv.hidden = false;
    renderPauseBtn();
    document.getElementById('startBtn').focus();
  }
  function renderPauseBtn() { pauseBtn.disabled = phase !== 'play'; }
  pauseBtn.addEventListener('click', pause);
  document.getElementById('resumeBtn').addEventListener('click', resume);
  document.getElementById('titleBtn').addEventListener('click', openStages);
  // a first-time player goes straight into stage 1; the stage list only helps once there is something to pick
  document.getElementById('startBtn').addEventListener('click', () => (progress.cleared[0] ? openStages() : startStage(0)));
  document.getElementById('stageBack').addEventListener('click', toTitle);
  document.getElementById('againBtn').addEventListener('click', start);
  document.getElementById('restartBtn').addEventListener('click', start);
  document.getElementById('nextBtn').addEventListener('click', () => startStage(stageIdx + 1));
  document.getElementById('selectBtn').addEventListener('click', openStages);
  document.getElementById('invitePhoto').addEventListener('click', () => { showPhotoErr(''); photoInput.click(); });
  document.getElementById('inviteLater').addEventListener('click', () => {
    saveProfile({ inviteDone: true });
    document.getElementById('invite').hidden = true;
    document.getElementById('shareBtn').focus();
  });
  // controls are obvious on touch (on-screen buttons) but not with a mouse (right-click to bark), so open them there
  if (!matchMedia('(pointer: coarse)').matches) document.getElementById('howTo').open = true;

  // ---------- loop ----------
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = stage.clientWidth, ch = stage.clientHeight;
    cvs.width = Math.round(cw * dpr); cvs.height = Math.round(ch * dpr);
    // keep the thumb pad off the field: reserve a strip below (portrait) or to the right (landscape)
    let aw = cw, ah = ch;
    if (matchMedia('(pointer: coarse)').matches) { if (cw >= ch) aw = cw - 112; else ah = ch - 108; }
    // the message band sits above the field: messages must never cover the pen and gate (always top-right),
    // least of all "close the gate now" while the player is working right there
    ah -= MSG_H;
    scale = Math.min(aw / W, ah / H);
    ox = (aw - W * scale) / 2; oy = MSG_H + (ah - H * scale) / 2;
  }
  // the field's shape (wide or tall) is chosen when a stage is built. Rebuilding mid-game would scramble the
  // sheep, so a turned phone gets a fresh field only between games; during play the goal banner explains.
  function orientationChanged() { return (stage.clientHeight > stage.clientWidth * 1.1) !== (H > W); }
  function onResize() {
    if ((phase === 'title' || phase === 'win') && orientationChanged()) resetGame(); else resize();
  }
  addEventListener('resize', onResize);
  // the window resize event isn't reliable on every phone / in-app browser when rotating; watch the field itself too
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(stage);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resetGame();
  requestAnimationFrame(frame);
})();
