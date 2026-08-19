// ---- 승진게임: 수박게임 스타일 합치기 게임, 테마 = 직장인 승진 ----

const TIERS = [
  { name: '인턴',   color: '#CFC9C0', mood: 'happy',    accessory: 'badge' },
  { name: '사원',   color: '#7CB853', mood: 'happy',    accessory: 'pen' },
  { name: '대리',   color: '#4FA3D1', mood: 'tired',    accessory: 'coffee' },
  { name: '과장',   color: '#2E8B57', mood: 'tired',    accessory: 'papers' },
  { name: '차장',   color: '#34568B', mood: 'stressed', accessory: 'glasses' },
  { name: '부장',   color: '#6D4C41', mood: 'stressed', accessory: 'belly' },
  { name: '이사',   color: '#5E35B1', mood: 'relieved', accessory: 'pocketsquare' },
  { name: '상무',   color: '#8E24AA', mood: 'relieved', accessory: 'watch' },
  { name: '전무',   color: '#EF6C00', mood: 'content',  accessory: 'fountainpen' },
  { name: '부사장', color: '#E64A19', mood: 'content',  accessory: 'goldglasses' },
  { name: '사장',   color: '#9E9E9E', mood: 'content',  accessory: 'cigar', metallic: ['#EAEAEA', '#B0B0B0', '#8A8A8A'] },
  { name: '회장',   color: '#D4AF37', mood: 'content',  accessory: 'crown', metallic: ['#FCEFA1', '#D4AF37', '#8A6E1E'] },
];

const RADIUS_BASE = 16;
const RADIUS_STEP = 7;
const SPAWNABLE_TIERS = 5; // 처음 드롭 가능한 티어 범위 (인턴~차장)
const SCORE_TABLE = TIERS.map((_, i) => ((i + 1) * (i + 2)) / 2 * 10);

function radiusOf(tier) {
  return RADIUS_BASE + tier * RADIUS_STEP;
}

function nextTier(tier) {
  return tier < TIERS.length - 1 ? tier + 1 : null;
}

function scoreForMerge(newTier) {
  return SCORE_TABLE[newTier];
}

// ---- 물리 엔진 세팅 ----

const { Engine, World, Composite, Bodies, Body, Events, Runner } = Matter;

const CANVAS_W = 380;
const CANVAS_H = 520;
const WALL_THICK = 20;
const DANGER_LINE_Y = 70;
const DANGER_HOLD_MS = 1000;
const DROP_COOLDOWN_MS = 350;

const engine = Engine.create();
engine.gravity.y = 1.2;
const world = engine.world;

const canvas = document.getElementById('gameCanvas');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d');

const nextCanvas = document.getElementById('nextCanvas');
const nextCtx = nextCanvas.getContext('2d');

const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('gameOverOverlay');
const finalScoreEl = document.getElementById('finalScore');
const restartBtn = document.getElementById('restartBtn');

let score = 0;
let best = Number(localStorage.getItem('promotionGameBest') || 0);
bestEl.textContent = best;

// 벽
World.add(world, [
  Bodies.rectangle(CANVAS_W / 2, CANVAS_H + WALL_THICK / 2, CANVAS_W, WALL_THICK, { isStatic: true }),
  Bodies.rectangle(-WALL_THICK / 2, CANVAS_H / 2, WALL_THICK, CANVAS_H, { isStatic: true }),
  Bodies.rectangle(CANVAS_W + WALL_THICK / 2, CANVAS_H / 2, WALL_THICK, CANVAS_H, { isStatic: true }),
]);

let holding = null;   // 드롭 대기 중인 조각 { tier, x }
let nextTierQueued = randomSpawnTier();
let dropLocked = false;
let dangerTimer = 0;
let gameOver = false;

function randomSpawnTier() {
  return Math.floor(Math.random() * SPAWNABLE_TIERS);
}

function makeBody(tier, x, y) {
  const r = radiusOf(tier);
  const body = Bodies.circle(x, y, r, {
    restitution: 0.15,
    friction: 0.4,
    frictionAir: 0.001,
  });
  body.tier = tier;
  body.spawnedAt = performance.now();
  return body;
}

function spawnHolding() {
  holding = { tier: nextTierQueued, x: CANVAS_W / 2 };
  nextTierQueued = randomSpawnTier();
  drawNextPreview();
}

function drawNextPreview() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  drawPiece(nextCtx, TIERS[nextTierQueued], radiusOf(nextTierQueued) * 0.6, nextCanvas.width / 2, nextCanvas.height / 2);
}

// ---- 입력 처리 ----

function canvasX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left) * (CANVAS_W / rect.width);
}

let isDragging = false;

function updateHoldingX(clientX) {
  const r = radiusOf(holding.tier);
  const x = canvasX(clientX);
  holding.x = Math.max(r + WALL_THICK / 2, Math.min(CANVAS_W - r - WALL_THICK / 2, x));
}

// 손을 대면 그 위치로 이동만 하고, 누른 채로 끌다가 뗄 때 떨어뜨림 (모바일 터치 기준)
canvas.addEventListener('pointerdown', (e) => {
  if (gameOver || !holding || dropLocked) return;
  isDragging = true;
  canvas.setPointerCapture(e.pointerId);
  updateHoldingX(e.clientX);
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDragging || !holding || dropLocked || gameOver) return;
  updateHoldingX(e.clientX);
});

canvas.addEventListener('pointerup', () => {
  if (!isDragging) return;
  isDragging = false;
  if (holding && !dropLocked && !gameOver) dropPiece();
});

canvas.addEventListener('pointercancel', () => {
  isDragging = false;
});

function dropPiece() {
  dropLocked = true;
  const body = makeBody(holding.tier, holding.x, radiusOf(holding.tier) + 4);
  World.add(world, body);
  holding = null;
  setTimeout(() => {
    dropLocked = false;
    spawnHolding();
  }, DROP_COOLDOWN_MS);
}

// ---- 병합 처리 ----

Events.on(engine, 'collisionStart', (evt) => {
  const merged = new Set();
  for (const pair of evt.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (a.isStatic || b.isStatic) continue;
    if (merged.has(a.id) || merged.has(b.id)) continue;
    if (a.tier !== b.tier) continue;
    const nt = nextTier(a.tier);
    if (nt === null) continue;

    merged.add(a.id);
    merged.add(b.id);

    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;
    World.remove(world, a);
    World.remove(world, b);
    const newBody = makeBody(nt, mx, my);
    World.add(world, newBody);
    spawnMergeEffect(mx, my, TIERS[nt].color);

    score += scoreForMerge(nt);
    scoreEl.textContent = score;
  }
});

// ---- 병합 이펙트 (파티클 + 링) ----

let particles = [];
let rings = [];

function spawnMergeEffect(x, y, color) {
  const count = 14;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const speed = 1.5 + Math.random() * 2.5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 2 + Math.random() * 2.5,
      color,
    });
  }
  rings.push({ x, y, r: 4, maxR: 46, life: 1, color });
}

function updateEffects(dtMs) {
  const dt = dtMs / 16.6;
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 0.08 * dt;
    p.life -= 0.035 * dt;
  }
  rings = rings.filter((r) => r.life > 0);
  for (const r of rings) {
    r.r += (r.maxR - r.r) * 0.25 * dt;
    r.life -= 0.06 * dt;
  }
}

function drawEffects(ctx2) {
  for (const p of particles) {
    ctx2.globalAlpha = Math.max(0, p.life);
    ctx2.fillStyle = p.color;
    ctx2.beginPath();
    ctx2.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx2.fill();
  }
  for (const r of rings) {
    ctx2.globalAlpha = Math.max(0, r.life) * 0.6;
    ctx2.strokeStyle = r.color;
    ctx2.lineWidth = 3;
    ctx2.beginPath();
    ctx2.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx2.stroke();
  }
  ctx2.globalAlpha = 1;
}

// 방금 태어난 조각이 살짝 튀어오르듯 커지는 팝인 효과
function popScale(spawnedAt) {
  const t = (performance.now() - spawnedAt) / 220;
  if (t >= 1) return 1;
  const eased = 1 - Math.pow(1 - t, 3);
  return 0.6 + eased * 0.4;
}

// ---- 게임 오버 판정 ----

function checkGameOver(dtMs) {
  const now = performance.now();
  let danger = false;
  for (const body of Composite.allBodies(world)) {
    if (body.isStatic) continue;
    if (now - body.spawnedAt < 700) continue; // 방금 떨어뜨린 조각은 유예
    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed > 0.5) continue;
    if (body.position.y - body.circleRadius < DANGER_LINE_Y) {
      danger = true;
      break;
    }
  }
  if (danger) {
    dangerTimer += dtMs;
    if (dangerTimer > DANGER_HOLD_MS) {
      triggerGameOver();
    }
  } else {
    dangerTimer = 0;
  }
}

function triggerGameOver() {
  gameOver = true;
  Runner.stop(runner);
  if (score > best) {
    best = score;
    localStorage.setItem('promotionGameBest', String(best));
  }
  bestEl.textContent = best;
  finalScoreEl.textContent = score;
  overlay.classList.remove('hidden');
}

restartBtn.addEventListener('click', () => {
  location.reload();
});

// ---- 표정 그리기 ----

function drawFace(ctx2, mood, cx, cy, r) {
  ctx2.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx2.fillStyle = 'rgba(0,0,0,0.55)';
  ctx2.lineWidth = Math.max(1, r * 0.06);
  const ex = r * 0.35;
  const ey = -r * 0.1;

  if (mood === 'happy') {
    ctx2.beginPath();
    ctx2.arc(cx - ex, cy + ey, r * 0.08, 0, Math.PI * 2);
    ctx2.arc(cx + ex, cy + ey, r * 0.08, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.beginPath();
    ctx2.arc(cx, cy + r * 0.15, r * 0.35, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx2.stroke();
  } else if (mood === 'tired') {
    ctx2.beginPath();
    ctx2.moveTo(cx - ex - r * 0.1, cy + ey);
    ctx2.lineTo(cx - ex + r * 0.1, cy + ey);
    ctx2.moveTo(cx + ex - r * 0.1, cy + ey);
    ctx2.lineTo(cx + ex + r * 0.1, cy + ey);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.moveTo(cx - r * 0.25, cy + r * 0.32);
    ctx2.lineTo(cx + r * 0.25, cy + r * 0.32);
    ctx2.stroke();
    // 다크서클
    ctx2.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx2.beginPath();
    ctx2.arc(cx - ex, cy + ey + r * 0.1, r * 0.12, 0, Math.PI);
    ctx2.arc(cx + ex, cy + ey + r * 0.1, r * 0.12, 0, Math.PI);
    ctx2.stroke();
  } else if (mood === 'stressed') {
    ctx2.beginPath();
    ctx2.moveTo(cx - ex - r * 0.12, cy + ey - r * 0.12);
    ctx2.lineTo(cx - ex + r * 0.1, cy + ey);
    ctx2.moveTo(cx + ex + r * 0.12, cy + ey - r * 0.12);
    ctx2.lineTo(cx + ex - r * 0.1, cy + ey);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.arc(cx, cy + r * 0.45, r * 0.3, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx2.stroke();
  } else if (mood === 'content') {
    ctx2.beginPath();
    ctx2.arc(cx - ex, cy + ey, r * 0.14, Math.PI, Math.PI * 2);
    ctx2.arc(cx + ex, cy + ey, r * 0.14, Math.PI, Math.PI * 2);
    ctx2.stroke();
    ctx2.beginPath();
    ctx2.arc(cx, cy + r * 0.12, r * 0.4, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx2.stroke();
  }
}

// ---- 직급별 액세서리 아이콘 ----

function drawAccessory(ctx2, type, cx, cy, r) {
  ctx2.save();
  ctx2.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx2.fillStyle = '#ffffff';
  ctx2.lineWidth = Math.max(1.5, r * 0.06);

  if (type === 'badge') {
    // 사원증 목걸이
    ctx2.beginPath();
    ctx2.moveTo(cx - r * 0.08, cy - r * 0.55);
    ctx2.lineTo(cx + r * 0.08, cy - r * 0.55);
    ctx2.stroke();
    ctx2.fillRect(cx - r * 0.14, cy - r * 0.58, r * 0.28, r * 0.2);
    ctx2.strokeRect(cx - r * 0.14, cy - r * 0.58, r * 0.28, r * 0.2);
  } else if (type === 'pen') {
    ctx2.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx2.beginPath();
    ctx2.moveTo(cx + r * 0.55, cy - r * 0.75);
    ctx2.lineTo(cx + r * 0.75, cy - r * 0.55);
    ctx2.stroke();
  } else if (type === 'coffee') {
    const cw = r * 0.3, chh = r * 0.24;
    const bx = cx - r * 0.7, by = cy - r * 0.15;
    ctx2.fillStyle = '#fff';
    ctx2.fillRect(bx, by, cw, chh);
    ctx2.strokeRect(bx, by, cw, chh);
    ctx2.beginPath();
    ctx2.arc(bx + cw, by + chh / 2, chh * 0.35, -Math.PI / 2, Math.PI / 2);
    ctx2.stroke();
  } else if (type === 'papers') {
    for (let i = 0; i < 3; i++) {
      const ox = cx + r * 0.4 + i * r * 0.05;
      const oy = cy - r * 0.5 + i * r * 0.05;
      ctx2.fillStyle = '#fff';
      ctx2.fillRect(ox, oy, r * 0.3, r * 0.4);
      ctx2.strokeRect(ox, oy, r * 0.3, r * 0.4);
    }
  } else if (type === 'glasses') {
    const ex = r * 0.35, ey = -r * 0.1, gw = r * 0.22, gh = r * 0.16;
    ctx2.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx2.strokeRect(cx - ex - gw / 2, cy + ey - gh / 2, gw, gh);
    ctx2.strokeRect(cx + ex - gw / 2, cy + ey - gh / 2, gw, gh);
    ctx2.beginPath();
    ctx2.moveTo(cx - ex + gw / 2, cy + ey);
    ctx2.lineTo(cx + ex - gw / 2, cy + ey);
    ctx2.stroke();
  } else if (type === 'belly') {
    ctx2.fillStyle = 'rgba(0,0,0,0.08)';
    ctx2.beginPath();
    ctx2.arc(cx, cy + r * 0.45, r * 0.4, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx2.beginPath();
    ctx2.moveTo(cx - r * 0.95, cy - r * 0.1);
    ctx2.quadraticCurveTo(cx - r * 1.1, cy + r * 0.2, cx - r * 0.8, cy + r * 0.35);
    ctx2.moveTo(cx + r * 0.95, cy - r * 0.1);
    ctx2.quadraticCurveTo(cx + r * 1.1, cy + r * 0.2, cx + r * 0.8, cy + r * 0.35);
    ctx2.stroke();
  } else if (type === 'pocketsquare') {
    ctx2.fillStyle = '#fff';
    ctx2.beginPath();
    ctx2.moveTo(cx - r * 0.55, cy + r * 0.35);
    ctx2.lineTo(cx - r * 0.4, cy + r * 0.35);
    ctx2.lineTo(cx - r * 0.47, cy + r * 0.15);
    ctx2.closePath();
    ctx2.fill();
    ctx2.stroke();
  } else if (type === 'watch') {
    ctx2.fillStyle = '#fff';
    ctx2.fillRect(cx + r * 0.55, cy + r * 0.1, r * 0.2, r * 0.16);
    ctx2.strokeRect(cx + r * 0.55, cy + r * 0.1, r * 0.2, r * 0.16);
  } else if (type === 'fountainpen') {
    ctx2.fillStyle = 'rgba(255,215,0,0.9)';
    ctx2.beginPath();
    ctx2.moveTo(cx + r * 0.5, cy - r * 0.7);
    ctx2.lineTo(cx + r * 0.65, cy - r * 0.85);
    ctx2.lineTo(cx + r * 0.72, cy - r * 0.78);
    ctx2.lineTo(cx + r * 0.57, cy - r * 0.63);
    ctx2.closePath();
    ctx2.fill();
  } else if (type === 'goldglasses' || type === 'cigar' || type === 'crown') {
    // 금테 안경(부사장 이상 공통)
    const ex = r * 0.35, ey = -r * 0.1, gw = r * 0.22;
    ctx2.strokeStyle = '#D4AF37';
    ctx2.lineWidth = Math.max(1.5, r * 0.06);
    ctx2.beginPath();
    ctx2.arc(cx - ex, cy + ey, gw / 2, 0, Math.PI * 2);
    ctx2.arc(cx + ex, cy + ey, gw / 2, 0, Math.PI * 2);
    ctx2.moveTo(cx - ex + gw / 2, cy + ey);
    ctx2.lineTo(cx + ex - gw / 2, cy + ey);
    ctx2.stroke();

    if (type === 'cigar') {
      ctx2.strokeStyle = 'rgba(90,60,30,0.8)';
      ctx2.lineWidth = Math.max(2, r * 0.1);
      ctx2.beginPath();
      ctx2.moveTo(cx + r * 0.3, cy + r * 0.55);
      ctx2.lineTo(cx + r * 0.65, cy + r * 0.45);
      ctx2.stroke();
    }
    if (type === 'crown') {
      const cw = r * 0.9, ch = r * 0.32, cy0 = cy - r * 1.05;
      ctx2.fillStyle = '#FFD700';
      ctx2.strokeStyle = 'rgba(120,90,0,0.7)';
      ctx2.beginPath();
      ctx2.moveTo(cx - cw / 2, cy0 + ch);
      ctx2.lineTo(cx - cw / 2, cy0);
      ctx2.lineTo(cx - cw / 4, cy0 + ch * 0.5);
      ctx2.lineTo(cx, cy0);
      ctx2.lineTo(cx + cw / 4, cy0 + ch * 0.5);
      ctx2.lineTo(cx + cw / 2, cy0);
      ctx2.lineTo(cx + cw / 2, cy0 + ch);
      ctx2.closePath();
      ctx2.fill();
      ctx2.stroke();
    }
  }
  ctx2.restore();
}

// 배경 밝기에 따라 검정/흰색 텍스트를 자동으로 골라 항상 읽히게 함
function hexLuminance(hex) {
  const n = hex.replace('#', '');
  const r = parseInt(n.substr(0, 2), 16);
  const g = parseInt(n.substr(2, 2), 16);
  const b = parseInt(n.substr(4, 2), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function textColorsFor(tierData) {
  const hex = tierData.metallic ? tierData.metallic[1] : tierData.color;
  const light = hexLuminance(hex) > 150;
  return light
    ? { fill: '#241a08', outline: 'rgba(255,255,255,0.9)' }
    : { fill: '#ffffff', outline: 'rgba(0,0,0,0.55)' };
}

function pieceFill(ctx2, tierData, x, y, r) {
  if (tierData.metallic) {
    const g = ctx2.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, tierData.metallic[0]);
    g.addColorStop(0.6, tierData.metallic[1]);
    g.addColorStop(1, tierData.metallic[2]);
    return g;
  }
  return tierData.color;
}

function drawPiece(ctx2, tierData, r, x, y, scale = 1) {
  const rr = r * scale;
  ctx2.beginPath();
  ctx2.arc(x, y, rr, 0, Math.PI * 2);
  ctx2.fillStyle = pieceFill(ctx2, tierData, x, y, rr);
  ctx2.fill();
  ctx2.lineWidth = 2;
  ctx2.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx2.stroke();

  // 얼굴/액세서리가 원 밖으로 삐져나가지 않도록 원 모양으로 잘라냄
  // (회장의 왕관만 일부러 위로 나오는 디자인이라 예외)
  const clipToBody = tierData.accessory !== 'crown';
  ctx2.save();
  if (clipToBody) {
    ctx2.beginPath();
    ctx2.arc(x, y, rr, 0, Math.PI * 2);
    ctx2.clip();
  }
  drawFace(ctx2, tierData.mood, x, y, rr);
  drawAccessory(ctx2, tierData.accessory, x, y, rr * 1.35);
  ctx2.restore();

  const { fill, outline } = textColorsFor(tierData);
  ctx2.font = `800 ${Math.max(11, rr * 0.42)}px -apple-system, sans-serif`;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.lineWidth = Math.max(2, rr * 0.14);
  ctx2.strokeStyle = outline;
  ctx2.lineJoin = 'round';
  ctx2.strokeText(tierData.name, x, y + rr * 0.62);
  ctx2.fillStyle = fill;
  ctx2.fillText(tierData.name, x, y + rr * 0.62);
}

// ---- 렌더 루프 ----

function render() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // 위험선
  ctx.strokeStyle = 'rgba(220,60,60,0.5)';
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, DANGER_LINE_Y);
  ctx.lineTo(CANVAS_W, DANGER_LINE_Y);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const body of Composite.allBodies(world)) {
    if (body.isStatic) continue;
    const tierData = TIERS[body.tier];
    drawPiece(ctx, tierData, body.circleRadius, body.position.x, body.position.y, popScale(body.spawnedAt));
  }

  drawEffects(ctx);

  if (holding && !gameOver) {
    ctx.globalAlpha = 0.85;
    drawPiece(ctx, TIERS[holding.tier], radiusOf(holding.tier), holding.x, radiusOf(holding.tier) + 4);
    ctx.globalAlpha = 1;
  }
}

let lastTime = performance.now();
function loop(now) {
  const dt = now - lastTime;
  lastTime = now;
  if (!gameOver) {
    checkGameOver(dt);
    updateEffects(dt);
    render();
  }
  requestAnimationFrame(loop);
}

const runner = Runner.create();
Runner.run(runner, engine);
spawnHolding();
requestAnimationFrame(loop);

// ---- 개발용 자가 점검 (?test=1 로 접속 시 콘솔에 출력) ----
if (new URLSearchParams(location.search).get('test') === '1') {
  console.assert(TIERS.length === 12, 'TIERS는 12단계여야 함');
  console.assert(nextTier(11) === null, '회장은 더 이상 합쳐지지 않아야 함');
  console.assert(nextTier(0) === 1, '인턴+인턴은 사원이 되어야 함');
  console.assert(radiusOf(0) < radiusOf(11), '상위 티어가 더 커야 함');
  console.assert(SCORE_TABLE.every((v, i) => i === 0 || v > SCORE_TABLE[i - 1]), '점수는 티어가 오를수록 커야 함');
  console.log('[selfTest] 통과');
}
