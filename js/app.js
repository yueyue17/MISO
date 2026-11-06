/* ============================================================
   MISO — Feline Archive
   Vanilla JS: a 97-frame sprite animation driven by the cursor,
   plus a small holographic flash-card deck.
   ============================================================ */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const loopIndex = (i, n) => ((i % n) + n) % n;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');

  const FRAME_COUNT = 97;
  const IDLE_FRAME = FRAME_COUNT - 1;
  const SPRITE_SRC = 'assets/cat-sprite.jpg';

  const body = document.body;

  /* ---------------- dom ---------------- */
  const heroView = $('#view-hero');
  const cardsView = $('#view-cards');
  const heroFigure = $('#heroFigure');
  const canvas = $('#catCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const heroLoader = $('#heroLoader');
  const frameNumber = $('#frameNumber');
  const frameMode = $('#frameMode');
  const framePlayhead = $('#framePlayhead');
  const frameRail = $('#frameRail');
  const statusPill = $('#statusPill');
  const statusText = $('#statusText');
  const topbarMeta = $('#topbarMeta');
  const heroHintText = $('#heroHintText');
  const cursorEl = $('#cursor');
  const cursorRing = $('.cursor__ring', cursorEl);
  const glowEl = $('#glow');
  const railNav = $('.rail__nav');
  const railIndicator = $('#railIndicator');
  const navButtons = $$('.rail__btn');
  const liveRegion = $('#liveRegion');
  const clockEl = $('#clock');

  const deckEl = $('#deck');
  const deckCards = $('#deckCards');
  const prevBtn = $('#prevCard');
  const nextBtn = $('#nextCard');
  const cardDots = $('#cardDots');
  const cardCount = $('#cardCount');
  const cardName = $('#cardName');

  const isTouch = coarsePointer.matches || navigator.maxTouchPoints > 0;

  /* ---------------- state ---------------- */
  const state = {
    view: 'hero',
    ready: false,
    frame: IDLE_FRAME,
    target: IDLE_FRAME,
    velocity: 0,
    tracking: false,
    pointerInside: false,
    lastClientX: 0,
    lastClientY: 0,
    pointerX: 0,
    pointerY: 0,
    railWidth: 0,
    currentCard: 0,
    touchDown: false,
    touchIdleTimer: 0,
    suppressClick: false,
    metaTimer: 0,
    lastDrawn: null,
  };

  const cursorState = {
    enabled: finePointer.matches && !isTouch && !reducedMotion.matches,
    visible: false,
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    ringX: window.innerWidth / 2,
    ringY: window.innerHeight / 2,
    glowX: window.innerWidth / 2,
    glowY: window.innerHeight / 2,
    glowVisible: false,
  };

  const sprite = new Image();
  let frameW = 300;
  let frameH = 400;
  let tiltFrame = 0;
  let tiltEvent = null;

  /* ---------------- frame animation ---------------- */
  function drawFrame(position) {
    if (!state.ready) return;
    const p = clamp(position, 0, FRAME_COUNT - 1);
    const i = Math.floor(p);
    const frac = p - i;

    ctx.globalAlpha = 1;
    ctx.drawImage(
      sprite,
      i * frameW, 0, frameW, frameH,
      0, 0, canvas.width, canvas.height
    );

    if (frac > 0.012 && i < FRAME_COUNT - 1) {
      ctx.globalAlpha = frac;
      ctx.drawImage(
        sprite,
        (i + 1) * frameW, 0, frameW, frameH,
        0, 0, canvas.width, canvas.height
      );
      ctx.globalAlpha = 1;
    }
  }

  function setFrameReadout(position) {
    const display = clamp(Math.round(position) + 1, 1, FRAME_COUNT);
    const value = String(display).padStart(3, '0');
    if (frameNumber.textContent !== value) frameNumber.textContent = value;
    if (heroFigure.getAttribute('aria-valuenow') !== String(display)) {
      heroFigure.setAttribute('aria-valuenow', String(display));
      heroFigure.setAttribute('aria-valuetext',
        `第 ${display} 帧，${state.tracking ? '正在追踪光标' : '待机'}`);
    }
    if (state.railWidth) {
      const x = (position / IDLE_FRAME) * state.railWidth;
      framePlayhead.style.transform = `translate3d(${x.toFixed(2)}px, -50%, 0)`;
    }
  }

  function setTracking(on) {
    if (state.tracking === on) return;
    state.tracking = on;
    statusText.textContent = on ? '追踪中' : '待机';
    statusPill.dataset.state = on ? 'tracking' : 'idle';
    frameMode.textContent = on ? 'TRACKING' : 'IDLE';
    frameMode.dataset.mode = on ? 'tracking' : 'idle';
  }

  // Directional gaze map instead of a plain linear scrub:
  // left third -> left-looking frames, center -> up-looking frames,
  // right third -> right-looking frames. Values are source-frame indices.
  // 46-60: head tilted with pupils left
  // 20-28: pupils up
  // 66-80: head tilted with pupils right
  function gazeFrameForX(x) {
    if (x < 0.4) {
      // Far left is the strongest left tilt; approaching center is still left.
      const t = x / 0.4;
      return 60 + (46 - 60) * t;
    }
    if (x <= 0.6) {
      // Center holds an upward gaze; edges of the center zone are slightly softer.
      const t = (x - 0.4) / 0.2;
      return 20 + Math.abs(t - 0.5) * 16;
    }
    // Right third: head turns to the other side.
    const t = (x - 0.6) / 0.4;
    return 66 + (80 - 66) * t;
  }

  function updateTargetFromClientX(clientX) {
    if (state.view !== 'hero') return;
    const rect = heroView.getBoundingClientRect();
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    state.target = gazeFrameForX(x);
  }

  function setIdle() {
    setTracking(false);
    state.target = IDLE_FRAME;
  }

  function resetHeroToIdle() {
    setIdle();
    state.pointerInside = false;
    state.frame = IDLE_FRAME;
    state.velocity = 0;
    state.target = IDLE_FRAME;
    if (state.ready) {
      drawFrame(IDLE_FRAME);
      setFrameReadout(IDLE_FRAME);
    }
  }

  function tick(now) {
    if (!tick.last) tick.last = now;
    const dt = Math.min((now - tick.last) / 1000, 0.05);
    tick.last = now;

    if (state.ready) {
      if (reducedMotion.matches) {
        state.frame = state.target;
        state.velocity = 0;
      } else {
        const stiffness = state.tracking ? 190 : 92;
        const damping = 2 * Math.sqrt(stiffness) * 0.98;
        state.velocity += (state.target - state.frame) * stiffness * dt;
        state.velocity *= Math.exp(-damping * dt);
        state.frame += state.velocity * dt;

        if (Math.abs(state.target - state.frame) < 0.002 && Math.abs(state.velocity) < 0.004) {
          state.frame = state.target;
          state.velocity = 0;
        }
      }
      state.frame = clamp(state.frame, 0, IDLE_FRAME);

      // Only touch the big sprite sheet when the frame actually moves.
      // At rest this keeps the page completely idle.
      if (state.view === 'hero' &&
          (state.lastDrawn === null || Math.abs(state.frame - state.lastDrawn) > 0.0008)) {
        drawFrame(state.frame);
        setFrameReadout(state.frame);
        state.lastDrawn = state.frame;
      }
    }

    updateCursorFrame(dt);
    updateGlowFrame(dt);
    requestAnimationFrame(tick);
  }

  /* ---------------- sprite loading ---------------- */
  async function loadSprite() {
    sprite.src = SPRITE_SRC;
    try {
      if (typeof sprite.decode === 'function') {
        await sprite.decode();
      } else {
        await new Promise((resolve, reject) => {
          sprite.onload = resolve;
          sprite.onerror = reject;
        });
      }

      frameW = sprite.naturalWidth / FRAME_COUNT;
      frameH = sprite.naturalHeight;
      canvas.width = Math.round(frameW);
      canvas.height = Math.round(frameH);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      state.ready = true;
      drawFrame(IDLE_FRAME);
      setFrameReadout(IDLE_FRAME);
      state.lastDrawn = IDLE_FRAME;
      measureRail();
      body.classList.add('is-ready');
      liveRegion.textContent = 'MISO 已就绪。移动鼠标与它对视。';
    } catch (err) {
      console.error('MISO sprite failed to load', err);
      heroFigure.classList.add('is-fallback');
      canvas.style.display = 'none';
      heroLoader.classList.add('is-error');
      $('.loader__text', heroLoader).textContent = 'SPRITE ERROR / 正在打盹';
      body.classList.add('is-ready');
    }
  }

  /* ---------------- rail measurement ---------------- */
  function measureRail() {
    state.railWidth = frameRail.getBoundingClientRect().width;
    if (state.ready) setFrameReadout(state.frame);
  }

  function positionRailIndicator() {
    const active = navButtons.find((btn) => btn.classList.contains('is-active'));
    if (!active) return;
    const navRect = railNav.getBoundingClientRect();
    const btnRect = active.getBoundingClientRect();
    railIndicator.style.width = `${btnRect.width}px`;
    railIndicator.style.height = `${btnRect.height}px`;
    railIndicator.style.transform =
      `translate3d(${btnRect.left - navRect.left}px, ${btnRect.top - navRect.top}px, 0)`;
  }

  /* ---------------- pointer / cursor ---------------- */
  function showCustomCursor() {
    if (!cursorState.enabled) return;
    cursorState.visible = true;
    cursorEl.classList.add('is-visible');
  }

  function hideCustomCursor() {
    cursorState.visible = false;
    cursorEl.classList.remove('is-visible', 'is-link', 'is-press');
  }

  function showGlow() {
    cursorState.glowVisible = true;
    glowEl.style.opacity = '1';
  }

  function hideGlow() {
    cursorState.glowVisible = false;
    glowEl.style.opacity = '0';
  }

  function setCursorPosition(clientX, clientY) {
    state.lastClientX = clientX;
    state.lastClientY = clientY;
    if (!cursorState.visible) {
      cursorState.x = clientX;
      cursorState.y = clientY;
      cursorState.ringX = clientX;
      cursorState.ringY = clientY;
    }
    cursorState.x = clientX;
    cursorState.y = clientY;
    cursorEl.style.transform = `translate3d(${clientX}px, ${clientY}px, 0)`;
  }

  function updateCursorFrame(dt) {
    if (!cursorState.visible) return;
    const ease = 1 - Math.exp(-dt * 16);
    cursorState.ringX += (cursorState.x - cursorState.ringX) * ease;
    cursorState.ringY += (cursorState.y - cursorState.ringY) * ease;
    cursorRing.style.transform =
      `translate3d(${(cursorState.ringX - cursorState.x).toFixed(2)}px, ${(cursorState.ringY - cursorState.y).toFixed(2)}px, 0)`;
    if (!cursorState.enabled) return;
  }

  function updateGlowFrame(dt) {
    if (!cursorState.glowVisible) return;
    const ease = 1 - Math.exp(-dt * 7);
    const rect = heroView.getBoundingClientRect();
    const tx = state.lastClientX;
    const ty = state.lastClientY;
    cursorState.glowX += (tx - cursorState.glowX) * ease;
    cursorState.glowY += (ty - cursorState.glowY) * ease;
    glowEl.style.transform = `translate3d(${cursorState.glowX.toFixed(1)}px, ${cursorState.glowY.toFixed(1)}px, 0)`;
    if (rect.width === 0) hideGlow();
  }

  function handlePointerEnter(e) {
    if (state.view !== 'hero') return;
    state.pointerInside = true;
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      setTracking(true);
      showCustomCursor();
      showGlow();
      setCursorPosition(e.clientX, e.clientY);
      updateTargetFromClientX(e.clientX);
    }
  }

  function handlePointerMove(e) {
    if (state.view !== 'hero') return;
    if (state.lastClientX === 0 && state.lastClientY === 0) {
      state.lastClientX = e.clientX;
      state.lastClientY = e.clientY;
    }

    if (e.pointerType === 'touch') {
      if (!state.touchDown) return;
      if (state.touchIdleTimer) {
        window.clearTimeout(state.touchIdleTimer);
        state.touchIdleTimer = 0;
      }
      state.pointerInside = true;
      setTracking(true);
      showGlow();
      setCursorPosition(e.clientX, e.clientY);
      updateTargetFromClientX(e.clientX);
      return;
    }

    state.pointerInside = true;
    setTracking(true);
    showCustomCursor();
    showGlow();
    setCursorPosition(e.clientX, e.clientY);
    updateTargetFromClientX(e.clientX);
    cursorEl.classList.toggle('is-link', Boolean(e.target.closest('a, button')));
  }

  function handlePointerLeave(e) {
    if (e.pointerType === 'touch') return;
    state.pointerInside = false;
    setIdle();
    hideCustomCursor();
    hideGlow();
  }

  function handlePointerDown(e) {
    if (state.view !== 'hero') return;
    if (e.pointerType === 'touch') {
      state.touchDown = true;
      if (state.touchIdleTimer) {
        window.clearTimeout(state.touchIdleTimer);
        state.touchIdleTimer = 0;
      }
      state.pointerInside = true;
      setTracking(true);
      showGlow();
      setCursorPosition(e.clientX, e.clientY);
      updateTargetFromClientX(e.clientX);
      return;
    }
    setTracking(true);
    showCustomCursor();
    showGlow();
    cursorEl.classList.add('is-press');
    setCursorPosition(e.clientX, e.clientY);
    updateTargetFromClientX(e.clientX);
  }

  function handlePointerUp(e) {
    cursorEl.classList.remove('is-press');
    if (e.pointerType === 'touch' && state.touchDown) {
      state.touchDown = false;
      if (state.touchIdleTimer) window.clearTimeout(state.touchIdleTimer);
      state.touchIdleTimer = window.setTimeout(() => {
        if (state.view !== 'hero' || state.touchDown) return;
        setIdle();
        hideGlow();
      }, 1400);
    }
  }

  function handleKeyDown(e) {
    if (state.view !== 'hero') return;
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = -3;
    else if (e.key === 'ArrowRight') delta = 3;
    else if (e.key === 'Home') {
      e.preventDefault();
      state.target = 0;
      setTracking(true);
      return;
    } else if (e.key === 'End') {
      e.preventDefault();
      state.target = IDLE_FRAME;
      setTracking(true);
      return;
    } else {
      return;
    }
    e.preventDefault();
    state.target = clamp(state.target + delta, 0, IDLE_FRAME);
    setTracking(true);
  }

  /* ---------------- view switching ---------------- */
  function setTopbarMeta(text) {
    if (!text) return;
    window.clearTimeout(state.metaTimer);
    topbarMeta.style.opacity = '0';
    state.metaTimer = window.setTimeout(() => {
      topbarMeta.textContent = text;
      topbarMeta.style.opacity = '1';
    }, 140);
  }

  function setView(name, { push = true, announce = true } = {}) {
    const next = name === 'cards' ? 'cards' : 'hero';
    if (state.view === next && next !== 'hero') {
      positionRailIndicator();
      return;
    }

    state.view = next;
    const isHero = next === 'hero';

    heroView.classList.toggle('is-active', isHero);
    cardsView.classList.toggle('is-active', !isHero);
    heroView.toggleAttribute('inert', !isHero);
    cardsView.toggleAttribute('inert', isHero);
    if (isHero) heroView.removeAttribute('aria-hidden');
    else heroView.setAttribute('aria-hidden', 'true');
    if (isHero) cardsView.setAttribute('aria-hidden', 'true');
    else cardsView.removeAttribute('aria-hidden');
    body.classList.toggle('view-cards', !isHero);

    navButtons.forEach((btn) => {
      const active = btn.dataset.view === next;
      btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });

    if (isHero) {
      setTopbarMeta('NO. 001 — CREAM ROOM');
      measureRail();
      if (state.ready) {
        drawFrame(state.frame);
        state.lastDrawn = state.frame;
        setFrameReadout(state.frame);
      }
      requestAnimationFrame(() => {
        measureRail();
        setFrameReadout(state.frame);
      });
    } else {
      setTopbarMeta('DECK 02 — FIVE CARDS');
      setIdle();
      state.pointerInside = false;
      hideCustomCursor();
      hideGlow();
      resetTilt();
      cardEls.forEach((el) => resetFlip(el));
    }

    positionRailIndicator();

    if (push) {
      const hash = `#${next}`;
      if (location.hash !== hash) history.pushState({ view: next }, '', hash);
    }

    if (announce) {
      liveRegion.textContent = isHero
        ? '已切换到主视觉。移动鼠标与 MISO 对视。'
        : '已切换到闪卡。使用左右方向键切换卡片，点击卡片翻转。';
    }
  }

  /* ---------------- cards data ---------------- */
  const CARDS = [
    {
      no: '01',
      zh: '凝视',
      en: 'THE GAZE',
      accent: '#e7b520',
      caption: '它在看你，也在等你先眨眼。',
      note: 'MISO 的瞳孔是一片被点亮的琥珀。它不追光，只是安静地把光收进眼睛里。当你靠近，它会先看你；当你移开，它会记住你刚才站的位置。',
      art: { zoom: 1.9, pos: '50% 30%', tag: 'DETAIL / EYES' },
      stats: [['专注度', '98'], ['眨眼频率', '2.4 / MIN'], ['情绪', '稳定']],
    },
    {
      no: '02',
      zh: '耳朵',
      en: 'THE EARS',
      accent: '#d7958b',
      caption: '两座粉色的小山，替它听懂了空气。',
      note: '耳朵是它最早醒来的部分。冰箱门、钥匙串、你光脚踩过地板的声音，都会先抵达这里。它常常假装没听见，但耳尖会诚实地转向你。',
      art: { zoom: 2.0, pos: '50% 8%', tag: 'DETAIL / EARS' },
      stats: [['听觉', '92'], ['警觉', '74'], ['假装', '100']],
    },
    {
      no: '03',
      zh: '胡须',
      en: 'THE WHISKERS',
      accent: '#b9a47e',
      caption: '量一量风，也量一量你。',
      note: '胡须不是装饰，是一把随身携带的尺。它用这些细小的天线读完整个房间，再决定要不要把身体挪过去。大多数时候，答案是不挪。',
      art: { zoom: 1.8, pos: '50% 45%', tag: 'DETAIL / WHISKERS' },
      stats: [['感知', '96'], ['移动意愿', '12'], ['好奇心', '63']],
    },
    {
      no: '04',
      zh: '端坐',
      en: 'THE POSTURE',
      accent: '#8e9b8b',
      caption: '把身体收成一个黑色的逗号。',
      note: '它坐得很稳，像一件被放在房间里很久的家具。重心落在两只前爪之间，尾巴绕到身侧，刚好把所有的棱角收起来。世界很吵，它选择不动。',
      art: { zoom: 1, pos: '50% 50%', fit: 'contain', tag: 'FULL BODY' },
      stats: [['稳定', '100'], ['打扰意愿', '0'], ['存在感', '88']],
    },
    {
      no: '05',
      zh: '尾巴',
      en: 'THE TAIL',
      accent: '#a6a08e',
      caption: '所有没说出口的话，都放在这里。',
      note: '尾巴是 MISO 的第二个表情。开心时，它慢慢扫过地面；不耐烦时，它只抬一下尾尖。你不需要听懂猫的语言，只要看那条黑色的线怎么画。',
      art: { zoom: 1.55, pos: '90% 84%', tag: 'DETAIL / TAIL' },
      stats: [['情绪', '88'], ['摆动频率', '0.7 HZ'], ['秘密', '很多']],
    },
  ];

  let cardEls = [];
  let dotEls = [];

  function cardLabel(card, flipped) {
    const base = `${card.zh} ${card.en}，第 ${card.no} 张，共 5 张。`;
    return base + (flipped ? '当前为背面，点击返回正面。' : '点击翻转查看背面。');
  }

  function renderCards() {
    deckCards.innerHTML = CARDS.map((card, i) => {
      const artStyle = [
        `--zoom:${card.art.zoom}`,
        `--pos:${card.art.pos}`,
        card.art.fit ? `--fit:${card.art.fit};` : '',
      ].join(';');
      const stats = card.stats.map(([k, v]) =>
        `<div class="card__stat"><dt>${k}</dt><dd>${v}</dd></div>`).join('');

      return `
        <article class="card" data-index="${i}" data-offset="0" role="button" tabindex="-1"
          aria-label="${cardLabel(card, false)}" aria-pressed="false" style="--accent:${card.accent}">
          <div class="card__float">
            <div class="card__flip">
              <div class="card__face card__front" aria-hidden="false">
                <span class="card__inner-line"></span>
                <div class="card__top">
                  <span class="card__top-label">MISO ARCHIVE</span>
                  <span>№ ${card.no} / 05</span>
                </div>
                <div class="card__art">
                  <div class="card__art-img" style="${artStyle}"></div>
                  <span class="card__art-tag">${card.art.tag}</span>
                </div>
                <div class="card__body">
                  <div class="card__heading">
                    <h3>${card.zh}</h3>
                    <span class="card__en">${card.en}</span>
                  </div>
                  <p class="card__caption">${card.caption}</p>
                  <div class="card__foot">
                    <span>OBSERVATION ${card.no}</span>
                    <span>FLIP ↗</span>
                  </div>
                </div>
                <span class="card__holo" aria-hidden="true"></span>
                <span class="card__glare" aria-hidden="true"></span>
              </div>
              <div class="card__face card__back" aria-hidden="true">
                <span class="card__inner-line"></span>
                <div class="card__back-top">
                  <span>FIELD NOTES</span>
                  <span>MISO-${card.no}</span>
                </div>
                <div class="card__back-body">
                  <span class="card__back-no" aria-hidden="true">${card.no}</span>
                  <h3>${card.zh}</h3>
                  <span class="card__back-en">${card.en}</span>
                  <p class="card__note">${card.note}</p>
                  <span class="card__seal" aria-hidden="true"><i></i></span>
                  <dl class="card__stats">${stats}</dl>
                </div>
                <div class="card__back-foot">
                  <span>MISO ARCHIVE</span>
                  <span>CREAM ROOM, 2026</span>
                </div>
                <span class="card__holo" aria-hidden="true"></span>
                <span class="card__glare" aria-hidden="true"></span>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    cardDots.innerHTML = CARDS.map((card, i) => `
      <button class="cards__dot" type="button" data-index="${i}" aria-label="${card.no} ${card.zh} / ${card.en}" aria-current="${i === 0 ? 'true' : 'false'}" style="--accent:${card.accent}">
        <span>${card.no}</span><i aria-hidden="true"></i>
      </button>
    `).join('');

    cardEls = $$('.card', deckCards);
    dotEls = $$('.cards__dot', cardDots);

    cardDots.addEventListener('click', (e) => {
      const dot = e.target.closest('.cards__dot');
      if (!dot) return;
      goTo(Number(dot.dataset.index));
    });
  }

  function resetFlip(el, { silent = true } = {}) {
    if (!el) return;
    el.classList.remove('is-flipped');
    el.setAttribute('aria-pressed', 'false');
    const front = $('.card__front', el);
    const back = $('.card__back', el);
    if (front) front.setAttribute('aria-hidden', 'false');
    if (back) back.setAttribute('aria-hidden', 'true');
    const idx = Number(el.dataset.index);
    if (CARDS[idx]) el.setAttribute('aria-label', cardLabel(CARDS[idx], false));
    if (!silent) liveRegion.textContent = '已返回卡片正面。';
  }

  function toggleFlip(el) {
    if (!el || Number(el.dataset.index) !== state.currentCard) return;
    const flipped = !el.classList.contains('is-flipped');
    resetTilt(el);
    el.classList.toggle('is-flipped', flipped);
    el.setAttribute('aria-pressed', String(flipped));
    const front = $('.card__front', el);
    const back = $('.card__back', el);
    if (front) front.setAttribute('aria-hidden', String(flipped));
    if (back) back.setAttribute('aria-hidden', String(!flipped));
    const idx = Number(el.dataset.index);
    if (CARDS[idx]) el.setAttribute('aria-label', cardLabel(CARDS[idx], flipped));
  }

  function layoutDeck() {
    const n = cardEls.length;
    const half = Math.floor(n / 2);
    cardEls.forEach((el, i) => {
      const off = ((i - state.currentCard + n + half) % n) - half;
      el.dataset.offset = String(off);
      const active = off === 0;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-hidden', active ? 'false' : 'true');
      el.tabIndex = active ? 0 : -1;
      el.inert = !active;
      if (!active) resetFlip(el);
    });

    dotEls.forEach((dot, i) => {
      const active = i === state.currentCard;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', active ? 'true' : 'false');
    });

    const card = CARDS[state.currentCard];
    if (card) {
      cardCount.textContent = `${card.no} / 05`;
      cardName.textContent = `${card.zh} / ${card.en}`;
    }
  }

  function goTo(index) {
    const next = loopIndex(index, CARDS.length);
    if (next === state.currentCard) return;
    const activeHadFocus = document.activeElement &&
      document.activeElement.closest('.card') === cardEls[state.currentCard];

    cardEls.forEach((el) => {
      resetFlip(el);
      resetTilt(el);
    });
    state.currentCard = next;
    layoutDeck();

    if (activeHadFocus) {
      requestAnimationFrame(() => cardEls[next].focus({ preventScroll: true }));
    }
  }

  function resetTilt(el = cardEls[state.currentCard]) {
    if (!el) return;
    ['--px', '--py', '--rx', '--ry', '--tm', '--hx', '--hy'].forEach((prop) => {
      el.style.removeProperty(prop);
    });
  }

  function applyTilt() {
    tiltFrame = 0;
    const event = tiltEvent;
    if (!event || state.view !== 'cards') return;
    const card = cardEls[state.currentCard];
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (!rect.width) return;
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const flipped = card.classList.contains('is-flipped');
    const rx = flipped ? 0 : (0.5 - y) * 9;
    const ry = flipped ? 0 : (x - 0.5) * 12;
    const tm = Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 2);

    card.style.setProperty('--px', `${(x * 100).toFixed(2)}%`);
    card.style.setProperty('--py', `${(y * 100).toFixed(2)}%`);
    card.style.setProperty('--hx', `${(x * 100).toFixed(2)}%`);
    card.style.setProperty('--hy', `${(y * 100).toFixed(2)}%`);
    card.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    card.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
    card.style.setProperty('--tm', tm.toFixed(3));
  }

  function handleDeckMove(e) {
    if (state.view !== 'cards' || reducedMotion.matches) return;
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      tiltEvent = e;
      if (!tiltFrame) tiltFrame = requestAnimationFrame(applyTilt);
    }
  }

  /* ---------------- deck interactions ---------------- */
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  function bindDeck() {
    prevBtn.addEventListener('click', () => goTo(state.currentCard - 1));
    nextBtn.addEventListener('click', () => goTo(state.currentCard + 1));

    deckEl.addEventListener('pointermove', handleDeckMove);
    deckEl.addEventListener('pointerleave', () => {
      resetTilt();
      if (tiltFrame) {
        cancelAnimationFrame(tiltFrame);
        tiltFrame = 0;
      }
    });

    deckCards.addEventListener('click', (e) => {
      if (state.suppressClick) {
        e.preventDefault();
        state.suppressClick = false;
        return;
      }
      if (e.target.closest('.deck__arrow')) return;
      const card = e.target.closest('.card');
      if (!card || Number(card.dataset.index) !== state.currentCard) return;
      toggleFlip(card);
    });

    deckCards.addEventListener('keydown', (e) => {
      const card = e.target.closest('.card');
      if (!card || Number(card.dataset.index) !== state.currentCard) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        e.stopPropagation();
        toggleFlip(card);
      }
    });

    deckCards.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      touchStartX = e.clientX;
      touchStartY = e.clientY;
      touchStartTime = performance.now();
    });

    deckCards.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch') return;
      const dx = e.clientX - touchStartX;
      const dy = e.clientY - touchStartY;
      const elapsed = performance.now() - touchStartTime;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.35 && elapsed < 700) {
        state.suppressClick = true;
        window.setTimeout(() => { state.suppressClick = false; }, 380);
        goTo(state.currentCard + (dx < 0 ? 1 : -1));
      }
    });
  }

  /* ---------------- clock ---------------- */
  function updateClock() {
    const date = new Date();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    clockEl.textContent = `${hh}:${mm}`;
    clockEl.setAttribute('datetime', `${hh}:${mm}`);
  }

  /* ---------------- boot ---------------- */
  function bindViewLinks() {
    $$('[data-view]').forEach((el) => {
      el.addEventListener('click', () => setView(el.dataset.view));
    });
    $$('[data-view-link]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        setView(el.dataset.viewLink);
      });
    });
  }

  function bindGlobal() {
    window.addEventListener('resize', () => {
      measureRail();
      positionRailIndicator();
      if (state.pointerInside && state.view === 'hero') {
        updateTargetFromClientX(state.lastClientX);
      }
    });

    window.addEventListener('blur', () => {
      if (state.view === 'hero') {
        setIdle();
        hideCustomCursor();
        hideGlow();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.view === 'hero') {
        setIdle();
        hideGlow();
      }
      tick.last = performance.now();
    });

    document.addEventListener('keydown', (e) => {
      if (state.view !== 'cards') return;
      const active = document.activeElement;
      const tag = active ? active.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(state.currentCard - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(state.currentCard + 1);
      } else if (e.key === 'Escape') {
        const card = cardEls[state.currentCard];
        if (card && card.classList.contains('is-flipped')) {
          e.preventDefault();
          resetFlip(card, { silent: false });
        }
      }
    });

    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    window.addEventListener('popstate', () => {
      const next = location.hash === '#cards' ? 'cards' : 'hero';
      setView(next, { push: false, announce: false });
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        positionRailIndicator();
        measureRail();
      });
    }
  }

  function init() {
    requestAnimationFrame(() => body.classList.add('is-booted'));
    body.classList.toggle('is-touch', isTouch);
    if (isTouch) {
      heroHintText.textContent = '拖动画面 · 与它对视';
      body.classList.add('has-touch');
    }
    if (cursorState.enabled) body.classList.add('has-custom-cursor');

    updateClock();
    window.setInterval(updateClock, 20000);

    renderCards();
    layoutDeck();
    bindDeck();

    // initial view
    const initial = location.hash === '#cards' ? 'cards' : 'hero';
    setView(initial, { push: false, announce: false });
    if (!location.hash) {
      history.replaceState({ view: initial }, '', `#${initial}`);
    }

    bindViewLinks();
    bindGlobal();

    heroView.addEventListener('pointerenter', handlePointerEnter);
    heroView.addEventListener('pointermove', handlePointerMove);
    heroView.addEventListener('pointerleave', handlePointerLeave);
    heroView.addEventListener('pointerdown', handlePointerDown);
    heroFigure.addEventListener('keydown', handleKeyDown);
    heroFigure.addEventListener('blur', () => {
      if (!state.pointerInside) setIdle();
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(positionRailIndicator);
    }
    window.addEventListener('load', () => {
      positionRailIndicator();
      measureRail();
    });

    requestAnimationFrame(() => {
      positionRailIndicator();
      measureRail();
    });

    loadSprite();
    requestAnimationFrame(tick);
  }

  init();
})();
