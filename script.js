(function () {
  var flight = document.querySelector('.flight');
  var plane = document.querySelector('.plane');
  var profile = document.querySelector('.profile');
  var skydivers = document.querySelectorAll('.skydiver');
  if (!flight || !plane || !profile || !skydivers.length) return;

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
  var flyDurationMs = 0;

  function tuneFlightSpeed() {
    var distance = window.innerWidth + flight.offsetWidth + 460;
    var pxPerSecond = charWidth * CHARS_PER_SECOND;
    var duration = distance / pxPerSecond;
    var steps = Math.max(1, Math.round(duration * CHARS_PER_SECOND));
    flyDurationMs = duration * 1000;
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
  var CHUTE_DEPLOY_MS = 1430;
  var LAND_MS = 6520;
  var JUMP_START_MS = 500;
  var JUMP_END_MS = 1500;
  var BOUNCE_MS = 2800;
  var LAP_START_GRACE_MS = 9000;
  var LAP_END_GRACE_MS = 8000;
  var RETRY_MS = 400;

  var lapStartTime = Date.now();
  flight.addEventListener('animationiteration', function () {
    lapStartTime = Date.now();
  });

  function isBusy(diver) {
    return diver.classList.contains('active') || diver.classList.contains('landed');
  }

  function scheduleDrop() {
    var now = Date.now();
    var allowedAfter = lapStartTime + LAP_START_GRACE_MS;
    var blockedFrom = lapStartTime + flyDurationMs - LAP_END_GRACE_MS;
    if (now < allowedAfter) {
      setTimeout(scheduleDrop, allowedAfter - now);
      return;
    }
    if (flyDurationMs > 0 && now >= blockedFrom) {
      setTimeout(scheduleDrop, RETRY_MS);
      return;
    }
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
    var landY = profile.getBoundingClientRect().top - 3;
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

    setTimeout(scheduleDrop, 2000 + Math.random() * 2000);
  }

  scheduleDrop();
})();
