import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// A hand-rolled CSS 3D version of this hallway (perspective + rotateX/rotateY
// transforms on plain DOM planes) was tried first and worked, but CSS's
// "perspective" is a fake projection with no real near-plane clipping -- get
// the camera close to a wall and geometry blows up/inverts instead of being
// cleanly clipped. three.js gives an actual WebGL camera frustum, which fixes
// that at the root, and its real scene graph (parent/child transforms) also
// makes a visible first-person body straightforward: a yaw-only rig holds the
// body, the camera is a pitch-only child of that rig, so looking down just
// naturally reveals what's already sitting in front of you -- no counter-
// rotation math needed.

document.addEventListener('DOMContentLoaded', function () {
  var canvas = document.getElementById('corridorCanvas');
  var sceneEl = document.getElementById('scene3d');
  var lookPrompt = document.getElementById('lookPrompt');
  var captionOverlay = document.getElementById('captionOverlay');
  var overlayYear = document.getElementById('overlayYear');
  var overlayTitle = document.getElementById('overlayTitle');
  var overlayBlurb = document.getElementById('overlayBlurb');
  var controls = document.getElementById('corridorControls');
  var modeToggle = document.getElementById('modeToggle');
  var exhibitsListEl = document.getElementById('exhibitsList');
  var fallbackNav = document.getElementById('fallbackNav');
  var prevBtn = document.getElementById('prevExhibit');
  var nextBtn = document.getElementById('nextExhibit');
  var positionEl = document.getElementById('exhibitPosition');
  var data = typeof EXHIBITS !== 'undefined' ? EXHIBITS : [];

  if (!canvas || !sceneEl || !controls || !modeToggle || !data.length) return;

  // Blurbs are plain text in history.js; any http(s) URL in one becomes a
  // link that opens in a new tab. Built from text nodes, never innerHTML.
  function fillBlurb(el, text) {
    el.textContent = '';
    var re = /https?:\/\/[^\s)]+/g, last = 0, m;
    while ((m = re.exec(text))) {
      el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      a.href = m[0]; a.textContent = m[0]; a.target = '_blank'; a.rel = 'noopener';
      el.appendChild(a);
      last = m.index + m[0].length;
    }
    el.appendChild(document.createTextNode(text.slice(last)));
  }
  // Clicking a link in the 3D caption shouldn't also grab the mouse for
  // looking around (or start a touch drag) -- the scene listens on its parent.
  ['click', 'pointerdown'].forEach(function (type) {
    overlayBlurb.addEventListener(type, function (e) { if (e.target.closest('a')) e.stopPropagation(); });
  });

  var CORRIDOR_WIDTH = 560;
  var WALL_HEIGHT = 440;
  var EYE_HEIGHT = 140;
  // Exactly half of EXHIBIT_SPACING -- this is what makes the first beam
  // land precisely at the corridor's entrance (z=0) instead of floating
  // outside it, which is what keeps every exhibit exactly beam-centered
  // (see the beam z-formula below).
  var EXHIBIT_SPACING = 420;
  var START_PAD = EXHIBIT_SPACING / 2;
  var END_PAD = 320;
  var CORRIDOR_LENGTH = START_PAD + (data.length - 1) * EXHIBIT_SPACING + END_PAD;
  var PLAYER_RADIUS = 55;
  var EXHIBIT_INSET = 3;
  var EXHIBIT_W = 190, EXHIBIT_H = 140;
  var SPEED_PER_SEC = 160;
  var SPRINT_MULT = 2.5;
  var GRAVITY = 1500;
  var JUMP_SPEED = 460;
  var TURN_SPEED_DEG_PER_SEC = 90;
  var MOUSE_LOOK_SENSITIVITY = 0.15;
  var TOUCH_LOOK_SENSITIVITY = 0.25;
  var PROXIMITY = 320;
  var PITCH_MIN = -88, PITCH_MAX = 80;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // --- theme colors -----------------------------------------------------
  // Only --accent is read here -- it's the one CSS var the site's light/dark
  // toggle never overrides (see the note by MUSEUM_BG below for why the rest
  // of the museum's palette is deliberately fixed instead of theme-reactive).
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function solidColor(name) { return new THREE.Color(cssVar(name) || '#888888'); }
  function makeTextTexture(text, fg, bg) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    var ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg;
    ctx.font = '600 22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, c.width / 2, c.height / 2);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // --- accessible flat list, built once and independent of the 3D scene --
  // (built before the WebGL renderer so the no-WebGL fallback path below
  // always has something real to show).
  var listArticles = data.map(function (item, i) {
    var article = document.createElement('article');
    article.className = 'exhibit';

    var frame = document.createElement('div');
    frame.className = 'exhibit-frame';
    if (item.image) {
      var img = document.createElement('img');
      img.src = item.image; img.alt = item.title; img.loading = 'lazy';
      frame.appendChild(img);
    } else {
      var placeholder = document.createElement('span');
      placeholder.className = 'exhibit-placeholder';
      placeholder.textContent = '[ photo ]';
      placeholder.setAttribute('role', 'img');
      placeholder.setAttribute('aria-label', 'Placeholder — content coming soon');
      frame.appendChild(placeholder);
    }
    article.appendChild(frame);

    var caption = document.createElement('div');
    caption.className = 'exhibit-caption';
    var year = document.createElement('span');
    year.className = 'exhibit-year'; year.textContent = item.year;
    caption.appendChild(year);
    var title = document.createElement('h2');
    title.className = 'exhibit-title'; title.textContent = item.title; title.tabIndex = -1;
    caption.appendChild(title);
    var blurb = document.createElement('p');
    blurb.className = 'exhibit-blurb'; fillBlurb(blurb, item.blurb);
    caption.appendChild(blurb);
    article.appendChild(caption);

    exhibitsListEl.appendChild(article);
    return { el: article, titleEl: title };
  });

  function showListIndex(i, focus) {
    listIndex = clamp(i, 0, listArticles.length - 1);
    listArticles.forEach(function (a, idx) { a.el.classList.toggle('exhibit-active', idx === listIndex); });
    positionEl.textContent = (listIndex + 1) + ' / ' + listArticles.length;
    prevBtn.disabled = listIndex === 0;
    nextBtn.disabled = listIndex === listArticles.length - 1;
    if (focus) listArticles[listIndex].titleEl.focus();
  }
  var listIndex = 0;

  function activateListOnly() {
    mode = 'list';
    exhibitsListEl.hidden = false;
    fallbackNav.hidden = false;
    showListIndex(0, false);
    prevBtn.addEventListener('click', function () { showListIndex(listIndex - 1, true); });
    nextBtn.addEventListener('click', function () { showListIndex(listIndex + 1, true); });
  }

  // --- renderer / scene / camera rig -------------------------------------
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch (e) {
    renderer = null;
  }
  if (!renderer) {
    // No WebGL available -- fall back to the accessible list view permanently.
    sceneEl.hidden = true;
    modeToggle.hidden = true;
    controls.hidden = true;
    activateListOnly();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 3.5;

  // The gallery is deliberately always dark/moody, independent of the site's
  // light/dark toggle -- Ready Player One's Halliday museum look depends on
  // spotlit frames standing out against near-black surroundings, and the
  // site's light theme flips --bg to a bright cream that would kill that
  // contrast entirely. Only --accent (unaffected by the toggle) still ties
  // the path and highlight back to the site's palette.
  var MUSEUM_BG = 0x06070a;
  var MUSEUM_WALL = 0x14181e;
  var MUSEUM_FLOOR = 0x0b0d10;
  var MUSEUM_FRAME = 0x2a241c;
  var MUSEUM_BODY = 0x363c44;
  var SPOT_COLOR = 0xffdcae;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(MUSEUM_BG);
  scene.fog = new THREE.Fog(MUSEUM_BG, 260, CORRIDOR_LENGTH * 1.3);
  var camera = new THREE.PerspectiveCamera(75, 1, 1, CORRIDOR_LENGTH + 800);
  camera.position.set(0, EYE_HEIGHT, 0);

  var rig = new THREE.Object3D();
  rig.add(camera);
  scene.add(rig);

  function resize() {
    var w = sceneEl.clientWidth || 1, h = sceneEl.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- lighting: dim overall fill + a warm spotlight per exhibit, no ------
  // shadow maps (light falloff + fog alone sell the "pools of light in a
  // dark room" look without the performance cost of real shadow casting).
  var hemi = new THREE.HemisphereLight(0x333f4d, 0x0a0806, 1.7);
  scene.add(hemi);
  // A flat, unconditional fill so nothing is ever truly pure black, even
  // architecture nowhere near a spotlight -- hemisphere alone left the
  // ceiling and far walls fully black even pushed high, which read as
  // broken/unlit rather than moody.
  scene.add(new THREE.AmbientLight(0x2a2f38, 1.2));
  // Faint warm fill down the corridor's own length so the floor between
  // exhibits isn't pure black -- two low point lights, no falloff drama.
  // decay:1 instead of the physically-correct 2 -- inverse-square falloff
  // at this scene's (arbitrary, large) unit scale needs unreasonably huge
  // intensity numbers to read as anything but black.
  [0.28, 0.72].forEach(function (t) {
    var fill = new THREE.PointLight(0x8a95a8, 220, CORRIDOR_LENGTH * 0.7, 1);
    fill.position.set(0, WALL_HEIGHT * 0.65, -CORRIDOR_LENGTH * t);
    scene.add(fill);
  });

  // --- static geometry: floor / walls / ceiling / glowing path stripe ----
  var floorMat = new THREE.MeshStandardMaterial({ color: MUSEUM_FLOOR, roughness: 0.55, metalness: 0.15 });
  var wallMat = new THREE.MeshStandardMaterial({ color: MUSEUM_WALL, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  var pathMat = new THREE.MeshStandardMaterial({ color: solidColor('--accent'), emissive: solidColor('--accent'), emissiveIntensity: 0.7, roughness: 0.5 });

  var floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(CORRIDOR_WIDTH, CORRIDOR_LENGTH), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(0, 0, -CORRIDOR_LENGTH / 2);
  scene.add(floorMesh);

  var pathMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, CORRIDOR_LENGTH), pathMat);
  pathMesh.rotation.x = -Math.PI / 2;
  pathMesh.position.set(0, 0.4, -CORRIDOR_LENGTH / 2);
  scene.add(pathMesh);

  function buildWallPlane(xSign) {
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(CORRIDOR_LENGTH, WALL_HEIGHT), wallMat);
    mesh.rotation.y = xSign > 0 ? -Math.PI / 2 : Math.PI / 2;
    mesh.position.set(xSign * CORRIDOR_WIDTH / 2, WALL_HEIGHT / 2, -CORRIDOR_LENGTH / 2);
    scene.add(mesh);
    return mesh;
  }
  buildWallPlane(-1);
  buildWallPlane(1);

  var endWallMesh = new THREE.Mesh(new THREE.PlaneGeometry(CORRIDOR_WIDTH, WALL_HEIGHT), wallMat);
  endWallMesh.position.set(0, WALL_HEIGHT / 2, -CORRIDOR_LENGTH);
  scene.add(endWallMesh);

  // Ceiling: closes the box. Without one, looking up steeply at a grazing
  // angle exposes a sliver of unrendered space past the walls (shows as a
  // stray dark patch) -- and now that pitch is a real feature, "look up"
  // should show a ceiling on purpose rather than a gap.
  var ceilingMesh = new THREE.Mesh(new THREE.PlaneGeometry(CORRIDOR_WIDTH, CORRIDOR_LENGTH), wallMat);
  ceilingMesh.rotation.x = Math.PI / 2;
  ceilingMesh.position.set(0, WALL_HEIGHT, -CORRIDOR_LENGTH / 2);
  scene.add(ceilingMesh);

  // --- exhibits: a real recessed frame + a warm spotlight per picture,
  // mounted on a small fixture -- the light literally comes from where the
  // fixture mesh sits, so the "gallery track light" look isn't just implied.
  var frameMat = new THREE.MeshStandardMaterial({ color: MUSEUM_FRAME, roughness: 0.4, metalness: 0.55 });
  var fixtureMat = new THREE.MeshStandardMaterial({ color: SPOT_COLOR, emissive: SPOT_COLOR, emissiveIntensity: 1.8, roughness: 0.4 });
  // A faint clearcoated pane in front of every picture -- glass-covered
  // museum prints, not bare paper. depthWrite:false keeps it from fighting
  // the opaque picture plane it sits just in front of during transparency
  // sorting.
  var glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide, depthWrite: false
  });
  var FRAME_DEPTH = 10;
  var SPOT_BASE = 1000, SPOT_NEAR = 1800;
  // The picture itself is sized to fit inside this box (preserving its own
  // aspect ratio, never cropped or stretched) -- landscape photos use the
  // full width and a shorter height, portraits use the full height and a
  // narrower width. The frame/glass/light are all then derived from
  // whatever size the picture actually ends up.
  var MAX_PIC_W = EXHIBIT_W - 14, MAX_PIC_H = 210;
  var FRAME_BORDER = 16, GLASS_MARGIN = 4;

  var exhibits = data.map(function (item, i) {
    var side = i % 2 === 0 ? 'left' : 'right';
    var logicalZ = START_PAD + i * EXHIBIT_SPACING;
    var x = side === 'left' ? -(CORRIDOR_WIDTH / 2 - EXHIBIT_INSET) : (CORRIDOR_WIDTH / 2 - EXHIBIT_INSET);
    var y = EYE_HEIGHT + 20;

    var group = new THREE.Group();
    group.position.set(x, y, -logicalZ);
    group.rotation.y = side === 'left' ? Math.PI / 2 : -Math.PI / 2;
    scene.add(group);

    var frameMesh = new THREE.Mesh(new THREE.BoxGeometry(EXHIBIT_W + 18, EXHIBIT_H + 18, FRAME_DEPTH), frameMat);
    frameMesh.position.z = FRAME_DEPTH / 2;
    group.add(frameMesh);

    var picMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    var picMesh = new THREE.Mesh(new THREE.PlaneGeometry(EXHIBIT_W - 14, EXHIBIT_H - 14), picMat);
    // Must sit just IN FRONT of the frame box's own front face (z=FRAME_DEPTH),
    // not behind it -- frameMesh is a solid box, so a picMesh recessed inside
    // its volume was fully hidden behind the frame's opaque front face and
    // could never be seen no matter what texture was on it. This was the
    // actual bug behind "images don't show up," not lighting or aspect ratio.
    picMesh.position.z = FRAME_DEPTH + 0.5;
    group.add(picMesh);

    var glassMesh = new THREE.Mesh(new THREE.PlaneGeometry(EXHIBIT_W - 6, EXHIBIT_H - 6), glassMat);
    glassMesh.position.z = FRAME_DEPTH + 0.8;
    group.add(glassMesh);

    var fixtureY = (EXHIBIT_H + 18) / 2 + 18;
    var fixture = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 10), fixtureMat);
    fixture.position.set(0, fixtureY, 16);
    group.add(fixture);

    var spot = new THREE.SpotLight(SPOT_COLOR, SPOT_BASE, 260, 0.55, 0.65, 1);
    spot.position.set(0, fixtureY, 16);
    spot.target.position.set(0, -8, FRAME_DEPTH);
    group.add(spot, spot.target);

    if (item.image) {
      new THREE.TextureLoader().load(item.image, function (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;

        // object-fit: contain, done by hand -- resize the frame to the
        // image's own aspect ratio (capped to MAX_PIC_W x MAX_PIC_H) instead
        // of cropping or stretching the image to a fixed frame shape.
        var imgAspect = tex.image.width / tex.image.height;
        var maxAspect = MAX_PIC_W / MAX_PIC_H;
        var picW, picH;
        if (imgAspect >= maxAspect) { picW = MAX_PIC_W; picH = MAX_PIC_W / imgAspect; }
        else { picH = MAX_PIC_H; picW = MAX_PIC_H * imgAspect; }

        picMesh.geometry.dispose();
        picMesh.geometry = new THREE.PlaneGeometry(picW, picH);

        glassMesh.geometry.dispose();
        glassMesh.geometry = new THREE.PlaneGeometry(picW + GLASS_MARGIN * 2, picH + GLASS_MARGIN * 2);

        var frameH = picH + FRAME_BORDER * 2;
        frameMesh.geometry.dispose();
        frameMesh.geometry = new THREE.BoxGeometry(picW + FRAME_BORDER * 2, frameH, FRAME_DEPTH);

        // The light fixture is mounted relative to the frame's own top edge,
        // so a taller (portrait) frame automatically pushes its light higher
        // and a shorter (wide landscape) frame pulls it back down, instead
        // of the fixture staying fixed at the original frame height.
        var fixtureY = frameH / 2 + 18;
        fixture.position.y = fixtureY;
        spot.position.y = fixtureY;
        spot.target.position.y = -frameH * 0.05;

        picMat.map = tex;
        picMat.needsUpdate = true;
      }, undefined, function (err) {
        console.warn('exhibit image failed to load:', item.image, err);
        picMat.color.set(0xffffff);
        picMat.map = makeTextTexture('[ image failed to load ]', '#c0392b', '#100e0c');
        picMat.needsUpdate = true;
      });
    }

    return {
      // z stored in the same world-space sign as posZ below (negative, growing
      // more negative deeper into the corridor) so proximity checks need no
      // extra sign-juggling against the player's position.
      x: x, z: -logicalZ, spot: spot, picMat: picMat, hasImage: !!item.image,
      year: item.year, title: item.title, blurb: item.blurb
    };
  });

  // --- first-person body: attached to the yaw-only rig (not the pitching
  // camera), positioned below/behind the eye, so tilting the camera down
  // naturally brings it into frame -- no manual show/hide needed.
  // Z is POSITIVE here (behind the camera's local origin, opposite the -Z
  // "forward" direction the camera looks down) -- that's deliberate, not a
  // typo: a box positioned in front of the camera (negative Z) has its
  // forward-facing (chest) side pointed away from the camera, so looking
  // down at it shows its far/back side instead. Placing it behind puts the
  // forward-facing side toward the camera, so pitching down reveals the
  // chest, matching how a real FPS view-body is anchored behind/below the
  // eye rather than out in front of it. ---
  // A faceless robot chassis, not a human figure -- colored from the site's
  // own fixed palette (the same cream/slate pairing --soft and --bg swap
  // between the light/dark themes, see the MUSEUM_BG note above for why the
  // museum's colors are hard-coded rather than theme-reactive) so it reads
  // as *this site's* robot rather than a generic gunmetal-grey one. Cream is
  // the dominant color (torso + head, the largest visible masses), slate is
  // the limb color for contrast, and the joints glow in the site's own
  // --accent blue.
  var ROBOT_CREAM = 0xd6d2c4;
  var ROBOT_SLATE = 0x333f48;
  var accentColor = solidColor('--accent');
  var torsoMat = new THREE.MeshStandardMaterial({ color: ROBOT_CREAM, roughness: 0.5, metalness: 0.35 });
  var limbMat = new THREE.MeshStandardMaterial({ color: ROBOT_SLATE, roughness: 0.45, metalness: 0.4 });
  var jointMat = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.35, metalness: 0.7 });
  var glowMat = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 1.8, roughness: 0.4, metalness: 0.2 });
  var bodyGroup = new THREE.Group();

  var torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(34, 58, 18), torsoMat);
  torsoMesh.position.set(0, 96, 12);
  bodyGroup.add(torsoMesh);

  // A name badge styled like a periodic table cell -- iron, atomic number
  // 26, to match the 26 orbiting electrons. Drawn onto a canvas (same
  // technique as makeTextTexture above) rather than modeled, since it's all
  // flat printed detail. Sits just in front of the torso's own front face
  // (local z=-9, NOT +9: the torso sits at world z=12 while the camera
  // sits at z=0, so the face actually closest to -- and facing -- the
  // camera/mirror is the negative-z one, confirmed by rendering a
  // standalone camera looking at the torso from each side directly). Also
  // needs an explicit 180° turn: PlaneGeometry defaults to facing +Z, and
  // unlike a solid shape, a plane only renders from the side its normal
  // actually points toward.
  function makeElementBadgeTexture() {
    var c = document.createElement('canvas');
    // 2x the size actually needed at this plane's on-screen scale, plus
    // anisotropic filtering below -- a small source canvas was the reason
    // the text read soft/blurry, especially reflected in the mirror.
    c.width = 256; c.height = 320;
    var ctx = c.getContext('2d');
    // Slate-on-cream, not cream-on-cream -- cream would blend straight into
    // the torso's own identical color, leaving only a thin border visible.
    ctx.fillStyle = '#333f48';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#d6d2c4';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
    ctx.fillStyle = '#d6d2c4';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '600 44px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText('26', 24, 20);
    ctx.textAlign = 'center';
    ctx.font = '700 120px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText('Fe', c.width / 2, 80);
    ctx.font = '600 32px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText('iron', c.width / 2, 244);
    ctx.font = '500 26px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText('55.845', c.width / 2, 280);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }
  var badgeMat = new THREE.MeshStandardMaterial({ map: makeElementBadgeTexture(), roughness: 0.5, metalness: 0.1 });
  var badgeMesh = new THREE.Mesh(new THREE.PlaneGeometry(15, 18.75), badgeMat);
  badgeMesh.position.set(0, 15, -10);
  badgeMesh.rotation.y = Math.PI;
  torsoMesh.add(badgeMesh);

  // A shared motor housing (dark drum + glowing ring, axle aligned with the
  // actual swing axis) dropped at a pivot's own origin -- reused at every
  // hip/knee/shoulder/elbow joint below.
  function addMotor(pivot, radius) {
    var motor = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, radius * 0.85, 12), jointMat);
    motor.rotation.z = Math.PI / 2;
    pivot.add(motor);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.7, radius * 0.14, 8, 16), glowMat);
    ring.rotation.y = Math.PI / 2;
    pivot.add(ring);
  }

  // Two-segment limb: an outer pivot (hip/shoulder) holds the upper segment,
  // with a second pivot (knee/elbow) hanging off its bottom end holding the
  // lower segment -- each pivot anchored at its own joint with its mesh
  // offset downward inside it, so rotating either bends the limb like a
  // real hinge at that specific joint, instead of the whole limb only ever
  // pivoting as one rigid piece from the hip/shoulder.
  function buildLimb(mat, thickness, upperLen, lowerLen, x, topY, z, outerMotorR, innerMotorR) {
    var outer = new THREE.Group();
    outer.position.set(x, topY, z);
    addMotor(outer, outerMotorR);
    var upperMesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, upperLen, thickness), mat);
    upperMesh.position.y = -upperLen / 2;
    outer.add(upperMesh);

    var inner = new THREE.Group();
    inner.position.y = -upperLen;
    addMotor(inner, innerMotorR);
    // Lower segment slightly thinner than the upper one -- a tapered limb
    // reads more like an articulated machine than a stack of equal boxes.
    var lowerMesh = new THREE.Mesh(new THREE.BoxGeometry(thickness * 0.8, lowerLen, thickness * 0.8), mat);
    lowerMesh.position.y = -lowerLen / 2;
    inner.add(lowerMesh);
    outer.add(inner);

    bodyGroup.add(outer);
    return { outer: outer, inner: inner, lowerLen: lowerLen };
  }

  var legL = buildLimb(limbMat, 13, 34, 28, -10, 65, 10, 11, 8.5);
  var legR = buildLimb(limbMat, 13, 34, 28, 10, 65, 10, 11, 8.5);
  var armL = buildLimb(limbMat, 10, 28, 22, -23, 117, 12, 8, 6);
  var armR = buildLimb(limbMat, 10, 28, 22, 23, 117, 12, 8, 6);
  var leftLeg = legL.outer, leftKnee = legL.inner;
  var rightLeg = legR.outer, rightKnee = legR.inner;
  var leftArm = armL.outer, leftElbow = armL.inner;
  var rightArm = armR.outer, rightElbow = armR.inner;

  // Fist caps close off each arm's open end -- without them the arms just
  // stop mid-air at the last segment's bare edge.
  [armL, armR].forEach(function (arm) {
    var hand = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 10), jointMat);
    hand.position.y = -arm.lowerLen - 3;
    arm.inner.add(hand);
  });

  // A floating orb head, deliberately detached from the torso with a visible
  // gap instead of a neck -- reads as futuristic rather than humanoid, and
  // gives the mirror something to actually show above the shoulders (there
  // was no head at all before). It bobs on its own slow idle cycle (see
  // updateHeadBob below), independent of the walk animation, since it's
  // ambient life rather than a footstep effect.
  var HEAD_BASE_Y = 148;
  var headGroup = new THREE.Group();
  headGroup.position.set(0, HEAD_BASE_Y, 6);
  var headMat = new THREE.MeshStandardMaterial({ color: ROBOT_CREAM, roughness: 0.45, metalness: 0.35 });
  var headCore = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 18), headMat);
  headGroup.add(headCore);

  // "Atom" accent: small electrons orbiting the head, in place of the halo
  // ring (which read as an obvious, distracting shape up close -- the head
  // sits only ~10 units from the player's own camera). These live on their
  // own render layer that the main camera never enables, so they're
  // invisible in normal first-person play; only the mirror's reflection
  // camera (set up below, right after the mirror itself) has that layer
  // turned on, so the atom look is a payoff for checking yourself out in
  // the mirror, not clutter in your own view.
  var ELECTRON_LAYER = 1;
  // A dedicated material, separate from glowMat (shared with the opaque
  // joint rings) -- transparent so the electrons read as a soft, hazy
  // cloud rather than solid little balls.
  var electronMat = new THREE.MeshStandardMaterial({
    color: accentColor, emissive: accentColor, emissiveIntensity: 1.8,
    roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.125
  });
  var electronOrbits = [];
  function addElectronOrbit(tiltX, tiltZ, radius, speed) {
    var pivot = new THREE.Group();
    pivot.rotation.set(tiltX, 0, tiltZ);
    var electron = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), electronMat);
    electron.position.x = radius;
    electron.layers.set(ELECTRON_LAYER);
    pivot.add(electron);
    headGroup.add(pivot);
    electronOrbits.push({ pivot: pivot, speed: speed });
  }
  // Iron, atomic number 26 -- one orbit per electron. Tilts are spread
  // evenly over a sphere (the golden-angle spiral, a standard trick for
  // scattering N points on a sphere without visible clumping or banding)
  // rather than picked by hand, since hand-picking 26 distinct tilts isn't
  // practical; radius/speed still vary a little per electron so the whole
  // cloud doesn't read as one rigid, uniformly-spinning shell.
  var ELECTRON_COUNT = 26;
  var GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  for (var ei = 0; ei < ELECTRON_COUNT; ei++) {
    var tiltX = Math.acos(1 - (2 * (ei + 0.5)) / ELECTRON_COUNT) - Math.PI / 2;
    var tiltZ = ei * GOLDEN_ANGLE;
    var eRadius = 18 + (ei % 4) * 1.2;
    var eSpeed = (0.8 + (ei % 5) * 0.3) * (ei % 2 === 0 ? 1 : -1);
    addElectronOrbit(tiltX, tiltZ, eRadius, eSpeed);
  }
  function updateElectrons(dt) {
    electronOrbits.forEach(function (o) { o.pivot.rotation.y += dt * o.speed; });
  }

  bodyGroup.add(headGroup);

  rig.add(bodyGroup);

  // --- walk-cycle animation: legs/arms swing from those hip/shoulder
  // pivots in opposite phase (left leg forward = right arm forward, like a
  // real gait), driven by how far the player has actually walked rather
  // than wall-clock time, so the stride rate naturally speeds up with
  // sprint and freezes the instant you stop instead of animating in place.
  var WALK_CYCLE_PER_UNIT = 2 * Math.PI / 170;
  var LEG_SWING_AMP = 0.55;
  var ARM_SWING_SCALE = 0.8;
  var KNEE_BEND_AMP = 0.9;
  var ELBOW_BEND_AMP = 0.35;
  var walkPhase = 0, walkSwing = 0;
  function updateWalkAnimation(dt, distanceMoved) {
    var target = 0;
    if (distanceMoved > 0) {
      walkPhase += distanceMoved * WALK_CYCLE_PER_UNIT;
      target = Math.sin(walkPhase) * LEG_SWING_AMP;
    }
    // Ease toward the target instead of snapping -- smooths both the
    // start of a stride and the moment you stop moving.
    walkSwing += (target - walkSwing) * Math.min(dt * 10, 1);
    leftLeg.rotation.x = walkSwing;
    rightLeg.rotation.x = -walkSwing;
    leftArm.rotation.x = -walkSwing * ARM_SWING_SCALE;
    rightArm.rotation.x = walkSwing * ARM_SWING_SCALE;
    // Knees/elbows bend only while their own limb is swinging forward (not
    // through the backward/stance half of the cycle), like a leg lifting to
    // clear the ground mid-stride rather than staying rigid throughout.
    var swingFrac = walkSwing / LEG_SWING_AMP;
    leftKnee.rotation.x = KNEE_BEND_AMP * Math.max(0, swingFrac);
    rightKnee.rotation.x = KNEE_BEND_AMP * Math.max(0, -swingFrac);
    leftElbow.rotation.x = ELBOW_BEND_AMP * Math.max(0, -swingFrac);
    rightElbow.rotation.x = ELBOW_BEND_AMP * Math.max(0, swingFrac);
  }

  // --- idle head-bob: a slow, constant hover independent of walking, so the
  // floating head reads as alive even standing still.
  var HEAD_BOB_SPEED = 1.6;
  var HEAD_BOB_AMP = 3;
  var headBobPhase = 0;
  function updateHeadBob(dt) {
    headBobPhase += dt * HEAD_BOB_SPEED;
    headGroup.position.y = HEAD_BASE_Y + Math.sin(headBobPhase) * HEAD_BOB_AMP;
  }

  // --- potted plants: one per exhibit, on the opposite wall, set a bit
  // before the exhibit so it registers as you approach rather than blocking
  // the view once you're facing the picture straight on. ---
  var potMat = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.85, metalness: 0.1 });
  var foliageMat = new THREE.MeshStandardMaterial({ color: 0x1f3d24, roughness: 0.85, metalness: 0, emissive: 0x0a1a0d, emissiveIntensity: 0.2 });
  function buildPlant(x, z) {
    var group = new THREE.Group();
    var pot = new THREE.Mesh(new THREE.CylinderGeometry(16, 12, 28, 10), potMat);
    pot.position.y = 14;
    group.add(pot);
    for (var c = 0; c < 6; c++) {
      var s = 15 + (c % 3) * 6;
      var leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), foliageMat);
      var ang = (c / 6) * Math.PI * 2;
      leaf.position.set(Math.cos(ang) * 10, 46 + (c % 3) * 10, Math.sin(ang) * 10);
      leaf.rotation.set(ang, ang * 1.3, ang * 0.7);
      group.add(leaf);
    }
    group.position.set(x, 0, z);
    scene.add(group);
  }
  // Plants are placed later, at each ceiling beam's own z position (see the
  // bay loop below) -- not here at an exhibit-relative offset -- so they
  // read as centered on the beams instead of scattered near the pictures.

  // --- ceiling light fixtures + architectural rhythm: pilasters and a
  // ceiling beam at each bay boundary -- a plain flat wall/ceiling becomes
  // a sequence of bays instead of one featureless box, like walking past
  // structural bays in a real gallery, not just pictures on a blank hall.
  // Warm wood beams/trim (lodge) against the dark bronze pilasters/frames
  // (modern gallery) is the deliberate mix -- not everything switched to
  // wood, just the horizontal structure, so both languages stay legible. ---
  var ceilingLightMat = new THREE.MeshStandardMaterial({ color: 0xfff6e6, emissive: 0xfff6e6, emissiveIntensity: 1.5, roughness: 1, metalness: 0 });
  var woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.78, metalness: 0.04, emissive: 0x1a0e06, emissiveIntensity: 0.25 });
  var lanternMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.7 });
  var lanternGlowMat = new THREE.MeshStandardMaterial({ color: 0xffb066, emissive: 0xffb066, emissiveIntensity: 1.4, roughness: 0.5 });
  var PILASTER_D = 16, PILASTER_W = 34;
  // Square cross-section (was a flatter 22x30 slab) -- a visibly thicker,
  // more substantial-looking beam.
  var BEAM_H = 32, BEAM_D = 32;

  function buildLantern(xSign, x, y, z) {
    var group = new THREE.Group();
    group.position.set(x, y, z);
    var reach = 18; // how far it projects off the pilaster into the room
    var innerX = -xSign * reach;
    var arm = new THREE.Mesh(new THREE.BoxGeometry(reach, 4, 4), lanternMat);
    arm.position.x = innerX / 2;
    group.add(arm);
    var cage = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 20, 8, 1, true), lanternMat);
    cage.position.x = innerX;
    group.add(cage);
    var glow = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 16, 8), lanternGlowMat);
    glow.position.x = innerX;
    group.add(glow);
    var cap = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 3, 8), lanternMat);
    cap.position.set(innerX, 11, 0);
    group.add(cap);
    var light = new THREE.PointLight(0xffb066, 130, 280, 1);
    light.position.set(innerX, 0, 0);
    group.add(light);
    scene.add(group);
  }

  for (var li = 0; li <= data.length; li++) {
    // Centered exactly on the midpoint between the exhibits on either side
    // of it (or the entrance/end for the two outer beams) -- with
    // START_PAD = EXHIBIT_SPACING / 2, this formula and the exhibits'
    // own -(START_PAD + i*EXHIBIT_SPACING) placement land every exhibit
    // exactly halfway between the beam before it and the beam after it.
    var lz = -(START_PAD + (li - 0.5) * EXHIBIT_SPACING);
    var fixturePanel = new THREE.Mesh(new THREE.BoxGeometry(80, 6, 24), ceilingLightMat);
    fixturePanel.position.set(0, WALL_HEIGHT - 5, lz);
    scene.add(fixturePanel);
    var roofLight = new THREE.PointLight(0xfff2df, 150, CORRIDOR_WIDTH * 1.5, 1);
    roofLight.position.set(0, WALL_HEIGHT - 20, lz);
    scene.add(roofLight);

    var beam = new THREE.Mesh(new THREE.BoxGeometry(CORRIDOR_WIDTH, BEAM_H, BEAM_D), woodMat);
    beam.position.set(0, WALL_HEIGHT - BEAM_H / 2 - 24, lz);
    scene.add(beam);

    // Bays alternate whole-bay: lanterns on BOTH walls (parallel, facing
    // each other) at every other bay, plants on both walls at the ones in
    // between -- not a lantern-left/plant-right split within the same bay.
    var isLanternBay = li % 2 === 0;
    [-1, 1].forEach(function (xSign) {
      var pilaster = new THREE.Mesh(new THREE.BoxGeometry(PILASTER_D, WALL_HEIGHT, PILASTER_W), frameMat);
      pilaster.position.set(xSign * (CORRIDOR_WIDTH / 2 - PILASTER_D / 2), WALL_HEIGHT / 2, lz);
      scene.add(pilaster);
      if (isLanternBay) {
        buildLantern(xSign, xSign * (CORRIDOR_WIDTH / 2 - PILASTER_D), WALL_HEIGHT * 0.42, lz);
      } else {
        buildPlant(xSign * (CORRIDOR_WIDTH / 2 - 40), lz);
      }
    });
  }

  // Baseboard + crown moulding along both walls, running the full corridor
  // length, in the same warm wood as the beams -- grounds the room at the
  // floor and caps it at the ceiling instead of walls meeting floor/ceiling
  // at a bare seam, and ties the horizontal trim to the beams overhead.
  [-1, 1].forEach(function (xSign) {
    var baseboard = new THREE.Mesh(new THREE.BoxGeometry(10, 16, CORRIDOR_LENGTH), woodMat);
    baseboard.position.set(xSign * (CORRIDOR_WIDTH / 2 - 5), 8, -CORRIDOR_LENGTH / 2);
    scene.add(baseboard);
    var crown = new THREE.Mesh(new THREE.BoxGeometry(14, 12, CORRIDOR_LENGTH), woodMat);
    crown.position.set(xSign * (CORRIDOR_WIDTH / 2 - 7), WALL_HEIGHT - 6, -CORRIDOR_LENGTH / 2);
    scene.add(crown);
  });

  // --- a shallow foyer behind the entrance threshold, purely so the mirror
  // has somewhere to actually sit "in the wall" instead of floating right at
  // the spot the player spawns/stands. Deliberately open-ended past its own
  // back edge (no end cap) for the same reason the doorway itself has no
  // full wall panel below -- see that note for why solid geometry there
  // would block the Reflector's virtual camera.
  var VESTIBULE_DEPTH = 70;
  var vestibuleFloor = new THREE.Mesh(new THREE.PlaneGeometry(CORRIDOR_WIDTH, VESTIBULE_DEPTH), floorMat);
  vestibuleFloor.rotation.x = -Math.PI / 2;
  vestibuleFloor.position.set(0, 0, VESTIBULE_DEPTH / 2);
  scene.add(vestibuleFloor);
  var vestibuleCeiling = new THREE.Mesh(new THREE.PlaneGeometry(CORRIDOR_WIDTH, VESTIBULE_DEPTH), wallMat);
  vestibuleCeiling.rotation.x = Math.PI / 2;
  vestibuleCeiling.position.set(0, WALL_HEIGHT, VESTIBULE_DEPTH / 2);
  scene.add(vestibuleCeiling);
  [-1, 1].forEach(function (xSign) {
    var stub = new THREE.Mesh(new THREE.PlaneGeometry(VESTIBULE_DEPTH, WALL_HEIGHT), wallMat);
    stub.rotation.y = xSign > 0 ? -Math.PI / 2 : Math.PI / 2;
    stub.position.set(xSign * CORRIDOR_WIDTH / 2, WALL_HEIGHT / 2, VESTIBULE_DEPTH / 2);
    scene.add(stub);
  });

  // --- mirror at the spawn end: gives a real payoff for looking back at the
  // doorway. Deliberately NO solid wall panel spanning the full entrance
  // (unlike the far end's endWallMesh) -- a THREE.Reflector works by placing
  // a virtual camera on the opposite side of the mirror plane from the real
  // camera, so with the real camera inside the corridor, that virtual
  // camera ends up outside it, looking back in. Any solid geometry spanning
  // the full entrance would sit directly in that virtual camera's line of
  // sight and block the reflection with its own (opaque, near-black-lit)
  // backside -- which is exactly what happened when a full entranceWallMesh
  // was here. The pilasters, baseboard and crown at this same z already
  // read as an entrance threshold without fully closing it off. ---
  var MIRROR_W = 200, MIRROR_H = 260, MIRROR_Y = 200;
  // Positive Z, set back inside the foyer above -- and, just as importantly,
  // outside the player's own movement clamp, which maxes posZ out at 0 (see
  // the tick() movement code below). That's what actually fixes "I spawn
  // inside the mirror" / "I can walk through it": the player physically
  // cannot reach this position at all, not just visually discouraged from
  // reaching it.
  var MIRROR_Z = VESTIBULE_DEPTH - 14;
  var BORDER_T = 16, BORDER_D = 8;
  // A picture-frame BORDER (4 strips around the edge), not a solid backing
  // panel -- a solid panel behind the mirror's own footprint (even a thin
  // one) fully blocks the Reflector's virtual camera, which sits on the
  // opposite side of the mirror from the real viewer and needs a clear line
  // of sight back through it. Border strips sit entirely outside that
  // footprint, so they frame the mirror without ever occluding it.
  function mirrorBorderPiece(w, h, x, y) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, BORDER_D), frameMat);
    m.position.set(x, y, MIRROR_Z - BORDER_D / 2);
    scene.add(m);
  }
  mirrorBorderPiece(MIRROR_W + BORDER_T * 2, BORDER_T, 0, MIRROR_Y + MIRROR_H / 2 + BORDER_T / 2);
  mirrorBorderPiece(MIRROR_W + BORDER_T * 2, BORDER_T, 0, MIRROR_Y - MIRROR_H / 2 - BORDER_T / 2);
  mirrorBorderPiece(BORDER_T, MIRROR_H, -(MIRROR_W / 2 + BORDER_T / 2), MIRROR_Y);
  mirrorBorderPiece(BORDER_T, MIRROR_H, MIRROR_W / 2 + BORDER_T / 2, MIRROR_Y);

  // A real reflection means a full extra scene render every frame it's in
  // view -- keep that cheap: modest resolution, no multisampling (default
  // is 4x), since this is a stylized low-poly scene, not a showcase render.
  var mirror = new Reflector(new THREE.PlaneGeometry(MIRROR_W, MIRROR_H), {
    color: 0x889a9a,
    textureWidth: 512,
    textureHeight: 512,
    clipBias: 0.01,
    multisample: 0
  });
  mirror.position.set(0, MIRROR_Y, MIRROR_Z - 0.5);
  mirror.rotation.y = Math.PI; // face -Z, back into the corridor toward the player
  scene.add(mirror);

  // Reflector normally clones its internal reflection camera lazily, from
  // the real camera, the first time it renders -- force that now (it's
  // cached from here on) so the electrons' layer can be turned on for this
  // one camera specifically, without ever touching the main camera's own
  // layers (which is what keeps them hidden from the player directly).
  mirror.getReflectionCamera(camera).layers.enable(ELECTRON_LAYER);

  // Placeholder pictures get a fixed dark-gallery tint rather than the
  // site's --dim/--bg vars, matching the museum's deliberately fixed
  // atmosphere -- see the note by MUSEUM_BG above on why the 3D scene
  // doesn't follow the site's light/dark toggle.
  exhibits.forEach(function (e) {
    if (e.hasImage) return;
    e.picMat.map = makeTextTexture('[ photo ]', '#9a8f7c', '#100e0c');
    e.picMat.needsUpdate = true;
  });

  // --- camera / movement state ---------------------------------------------
  // posX/posZ are the rig's actual world position (three.js's native -Z-is-
  // forward convention, not the CSS build's inverted "move the world" one).
  var posX = 0, posZ = 0, posY = 0, velY = 0, onGround = true, yaw = 0, pitch = 0;
  var mode, rafId = null, lastTs = 0, nearestIndex = -1;
  var heldSources = {
    forward: { key: false, pointer: false },
    back: { key: false, pointer: false },
    strafeLeft: { key: false, pointer: false },
    strafeRight: { key: false, pointer: false },
    turnLeft: { key: false },
    turnRight: { key: false },
    sprint: { key: false }
  };
  function isHeld(name) { var s = heldSources[name]; return !!(s.key || s.pointer); }
  function setHeld(name, val, source) { heldSources[name][source] = val; }
  function releaseAllKeyHeld() { for (var k in heldSources) heldSources[k].key = false; }

  function applyCamera() {
    rig.position.set(posX, posY, posZ);
    rig.rotation.y = -yaw * Math.PI / 180;
    camera.rotation.x = pitch * Math.PI / 180;
  }

  function tryJump() {
    if (mode === 'scene3d' && onGround) { velY = JUMP_SPEED; onGround = false; }
  }

  function updateCaption() {
    var nearest = -1, nearestDist = Infinity;
    for (var i = 0; i < exhibits.length; i++) {
      var e = exhibits[i];
      var dist = Math.sqrt((posX - e.x) * (posX - e.x) + (posZ - e.z) * (posZ - e.z));
      var inRange = dist < PROXIMITY;
      // The approach itself is the "highlight" now -- the picture's own
      // spotlight brightens as you near it, rather than a colored outline.
      e.spot.intensity = inRange ? SPOT_NEAR : SPOT_BASE;
      if (inRange && dist < nearestDist) { nearestDist = dist; nearest = i; }
    }
    if (nearest === nearestIndex) return;
    nearestIndex = nearest;
    if (nearest === -1) { captionOverlay.classList.remove('visible'); return; }
    var e = exhibits[nearest];
    overlayYear.textContent = e.year;
    overlayTitle.textContent = e.title;
    fillBlurb(overlayBlurb, e.blurb);
    captionOverlay.hidden = false;
    captionOverlay.classList.add('visible');
  }

  // Movement basis comes straight from the rig's own rotation matrix (via
  // three.js's getWorldDirection) rather than a hand-derived trig formula --
  // that way it can never drift out of sync with which way the rig actually
  // renders as facing, which is exactly the kind of mismatch a second,
  // independently-typed sign convention caused here once already.
  var _fwd = new THREE.Vector3();
  var _right = new THREE.Vector3();
  var _up = new THREE.Vector3(0, 1, 0);

  function tick(now) {
    if (mode !== 'scene3d') return;
    var dt = Math.min((now - lastTs) / 1000, 0.05);
    lastTs = now;

    var turn = (isHeld('turnRight') ? 1 : 0) - (isHeld('turnLeft') ? 1 : 0);
    if (turn !== 0) {
      yaw += turn * TURN_SPEED_DEG_PER_SEC * dt;
      yaw = ((yaw % 360) + 360) % 360;
      rig.rotation.y = -yaw * Math.PI / 180;
    }

    var moveF = (isHeld('forward') ? 1 : 0) - (isHeld('back') ? 1 : 0);
    var moveR = (isHeld('strafeRight') ? 1 : 0) - (isHeld('strafeLeft') ? 1 : 0);
    var distanceMoved = 0;
    if (moveF !== 0 || moveR !== 0) {
      // THREE.Camera (unlike a plain Object3D such as `rig`) overrides
      // getWorldDirection to negate the axis, since cameras look down local
      // -Z by convention -- reading from `camera` here (not `rig`) matters,
      // confirmed by the two disagreeing when tested side by side.
      camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() > 0) _fwd.normalize();
      _right.crossVectors(_fwd, _up).normalize();
      var speed = SPEED_PER_SEC * (isHeld('sprint') ? SPRINT_MULT : 1);
      var prevX = posX, prevZ = posZ;
      posX += (_fwd.x * moveF + _right.x * moveR) * speed * dt;
      posZ += (_fwd.z * moveF + _right.z * moveR) * speed * dt;
      posX = clamp(posX, -(CORRIDOR_WIDTH / 2 - PLAYER_RADIUS), CORRIDOR_WIDTH / 2 - PLAYER_RADIUS);
      posZ = clamp(posZ, -(CORRIDOR_LENGTH - PLAYER_RADIUS), 0);
      distanceMoved = Math.hypot(posX - prevX, posZ - prevZ);
    }
    updateWalkAnimation(dt, distanceMoved);
    updateHeadBob(dt);
    updateElectrons(dt);

    velY -= GRAVITY * dt;
    posY += velY * dt;
    if (posY <= 0) { posY = 0; velY = 0; onGround = true; }

    applyCamera();
    updateCaption();
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId !== null) return;
    lastTs = performance.now();
    rafId = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    for (var k in heldSources) {
      heldSources[k].key = false;
      if ('pointer' in heldSources[k]) heldSources[k].pointer = false;
    }
  }

  function updateControlsVisibility() { controls.classList.toggle('visible', mode === 'scene3d'); }

  // --- keyboard: WASD + Arrow keys ------------------------------------------
  var KEY_MOVE = { w: 'forward', W: 'forward', ArrowUp: 'forward', s: 'back', S: 'back', ArrowDown: 'back', a: 'strafeLeft', A: 'strafeLeft', d: 'strafeRight', D: 'strafeRight' };
  var KEY_TURN = { ArrowLeft: 'turnLeft', ArrowRight: 'turnRight' };
  document.addEventListener('keydown', function (e) {
    if (mode !== 'scene3d') return;
    if (KEY_MOVE[e.key]) { e.preventDefault(); setHeld(KEY_MOVE[e.key], true, 'key'); }
    else if (KEY_TURN[e.key]) { e.preventDefault(); setHeld(KEY_TURN[e.key], true, 'key'); }
    else if (e.key === 'Shift') { setHeld('sprint', true, 'key'); }
    else if (e.code === 'Space') { e.preventDefault(); tryJump(); }
  });
  document.addEventListener('keyup', function (e) {
    if (KEY_MOVE[e.key]) setHeld(KEY_MOVE[e.key], false, 'key');
    else if (KEY_TURN[e.key]) setHeld(KEY_TURN[e.key], false, 'key');
    else if (e.key === 'Shift') setHeld('sprint', false, 'key');
  });
  window.addEventListener('blur', releaseAllKeyHeld);
  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAllKeyHeld(); });

  // --- desktop mouselook via Pointer Lock ------------------------------------
  var pointerLockSupported = !!sceneEl.requestPointerLock;
  if (pointerLockSupported) {
    sceneEl.addEventListener('click', function () {
      if (mode !== 'scene3d') return;
      if (document.pointerLockElement !== sceneEl) sceneEl.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', function () {
      var locked = document.pointerLockElement === sceneEl;
      lookPrompt.hidden = locked || mode !== 'scene3d';
      if (locked) document.addEventListener('mousemove', onMouseLook);
      else document.removeEventListener('mousemove', onMouseLook);
    });
    document.addEventListener('pointerlockerror', function () {
      lookPrompt.hidden = mode !== 'scene3d';
    });
  }
  // Some browsers report an implausibly large movementX/Y on the first
  // mousemove after (re)acquiring pointer lock -- a known Pointer Lock API
  // quirk, not real mouse motion. Capping the per-event delta filters out
  // that spike (and any other stray outlier) without affecting normal
  // look-around, since a real mouse rarely moves this far between two
  // consecutive raw move events.
  var MAX_MOUSE_DELTA = 120;
  function onMouseLook(e) {
    var dx = clamp(e.movementX, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
    var dy = clamp(e.movementY, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
    yaw += dx * MOUSE_LOOK_SENSITIVITY;
    yaw = ((yaw % 360) + 360) % 360;
    pitch = clamp(pitch - dy * MOUSE_LOOK_SENSITIVITY, PITCH_MIN, PITCH_MAX);
  }

  // --- mobile drag-to-look ---------------------------------------------------
  var lookPointerId = null, lastLookX = 0, lastLookY = 0;
  sceneEl.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch' || lookPointerId !== null || mode !== 'scene3d') return;
    lookPointerId = e.pointerId; lastLookX = e.clientX; lastLookY = e.clientY;
  });
  sceneEl.addEventListener('pointermove', function (e) {
    if (e.pointerId !== lookPointerId) return;
    yaw += (e.clientX - lastLookX) * TOUCH_LOOK_SENSITIVITY;
    yaw = ((yaw % 360) + 360) % 360;
    pitch = clamp(pitch - (e.clientY - lastLookY) * TOUCH_LOOK_SENSITIVITY, PITCH_MIN, PITCH_MAX);
    lastLookX = e.clientX; lastLookY = e.clientY;
  });
  ['pointerup', 'pointercancel'].forEach(function (type) {
    sceneEl.addEventListener(type, function (e) { if (e.pointerId === lookPointerId) lookPointerId = null; });
  });

  // --- mobile D-pad ------------------------------------------------------------
  var MOVE_KEY = { forward: 'forward', back: 'back', 'strafe-left': 'strafeLeft', 'strafe-right': 'strafeRight' };
  var dpadButtons = controls.querySelectorAll('.dpad-btn');
  Array.prototype.forEach.call(dpadButtons, function (btn) {
    var move = btn.getAttribute('data-move');
    if (move === 'jump') {
      // A discrete trigger, not a held-movement axis -- one jump per tap,
      // same as the Space key, not "hold to keep jumping."
      btn.addEventListener('pointerdown', function (e) { e.preventDefault(); tryJump(); });
      return;
    }
    var name = MOVE_KEY[move];
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      setHeld(name, true, 'pointer');
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      btn.addEventListener(type, function () { setHeld(name, false, 'pointer'); });
    });
  });

  function activateMode(m) {
    mode = m;
    if (m === 'scene3d') {
      sceneEl.hidden = false;
      exhibitsListEl.hidden = true;
      fallbackNav.hidden = true;
      modeToggle.textContent = 'view as list';
      nearestIndex = -1;
      posX = 0; posZ = 0; posY = 0; velY = 0; onGround = true; yaw = 0; pitch = 0;
      walkPhase = 0; walkSwing = 0; headBobPhase = 0;
      applyCamera();
      updateCaption();
      if (pointerLockSupported) lookPrompt.hidden = document.pointerLockElement === sceneEl;
      startLoop();
    } else {
      stopLoop();
      if (pointerLockSupported && document.pointerLockElement === sceneEl) document.exitPointerLock();
      captionOverlay.classList.remove('visible');
      lookPointerId = null;
      sceneEl.hidden = true;
      exhibitsListEl.hidden = false;
      fallbackNav.hidden = false;
      modeToggle.textContent = 'walk the hallway';
      showListIndex(listIndex, false);
    }
    updateControlsVisibility();
  }

  function setMode(m) { if (mode !== m) activateMode(m); }
  modeToggle.addEventListener('click', function () { setMode(mode === 'scene3d' ? 'list' : 'scene3d'); });
  prevBtn.addEventListener('click', function () { showListIndex(listIndex - 1, true); });
  nextBtn.addEventListener('click', function () { showListIndex(listIndex + 1, true); });

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  activateMode(prefersReducedMotion ? 'list' : 'scene3d');
});
