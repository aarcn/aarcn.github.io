(function () {
  var flight = document.querySelector('.flight');
  var plane = document.querySelector('.plane');
  var skydivers = document.querySelectorAll('.skydiver');
  if (!flight || !plane || !skydivers.length) return;

  var diverStyle = getComputedStyle(skydivers[0]);
  var probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.width = '1ch';
  probe.style.font = diverStyle.fontSize + ' ' + diverStyle.fontFamily;
  document.body.appendChild(probe);
  var charWidth = probe.getBoundingClientRect().width || 6.6;
  probe.remove();

  var CHARS_PER_SECOND = 10;

  function tuneFlightSpeed() {
    var distance = window.innerWidth + flight.offsetWidth + 460;
    var pxPerSecond = charWidth * CHARS_PER_SECOND;
    var duration = distance / pxPerSecond;
    var steps = Math.max(1, Math.round(duration * CHARS_PER_SECOND));
    flight.style.setProperty('--fly-distance', distance + 'px');
    flight.style.setProperty('--fly-duration', duration.toFixed(2) + 's');
    flight.style.setProperty('--fly-steps', steps);
  }
  tuneFlightSpeed();
  window.addEventListener('resize', tuneFlightSpeed);

  var FREEFALL = 'o-)-<';
  var CHUTE = '/===\\<br>\\    /<br>\\o/<br>|<br>/\\';
  var LANDED_STAND = 'o<br>/|\\<br>/\\';
  var LANDED_JUMP = '\\o/<br>|<br>/\\';
  var CHUTE_DEPLOY_MS = 1880;
  var LAND_MS = 9500;
  var JUMP_START_MS = 500;
  var JUMP_END_MS = 1500;
  var BOUNCE_MS = 2800;
  var RETRY_MS = 400;

  function isBusy(diver) {
    return diver.classList.contains('active') || diver.classList.contains('landed');
  }

  function scheduleDrop() {
    var available = Array.prototype.filter.call(skydivers, function (d) {
      return !isBusy(d);
    });
    if (!available.length) {
      setTimeout(scheduleDrop, RETRY_MS);
      return;
    }
    var diver = available[Math.floor(Math.random() * available.length)];

    var planeRect = plane.getBoundingClientRect();
    var startX = planeRect.left + planeRect.width * (0.25 + Math.random() * 0.45);
    var startY = planeRect.bottom - 6;
    var landY = window.innerHeight - 3;
    var fallTotal = Math.max(60, landY - startY);
    var driftX = 30 + Math.random() * 25;

    diver.classList.remove('active', 'chute', 'landed');
    diver.style.left = startX + 'px';
    diver.style.top = 'auto';
    diver.style.bottom = (window.innerHeight - startY) + 'px';
    diver.style.setProperty('--fall-total', fallTotal + 'px');
    diver.style.setProperty('--drift-x', driftX + 'px');
    diver.textContent = FREEFALL;
    void diver.offsetWidth;
    diver.classList.add('active');

    setTimeout(function () {
      diver.innerHTML = CHUTE;
      diver.classList.add('chute');
    }, CHUTE_DEPLOY_MS);

    setTimeout(function () {
      diver.innerHTML = LANDED_STAND;
      diver.classList.remove('active', 'chute');
      diver.classList.add('landed');
    }, LAND_MS);

    setTimeout(function () {
      diver.innerHTML = LANDED_JUMP;
    }, LAND_MS + JUMP_START_MS);

    setTimeout(function () {
      diver.innerHTML = LANDED_STAND;
    }, LAND_MS + JUMP_END_MS);

    setTimeout(function () {
      diver.classList.remove('landed');
    }, LAND_MS + BOUNCE_MS);

    setTimeout(scheduleDrop, 6000 + Math.random() * 6000);
  }

  scheduleDrop();
})();

(function () {
  var BASE = 'aaronca.no';
  var INTERVAL_MS = 250;
  var SPACE = ' ';
  var GUARD = '⁠'; // zero-width, non-whitespace: stops the browser trimming a leading space
  var FRAMES = [];
  for (var f = 0; f < BASE.length; f++) {
    FRAMES.push(GUARD + BASE.slice(0, f) + SPACE + BASE.slice(f));
  }
  FRAMES.push(BASE);

  var i = 0;
  var dir = 1;
  setInterval(function () {
    document.title = FRAMES[i];
    if (i + dir < 0 || i + dir >= FRAMES.length) dir = -dir;
    i += dir;
  }, INTERVAL_MS);
})();

(function () {
  // Each hobby tag gets its own <video>, opened/played on click rather than
  // hover -- the video carries native controls (muted by default, but the
  // viewer can unmute/raise the volume themselves), and nested interactive
  // controls inside a <button> don't reliably receive clicks, so the video
  // is appended as a SIBLING of the button inside a shared .hobby-wrap, not
  // a child of the button itself.
  var open = null; // { button, video }

  function closeOpen() {
    if (!open) return;
    open.video.pause();
    open.video.classList.remove('visible');
    open.button.setAttribute('aria-expanded', 'false');
    open = null;
  }

  Array.prototype.forEach.call(document.querySelectorAll('.hobby'), function (button) {
    var src = button.getAttribute('data-clip');
    if (!src) return;
    var video = document.createElement('video');
    video.className = 'hobby-preview';
    video.src = src;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = true;
    // 'metadata' (not 'none') so the clip's real width/height are known
    // before the first open -- otherwise the preview box briefly shows the
    // browser's 300x150 default shape, then jumps to the right aspect ratio
    // the moment playback starts.
    video.preload = 'metadata';
    (button.closest('.hobby-wrap') || button.parentElement).appendChild(video);
    button.setAttribute('aria-expanded', 'false');

    button.addEventListener('click', function () {
      var wasOpen = open && open.video === video;
      closeOpen();
      if (wasOpen) return; // clicking the same tag again just closes it
      video.currentTime = 0;
      video.classList.add('visible');
      video.play().catch(function () {});
      button.setAttribute('aria-expanded', 'true');
      open = { button: button, video: video };
    });
  });

  // Clicking anywhere outside the open tag/preview (including its own
  // controls bar, which lives inside .hobby-wrap) closes it.
  document.addEventListener('click', function (e) {
    if (open && !e.target.closest('.hobby-wrap')) closeOpen();
  });
})();
