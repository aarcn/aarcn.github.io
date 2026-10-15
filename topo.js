// Background: random topo-map contour lines, redrawn with a new seed on
// every page load. A smooth noise field gets traced with marching squares at
// evenly spaced heights; the CSS blur on the canvas does the rest.
(function () {
  var STEP = 6;          // grid cell size in px -- the blur hides the facets
  var SCALE = 520;       // px per noise unit; bigger = wider hills
  var LEVELS = 26;       // contour lines across the full height range
  var BLEED = 90;        // draw past the edges so the blur doesn't fade them out

  var canvas = document.createElement('canvas');
  canvas.className = 'topo';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);
  var ctx = canvas.getContext('2d');

  // seeded 2d gradient noise
  var seed = Math.random() * 1e9 | 0;
  function rand() { seed = (seed * 1664525 + 1013904223) | 0; return (seed >>> 0) / 4294967296; }
  var perm = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
  for (var i = 0; i < 256; i++) { perm[i] = i; var a = rand() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  for (i = 255; i > 0; i--) { var j = rand() * (i + 1) | 0, t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (i = 0; i < 256; i++) perm[i + 256] = perm[i];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function grad(h, x, y) { return gx[h] * x + gy[h] * y; }
  function noise(x, y) {
    var X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y;
    X &= 255; Y &= 255;
    var u = fade(xf), v = fade(yf);
    var aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1], ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    var x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    var x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  }
  var ox = rand() * 1000, oy = rand() * 1000;
  function height(px, py) {
    var x = px / SCALE + ox, y = py / SCALE + oy;
    return noise(x, y) + .45 * noise(x * 2.1, y * 2.1) + .08 * noise(x * 4.3, y * 4.3);
  }
  // each separate line is either all orange or all white, picked at random
  var WHITE_SHARE = .22;
  var colorSeed = rand() * 4294967296 >>> 0;
  function isWhite(root, level) {
    var h = Math.imul(root ^ colorSeed, 2654435761) ^ Math.imul(level + 1, 40503);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296 < WHITE_SHARE;
  }

  var drawnW = 0, drawnH = 0, field, cols, rows, parent, stamp, pass = 0;

  function draw() {
    var w = window.innerWidth + BLEED * 2, h = window.innerHeight + BLEED * 2;
    drawnW = window.innerWidth; drawnH = window.innerHeight;
    canvas.width = w; canvas.height = h;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';

    cols = Math.ceil(w / STEP) + 1; rows = Math.ceil(h / STEP) + 1;
    field = new Float32Array(cols * rows);
    parent = new Int32Array(cols * rows * 2); stamp = new Int32Array(cols * rows * 2);
    var min = Infinity, max = -Infinity;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var v = height(c * STEP - BLEED, r * STEP - BLEED);
      field[r * cols + c] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    var accent = getComputedStyle(document.documentElement).getPropertyValue('--topo').trim() || '#e06a14';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (var l = 1; l < LEVELS; l++) {
      var segs = trace(min + (max - min) * l / LEVELS);
      var major = l % 5 === 0;
      ctx.lineWidth = major ? 3.4 : 2;
      stroke(segs, l, false, accent, major ? 1 : .75);
      stroke(segs, l, true, '#ffffff', major ? .75 : .5);
    }
    ctx.globalAlpha = 1;
  }

  // union-find over the cell edges a line crosses, so connected segments
  // end up sharing one root (= one line)
  function find(i) {
    if (stamp[i] !== pass) { stamp[i] = pass; parent[i] = i; return i; }
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }

  // marching squares: returns flat [edgeA, edgeB, x1, y1, x2, y2, ...]
  function trace(iso) {
    pass++;
    var out = [], n = cols * rows;
    for (var r = 0; r < rows - 1; r++) for (var c = 0; c < cols - 1; c++) {
      var tl = field[r * cols + c], tr = field[r * cols + c + 1];
      var br = field[(r + 1) * cols + c + 1], bl = field[(r + 1) * cols + c];
      var idx = (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) | (br > iso ? 2 : 0) | (bl > iso ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      var x = c * STEP, y = r * STEP;
      // where the line crosses each edge of the cell, plus that edge's id
      var T = [r * cols + c, x + STEP * (iso - tl) / (tr - tl), y];
      var B = [(r + 1) * cols + c, x + STEP * (iso - bl) / (br - bl), y + STEP];
      var L = [n + r * cols + c, x, y + STEP * (iso - tl) / (bl - tl)];
      var R = [n + r * cols + c + 1, x + STEP, y + STEP * (iso - tr) / (br - tr)];
      switch (idx) {
        case 1: case 14: seg(out, L, B); break;
        case 2: case 13: seg(out, B, R); break;
        case 3: case 12: seg(out, L, R); break;
        case 4: case 11: seg(out, T, R); break;
        case 6: case 9: seg(out, T, B); break;
        case 7: case 8: seg(out, L, T); break;
        case 5: seg(out, L, T); seg(out, B, R); break;
        case 10: seg(out, T, R); seg(out, L, B); break;
      }
    }
    return out;
  }
  function seg(out, a, b) { union(a[0], b[0]); out.push(a[0], b[0], a[1], a[2], b[1], b[2]); }

  function stroke(segs, level, white, color, alpha) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (var i = 0; i < segs.length; i += 6) {
      if (isWhite(find(segs[i]), level) !== white) continue;
      ctx.moveTo(segs[i + 2], segs[i + 3]);
      ctx.lineTo(segs[i + 4], segs[i + 5]);
    }
    ctx.stroke();
  }

  draw();
  // phones fire resize when the address bar slides; only redraw on real changes
  var timer;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (window.innerWidth !== drawnW || window.innerHeight > drawnH) draw();
    }, 150);
  });
})();
