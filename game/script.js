// Crypto Catcher - JavaScript Engine

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const livesEl = document.getElementById('lives');
const multiplierEl = document.getElementById('multiplier');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayDesc = document.getElementById('overlay-desc');
const startBtn = document.getElementById('start-btn');

// Audio Context setup (Synthesized sound FX)
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playBeep(freq, type = 'sine', duration = 0.1) {
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Audio safe fallback
  }
}

// Game State
let gameState = 'START'; // START, PLAYING, GAMEOVER
let score = 0;
let highScore = localStorage.getItem('moonshot_highscore') || 0;
let lives = 3;
let streak = 0;
let multiplier = 1;

highScoreEl.textContent = highScore;

// Player Ship Object
const player = {
  x: canvas.width / 2 - 35,
  y: canvas.height - 35,
  width: 70,
  height: 20,
  speed: 8,
  dx: 0,
  color: '#38bdf8'
};

// Items & Particles Array
let items = [];
let particles = [];
let stars = [];

// Initialize Starfield Background
for (let i = 0; i < 50; i++) {
  stars.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: Math.random() * 2 + 0.5,
    speed: Math.random() * 0.5 + 0.1
  });
}

// Item Types Definition
const ITEM_TYPES = [
  { name: 'Bitcoin', symbol: '₿', color: '#f7931a', score: 10, prob: 0.4, type: 'coin' },
  { name: 'Ethereum', symbol: 'Ξ', color: '#627eea', score: 15, prob: 0.3, type: 'coin' },
  { name: 'Solana', symbol: '◎', color: '#14f195', score: 25, prob: 0.15, type: 'coin' },
  { name: 'Rugpull', symbol: '📉', color: '#ef4444', score: 0, prob: 0.1, type: 'hazard' },
  { name: 'Diamond', symbol: '💎', color: '#38bdf8', score: 50, prob: 0.05, type: 'power' }
];

// Controls Handler
const keys = {};

window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
});

// Mouse/Touch controls
canvas.addEventListener('mousemove', (e) => {
  if (gameState !== 'PLAYING') return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  player.x = Math.max(0, Math.min(canvas.width - player.width, mouseX - player.width / 2));
});

// Spawn Item logic
let spawnTimer = 0;
const spawnInterval = 45; // frames

function spawnItem() {
  const rand = Math.random();
  let cumulativeProb = 0;
  let selected = ITEM_TYPES[0];

  for (let t of ITEM_TYPES) {
    cumulativeProb += t.prob;
    if (rand <= cumulativeProb) {
      selected = t;
      break;
    }
  }

  items.push({
    x: Math.random() * (canvas.width - 30) + 15,
    y: -20,
    size: 24,
    speed: Math.random() * 2 + 2.5 + (score / 150),
    ...selected
  });
}

// Particle system for effects
function createParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      radius: Math.random() * 3 + 1,
      color: color,
      alpha: 1,
      decay: Math.random() * 0.03 + 0.02
    });
  }
}

// Game Loop
let lastTime = 0;

function update() {
  if (gameState !== 'PLAYING') return;

  // Move Player via Keyboard
  if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
    player.x -= player.speed;
  }
  if (keys['ArrowRight'] || keys['d'] || keys['D']) {
    player.x += player.speed;
  }

  // Constrain Player Bounds
  player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));

  // Update Stars
  stars.forEach(star => {
    star.y += star.speed;
    if (star.y > canvas.height) {
      star.y = 0;
      star.x = Math.random() * canvas.width;
    }
  });

  // Spawn Items
  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnItem();
    spawnTimer = 0;
  }

  // Update Items
  for (let i = items.length - 1; i >= 0; i--) {
    let item = items[i];
    item.y += item.speed;

    // Collision Detection with Player
    if (
      item.y + item.size / 2 >= player.y &&
      item.y - item.size / 2 <= player.y + player.height &&
      item.x + item.size / 2 >= player.x &&
      item.x - item.size / 2 <= player.x + player.width
    ) {
      if (item.type === 'coin' || item.type === 'power') {
        streak++;
        multiplier = Math.min(5, 1 + Math.floor(streak / 5));
        score += item.score * multiplier;
        createParticles(item.x, item.y, item.color, 12);
        playBeep(440 + score, 'sine', 0.1);
      } else if (item.type === 'hazard') {
        lives--;
        streak = 0;
        multiplier = 1;
        createParticles(item.x, item.y, item.color, 20);
        playBeep(150, 'sawtooth', 0.2);
        if (lives <= 0) {
          endGame();
        }
      }

      scoreEl.textContent = score;
      multiplierEl.textContent = `${multiplier}x`;
      livesEl.textContent = '❤️'.repeat(Math.max(0, lives));

      items.splice(i, 1);
      continue;
    }

    // Missed item (floor hit)
    if (item.y > canvas.height + 20) {
      if (item.type === 'coin') {
        streak = 0;
        multiplier = 1;
        multiplierEl.textContent = '1x';
      }
      items.splice(i, 1);
    }
  }

  // Update Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) {
      particles.splice(i, 1);
    }
  }
}

function draw() {
  // Clear Canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw Starfield Background
  stars.forEach(star => {
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw Player Rocket Basket
  ctx.fillStyle = player.color;
  ctx.shadowColor = player.color;
  ctx.shadowBlur = 10;
  
  // Custom Tray/Rocket Shape
  ctx.beginPath();
  ctx.roundRect(player.x, player.y, player.width, player.height, [8, 8, 4, 4]);
  ctx.fill();

  // Glow strip
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(player.x + 10, player.y + 4, player.width - 20, 3);
  ctx.shadowBlur = 0;

  // Draw Items
  items.forEach(item => {
    ctx.font = `${item.size}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.symbol, item.x, item.y);
  });

  // Draw Particles
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function gameLoop() {
  update();
  draw();
  if (gameState === 'PLAYING') {
    requestAnimationFrame(gameLoop);
  }
}

function startGame() {
  initAudio();
  gameState = 'PLAYING';
  score = 0;
  lives = 3;
  streak = 0;
  multiplier = 1;
  items = [];
  particles = [];

  player.x = canvas.width / 2 - player.width / 2;

  scoreEl.textContent = '0';
  livesEl.textContent = '❤️❤️❤️';
  multiplierEl.textContent = '1x';

  overlay.classList.add('hidden');
  requestAnimationFrame(gameLoop);
}

function endGame() {
  gameState = 'GAMEOVER';
  playBeep(100, 'square', 0.4);

  if (score > highScore) {
    highScore = score;
    localStorage.setItem('moonshot_highscore', highScore);
    highScoreEl.textContent = highScore;
    overlayTitle.textContent = '🎉 NEW HIGH SCORE!';
  } else {
    overlayTitle.textContent = 'GAME OVER';
  }

  overlayDesc.innerHTML = `Final Score: <strong>${score}</strong><br>Keep stacking your coins!`;
  startBtn.textContent = 'PLAY AGAIN';
  overlay.classList.remove('hidden');
}

startBtn.addEventListener('click', startGame);
