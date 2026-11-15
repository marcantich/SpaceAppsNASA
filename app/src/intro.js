// [intro] Opening screen. The markup is in index.html and the look in intro.css, so it is on screen
// before this file runs. Here: the star field and when to leave.
//
// It stays until the user presses Enter / Space or clicks / taps, so it can be read or left open. The
// invitation appears once the app has created its globes (window.globes, set at the end of main.js)
// and never before MIN_MS. MAX_MS is a safety net: if the app failed to start, the screen can still be
// dismissed and the error is visible.
const MIN_MS = 3000;
const MAX_MS = 15000;

const root = document.getElementById('intro');
if (root) {
  const t0 = performance.now();

  // ---- stars: fixed random field, a few of them twinkle -----------------------------------------
  const canvas = root.querySelector('.intro-stars');
  const ctx = canvas.getContext('2d');
  let stars = [];
  let frame = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function resize() {
    const k = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * k);
    canvas.height = Math.round(innerHeight * k);
    const n = Math.round((innerWidth * innerHeight) / 2600);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: (Math.random() ** 3 * 1.5 + 0.35) * k,
      a: 0.35 + Math.random() * 0.65,
      w: Math.random() < 0.3 ? 0.6 + Math.random() * 1.8 : 0, // twinkle speed (rad/s), 0 = steady
      p: Math.random() * 6.283,
      c: Math.random() < 0.12 ? '255,214,190' : Math.random() < 0.2 ? '190,214,255' : '255,255,255',
    }));
  }
  function paint(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = now / 1000;
    for (const s of stars) {
      const a = s.w ? s.a * (0.55 + 0.45 * Math.sin(s.p + s.w * t)) : s.a;
      ctx.fillStyle = `rgba(${s.c},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.283);
      ctx.fill();
    }
    if (!still) frame = requestAnimationFrame(paint);
  }
  resize();
  paint(performance.now());
  const onResize = () => { resize(); if (still) paint(performance.now()); };
  addEventListener('resize', onResize);

  // ---- leave: only when the user says so (Enter, Space, click or tap) ------------------------------
  // The bar fills when the app is ready (and never before MIN_MS); then the text under it invites to
  // start. Asking earlier is remembered: the screen leaves as soon as the app is ready.
  const ready = () => !!(window.globes?.left && window.globes?.right);
  const label = root.querySelector('.intro-load p');
  let loaded = false;
  let asked = false;
  let left = false;
  function leave() {
    if (left) return;
    left = true;
    removeEventListener('keydown', onKey, true);
    root.classList.add('out');
    setTimeout(() => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', onResize);
      root.remove();
    }, 900);
  }
  function ask() {
    asked = true;
    if (loaded) leave();
    else label.textContent = 'Starting as soon as it is ready…';
  }
  function onKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation(); // the app behind must not get this key
    ask();
  }
  addEventListener('keydown', onKey, true);
  root.addEventListener('click', ask);
  const timer = setInterval(() => {
    const dt = performance.now() - t0;
    if (dt < MIN_MS || (!ready() && dt < MAX_MS)) return;
    clearInterval(timer);
    loaded = true;
    root.classList.add('done', 'ready'); // the bar fills up, the invitation shows
    label.textContent = matchMedia('(pointer: coarse)').matches ? 'Tap to start' : 'Press Enter or click to start';
    if (asked) setTimeout(leave, 350);
  }, 100);
}
