$(document).ready(function () {

  // ── Audio ─────────────────────────────────────────────────
  // All sounds synthesized via Web Audio API — no files needed.

  var audioCtx = null;
  function getCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  // Core tone builder: oscillator type, start/end freq, duration (s), peak gain, start time offset
  function tone(type, f0, f1, dur, gain, offset) {
    try {
      var ctx = getCtx();
      var t   = ctx.currentTime + (offset || 0);
      var osc = ctx.createOscillator();
      var g   = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur);
    } catch (e) {}
  }

  // Pre-load Mario voice clips and music
  var voiceWahoo  = new Audio('yahoo.wav');
  var voiceLetsGo = new Audio('herewego.wav');
  var musicStar  = new Audio('starman_new.mp3'); // NSMB version — full quality, normal tempo
  musicStar.loop = true;

  // Background music — N64 era SM64 Main Theme, off by default
  var musicBGM   = new Audio('bgm_n64.mp3');
  musicBGM.loop  = true;
  musicBGM.volume = 0.6;
  var bgmEnabled       = false; // tracks whether the user has turned music on

  var voiceYoshi = new Audio('yoshi_voice.wav'); // classic "Yoshi!" from Yoshi's Island

  var SFX = {
    coin:     function () { tone('square',   988, 988,  0.08, 0.18); tone('square', 1319, 1319, 0.27, 0.18, 0.08); },
    stomp:    function () { tone('sawtooth', 220,  55,  0.13, 0.28); },
    koopa:    function () { tone('sawtooth', 170,  45,  0.16, 0.28); },
    shell:    function () { tone('sine',     700, 120,  0.70, 0.20); },
    pipe:     function () { tone('sine',     580,  75,  0.48, 0.22); },
    question: function () { tone('square',   880, 880,  0.12, 0.20); },
    mushroom: function () {
      var sfx = new Audio('mushroom_heart.wav');
      sfx.play();
    },
    star: function () {
      // Approximation of classic invincibility jingle start
      [659, 659, 659, 523, 659, 784].forEach(function (f, i) { tone('square', f, f, 0.10, 0.14, i * 0.10); });
    },
    invincEnd: function () {
      tone('sine', 880, 880, 0.14, 0.18, 0.00);
      tone('sine', 659, 659, 0.14, 0.18, 0.18);
      tone('sine', 440, 440, 0.20, 0.18, 0.36);
    },
    autoSquish: function () { tone('square', 380, 90, 0.14, 0.18); }
  };

  // ── State ─────────────────────────────────────────────────
  var S = {
    inPipe:           false,
    coins:            0,
    combo:            0,
    comboTimer:       null,
    goombaSpeed:      9,    // seconds per walk cycle; decreases with each stomp
    koopaSpeed:       12,
    goombaAlive:      true,
    koopaAlive:       true,
    shellActive:      false,
    shellInterval:    null,
    mushroomActive:   false,
    mushroomTimeout:  null,
    starActive:       false,
    starTimeout:      null,
    invincible:       false,
    invincTimer:      null,
    invincInterval:   null,
    superMario:       false,
    superTimer:       null,
    isNight:          false,
    idleTimer:        null,
    qDepleted:        false
  };

  // ── Utilities ─────────────────────────────────────────────

  function addCoin(x, y, amount) {
    amount = amount || 1;
    S.coins += amount;
    $('#coin-count').text(S.coins);
    SFX.coin();
    $('<div class="coin-pop">+' + amount + '</div>')
      .css({ top: y, left: x }).appendTo('body')
      .delay(850).queue(function () { $(this).remove(); $(this).dequeue(); });
  }

  function resetIdleTimer() {
    clearTimeout(S.idleTimer);
    $('#mario').removeClass('idle');
    S.idleTimer = setTimeout(function () {
      if (!S.inPipe) $('#mario').addClass('idle');
    }, 3000);
  }

  // Restart a CSS animation cleanly by forcing a reflow
  function restartAnim($el, animCSS) {
    $el.css('animation', 'none');
    $el[0].offsetWidth; // force reflow
    $el.css('animation', animCSS);
  }

  // ── Combo system ──────────────────────────────────────────
  // Consecutive stomps (on either enemy) within 3s build a streak.
  // Coins awarded = combo count. Streak resets on pipe entry or timeout.

  function addCombo() {
    clearTimeout(S.comboTimer);
    S.combo++;
    if (S.combo > 1) {
      $('#combo-count').text(S.combo);
      var $cd = $('#combo-display').show();
      $cd.removeClass('pop');
      $cd[0].offsetWidth;
      $cd.addClass('pop');
    }
    S.comboTimer = setTimeout(resetCombo, 3000);
  }

  function resetCombo() {
    S.combo = 0;
    $('#combo-display').hide();
  }

  // ── Respawn helpers ───────────────────────────────────────

  function respawnGoomba() {
    var $g = $('#goomba');
    $g.removeClass('squished').css('animation-play-state', 'running');
    restartAnim($g, 'enemyWalk ' + S.goombaSpeed + 's linear infinite');
    // Waddle still runs on the img via its own CSS rule — no need to re-set
    S.goombaAlive = true;
  }

  function respawnKoopa() {
    var $k = $('#koopa');
    $k.removeClass('squished').css('animation-play-state', 'running');
    restartAnim($k, 'enemyWalk ' + S.koopaSpeed + 's linear infinite');
    S.koopaAlive = true;
  }

  // ── Pipe ──────────────────────────────────────────────────
  $('#pipe').on('click', function () {
    resetIdleTimer();
    SFX.pipe();
    if (S.inPipe) {
      // Mario exits — play "Let's go!"
      voiceLetsGo.currentTime = 0;
      voiceLetsGo.play();
      $('#mario').animate({ bottom: '0px', opacity: 1 }, 600, 'swing');
      S.inPipe = false;
    } else {
      // Mario enters — play "Wahoo!"
      voiceWahoo.currentTime = 0;
      voiceWahoo.play();
      var h = $('#mario').outerHeight();
      $('#mario').animate({ bottom: '-' + h + 'px', opacity: 0 }, 600, 'swing', function () {
        var off = $('#pipe').offset();
        addCoin(off.left + 40, off.top);
        // Entering the pipe breaks the combo streak
        clearTimeout(S.comboTimer);
        resetCombo();
      });
      S.inPipe = true;
    }
  });

  // ── Goomba stomp ──────────────────────────────────────────
  function stompGoomba() {
    if (!S.goombaAlive || S.inPipe) return;
    S.goombaAlive = false;
    SFX.stomp();
    addCombo();
    S.goombaSpeed = Math.max(3.5, S.goombaSpeed - 0.7); // speed up, floor at 3.5s
    var coinAmt = Math.max(1, S.combo);
    var pos = $('#goomba').offset();
    addCoin(pos.left + 20, pos.top - 10, coinAmt);
    $('#goomba').css('animation-play-state', 'paused').addClass('squished');
    setTimeout(respawnGoomba, 900);
  }
  $('#goomba').on('click', stompGoomba);

  // ── Koopa stomp + shell ───────────────────────────────────
  function stompKoopa() {
    if (!S.koopaAlive || S.inPipe) return;
    S.koopaAlive = false;
    SFX.koopa();
    addCombo();
    S.koopaSpeed = Math.max(3.5, S.koopaSpeed - 0.7);
    var coinAmt = Math.max(1, S.combo);
    var pos = $('#koopa').offset();
    addCoin(pos.left + 20, pos.top - 10, coinAmt);
    $('#koopa').css('animation-play-state', 'paused').addClass('squished');

    // After squish settles, slide the shell from Koopa's position
    setTimeout(function () { launchShell(pos.left); }, 400);
    setTimeout(respawnKoopa, 1800);
  }
  $('#koopa').on('click', stompKoopa);

  function launchShell(startLeft) {
    if (S.shellActive) return;
    S.shellActive = true;
    SFX.shell();
    var $shell = $('#shell').css({ left: startLeft, display: 'block' });

    // Slide the shell to the left using jQuery animate
    $shell.animate({ left: -160 }, 1300, 'linear', function () {
      S.shellActive = false;
      clearInterval(S.shellInterval);
      $shell.hide();
    });

    // Poll every 80ms for shell-goomba collision
    S.shellInterval = setInterval(function () {
      if (!S.shellActive) { clearInterval(S.shellInterval); return; }
      if (!S.goombaAlive) return;
      var sr = $shell[0].getBoundingClientRect();
      var gr = $('#goomba')[0].getBoundingClientRect();
      if (sr.left < gr.right && sr.right > gr.left) {
        SFX.stomp();
        S.goombaAlive = false;
        var gPos = $('#goomba').offset();
        addCoin(gPos.left + 20, gPos.top - 10);
        $('#goomba').css('animation-play-state', 'paused').addClass('squished');
        setTimeout(respawnGoomba, 900);
      }
    }, 80);
  }

  // ── Question block ────────────────────────────────────────
  $('#question-block').on('click', function () {
    if (S.qDepleted) return;
    S.qDepleted = true;
    SFX.question();
    var pos = $(this).offset();
    addCoin(pos.left + 10, pos.top - 10);
    $(this).addClass('hit depleted').text('');
    // Respawn the ? after 5 seconds
    setTimeout(function () {
      S.qDepleted = false;
      $('#question-block').removeClass('depleted').text('?');
    }, 5000);
  });

  // ── Background music toggle ───────────────────────────────
  $('#music-btn').on('click', function () {
    bgmEnabled = !bgmEnabled;
    if (bgmEnabled) {
      musicBGM.play();
      $(this).html('&#9646;&#9646;').addClass('playing'); // pause icon when playing
    } else {
      musicBGM.pause();
      $(this).html('&#9654;').removeClass('playing');     // play icon when stopped
    }
  });

  // ── Day / Night toggle ────────────────────────────────────
  $('#day-night-btn').on('click', function () {
    S.isNight = !S.isNight;
    $('body').toggleClass('night', S.isNight);
    $(this).html(S.isNight ? '&#9728;' : '&#9790;'); // sun to switch back, moon to switch to night

    // Generate CSS star dots once (stays in DOM; just fades in/out via CSS)
    if ($('#night-overlay').is(':empty')) {
      var html = '';
      for (var i = 0; i < 90; i++) {
        var x    = (Math.random() * 100).toFixed(1);
        var y    = (Math.random() * 58).toFixed(1);  // top 58% = sky only
        var size = Math.random() < 0.25 ? 2 : 1;
        html += '<div class="night-star" style="left:' + x + '%;top:' + y + '%;width:' + size + 'px;height:' + size + 'px"></div>';
      }
      $('#night-overlay').html(html);
    }
  });

  // ── Mushroom (power-up) ───────────────────────────────────
  function scheduleMushroom() {
    var delay = 15000 + Math.random() * 10000; // 15–25s
    S.mushroomTimeout = setTimeout(spawnMushroom, delay);
  }

  function spawnMushroom() {
    if (S.mushroomActive) return;
    S.mushroomActive = true;
    var $m = $('#mushroom');
    $m.show();
    restartAnim($m, 'mushroomRun 7s linear forwards');
    // Auto-clean if not clicked
    setTimeout(function () {
      if (S.mushroomActive) {
        S.mushroomActive = false;
        $m.hide();
        scheduleMushroom();
      }
    }, 7100);
  }

  $('#mushroom').on('click', function () {
    if (!S.mushroomActive) return;
    S.mushroomActive = false;
    $(this).hide();
    SFX.mushroom();
    // Mario grows for 12 seconds
    clearTimeout(S.superTimer);
    S.superMario = true;
    $('#mario').addClass('super');
    var pos = $(this).offset();
    addCoin(pos.left + 10, pos.top - 10);
    S.superTimer = setTimeout(function () {
      S.superMario = false;
      $('#mario').removeClass('super');
    }, 12000);
    scheduleMushroom();
  });

  // ── Super Star (invincibility) ────────────────────────────
  function scheduleStar() {
    var delay = 20000 + Math.random() * 15000; // 20–35s
    S.starTimeout = setTimeout(spawnStar, delay);
  }

  function spawnStar() {
    if (S.starActive) return;
    S.starActive = true;
    var duration = 10 + Math.random() * 4; // 10–14s to cross screen
    var $s = $('#star').css({ top: (8 + Math.random() * 22) + '%' }).show();
    restartAnim($s, 'starFloat ' + duration + 's linear forwards, starBounce 0.65s ease-in-out infinite');
    // If not clicked, hide and reschedule
    setTimeout(function () {
      if (S.starActive) {
        S.starActive = false;
        $s.hide();
        scheduleStar();
      }
    }, (duration * 1000) + 100);
  }

  $('#star').on('click', function () {
    if (!S.starActive) return;
    S.starActive = false;
    $(this).hide();
    musicStar.currentTime = 0;
    musicStar.play();
    startInvincibility();
    scheduleStar();
  });

  function startInvincibility() {
    clearTimeout(S.invincTimer);
    clearInterval(S.invincInterval);
    S.invincible = true;
    $('#mario').addClass('invincible');
    // Pause BGM while star music plays; it will resume when invincibility ends
    if (bgmEnabled) musicBGM.pause();

    // Every 100ms, check if any enemy is near the pipe and auto-squish it
    S.invincInterval = setInterval(function () {
      if (!S.invincible) { clearInterval(S.invincInterval); return; }
      var pr = $('#pipe')[0].getBoundingClientRect();

      if (S.goombaAlive) {
        var gr = $('#goomba')[0].getBoundingClientRect();
        if (gr.right > pr.left - 90 && gr.left < pr.right + 90) {
          SFX.autoSquish();
          S.goombaAlive = false;
          var gOff = $('#goomba').offset();
          addCoin(gOff.left + 20, gOff.top - 10);
          $('#goomba').css('animation-play-state', 'paused').addClass('squished');
          setTimeout(respawnGoomba, 900);
        }
      }
      if (S.koopaAlive) {
        var kr = $('#koopa')[0].getBoundingClientRect();
        if (kr.right > pr.left - 90 && kr.left < pr.right + 90) {
          SFX.autoSquish();
          S.koopaAlive = false;
          var kOff = $('#koopa').offset();
          addCoin(kOff.left + 20, kOff.top - 10);
          $('#koopa').css('animation-play-state', 'paused').addClass('squished');
          setTimeout(respawnKoopa, 900);
        }
      }
    }, 100);

    // Invincibility lasts 8 seconds
    S.invincTimer = setTimeout(function () {
      S.invincible = false;
      clearInterval(S.invincInterval);
      $('#mario').removeClass('invincible');
      // Stop star music, play end chime, then resume BGM if it was on
      musicStar.pause();
      musicStar.currentTime = 0;
      SFX.invincEnd();
      if (bgmEnabled) musicBGM.play();
    }, 8000);
  }

  // ── Yoshi easter egg ─────────────────────────────────────
  // Yoshi appears at random intervals, trots across the ground,
  // plays his classic sound on entry, and vanishes off-screen.

  function scheduleYoshi() {
    var delay = 30000 + Math.random() * 30000; // 30–60s
    setTimeout(spawnYoshi, delay);
  }

  function spawnYoshi() {
    var $y = $('#yoshi');
    var duration = 8 + Math.random() * 4; // 8–12s to cross screen
    $y.show();
    // Restart the walk animation with a fresh duration
    $y.css('animation', 'none');
    $y[0].offsetWidth;
    $y.css('animation', 'yoshiRun ' + duration + 's linear forwards');
    // Play his greeting sound as he enters
    voiceYoshi.currentTime = 0;
    voiceYoshi.play();
    // Hide after he exits and schedule next appearance
    setTimeout(function () {
      $y.hide();
      scheduleYoshi();
    }, (duration * 1000) + 100);
  }

  // Clicking Yoshi gives a bonus coin and plays his sound again
  $('#yoshi').on('click', function () {
    voiceYoshi.currentTime = 0;
    voiceYoshi.play();
    var pos = $(this).offset();
    addCoin(pos.left + 20, pos.top - 10, 3); // bonus 3 coins for finding the easter egg
  });

  // ── Konami code easter egg ────────────────────────────────
  var KONAMI = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  var kProgress = 0;

  $(document).on('keydown', function (e) {
    kProgress = (e.keyCode === KONAMI[kProgress]) ? kProgress + 1 : (e.keyCode === KONAMI[0] ? 1 : 0);
    if (kProgress === KONAMI.length) { kProgress = 0; triggerKonami(); }
  });

  function triggerKonami() {
    $('<div id="cheat-banner">CHEAT CODE ACTIVATED!<br><span>+30 COINS</span></div>')
      .appendTo('body').delay(2500).queue(function () { $(this).remove(); $(this).dequeue(); });
    for (var i = 0; i < 30; i++) {
      (function (idx) {
        setTimeout(function () {
          var dur = 800 + Math.random() * 800;
          $('<div class="rain-coin"></div>')
            .css({ left: Math.random() * window.innerWidth, top: -20, animationDuration: dur + 'ms' })
            .appendTo('body');
          setTimeout(SFX.coin, idx * 60);
          setTimeout(function () { $('.rain-coin:first').remove(); }, dur + 100);
        }, idx * 60);
      })(i);
    }
    setTimeout(function () {
      addCoin(window.innerWidth / 2 - 20, window.innerHeight / 2, 30);
    }, 300);
  }

  // ── Init ──────────────────────────────────────────────────
  resetIdleTimer();
  $(document).on('click', resetIdleTimer);

  // Kick off the timed spawners
  scheduleMushroom();
  scheduleStar();
  scheduleYoshi();

});
