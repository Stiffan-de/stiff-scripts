// ==UserScript==
// @name         YouTube — PiP-кнопка в плеере
// @namespace    https://github.com/StiffMusic/stiffmusic-userscripts
// @version      1.4.0
// @description  Вынести видео в мини-окно (Picture-in-Picture). Alt+P — PiP, Alt+F — полный экран. / Adds PiP and Fullscreen buttons to YouTube player.
// @author       Stiff music
// @copyright    2026, Stiff music (https://github.com/StiffMusic)
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @homepageURL  https://github.com/StiffMusic/stiffmusic-userscripts
// @supportURL   https://github.com/StiffMusic/stiffmusic-userscripts/issues
// @updateURL    https://raw.githubusercontent.com/StiffMusic/stiffmusic-userscripts/main/youtube-pip-button/youtube-pip-button.user.js
// @downloadURL  https://raw.githubusercontent.com/StiffMusic/stiffmusic-userscripts/main/youtube-pip-button/youtube-pip-button.user.js
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @match        *://m.youtube.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* ============================================================
 *  YouTube PiP Button
 *  ============================================================
 *
 *  Добавляет кнопку PiP (Picture-in-Picture) в панель управления
 *  плеером YouTube и горячую клавишу Alt+P.
 *
 *  ДОПОЛНИТЕЛЬНО:
 *    • Когда видео в PiP — появляется кнопка «Развернуть на весь экран».
 *    • Хоткей Alt+F — развернуть на весь экран.
 *
 *  ЛИЦЕНЗИЯ:
 *    • PolyForm Noncommercial 1.0.0 — коммерческое использование запрещено.
 *
 *  ============================================================
 *  CHANGELOG
 *  ============================================================
 *
 *  v1.4.0 (18.09.2026)
 *    • Кнопка «Развернуть на весь экран» в PiP-режиме.
 *    • Хоткей Alt+F.
 *
 *  v1.3.0 (17.09.2026)
 *    • Модульная структура.
 *    • Клик по кнопке PiP теперь работает корректно.
 *
 *  v1.2.1 (15.09.2026)
 *    • Убран innerHTML (Trusted Types).
 *    • @run-at изменён на document-idle.
 *
 *  v1.0.0 (01.09.2026)
 *    • Первый релиз.
 * ============================================================ */

(function () {
  'use strict';

  const CONFIG = {
    VERSION: '1.4.0',
    BUTTON_ID: 'tm-pip-btn-force',
    BUTTON_CLASS: 'tm-pip-player-button',
    FS_BUTTON_ID: 'tm-pip-fs-btn',
    FS_BUTTON_CLASS: 'tm-pip-fs-button',
    STYLE_ID: 'tm-pip-player-style-v21',
    CHANGELOG_KEY: 'pip_changelog_version',
    HOTKEY_PIP: { alt: true, ctrl: false, shift: false, meta: false, key: 'p' },
    HOTKEY_FS:  { alt: true, ctrl: false, shift: false, meta: false, key: 'f' }
  };

  const State = { injected: false, fsInjected: false, observer: null };

  const Utils = {
    getVideo() {
      return document.querySelector('#movie_player video.html5-main-video') ||
        document.querySelector('#movie_player video') ||
        document.querySelector('video.html5-main-video') ||
        document.querySelector('video');
    },
    getPlayer() {
      return document.querySelector('#movie_player') ||
        document.querySelector('.html5-video-player');
    },
    isEditableElement(el) {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    },
    createSvgPip() {
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const r1 = document.createElementNS(svgNS, 'rect');
      r1.setAttribute('x', '3'); r1.setAttribute('y', '5');
      r1.setAttribute('width', '18'); r1.setAttribute('height', '14');
      r1.setAttribute('rx', '1.5');
      const r2 = document.createElementNS(svgNS, 'rect');
      r2.setAttribute('x', '12.5'); r2.setAttribute('y', '11');
      r2.setAttribute('width', '6'); r2.setAttribute('height', '4.5');
      r2.setAttribute('rx', '0.6');
      svg.appendChild(r1); svg.appendChild(r2);
      return svg;
    },
    createSvgFullscreen() {
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'].forEach(d => {
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#fff');
        p.setAttribute('stroke-width', '2');
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(p);
      });
      return svg;
    }
  };

  const Changelog = {
    async checkAndShow() {
      try {
        const shown = await GM_getValue(CONFIG.CHANGELOG_KEY, null);
        if (shown === CONFIG.VERSION) return;
        await GM_setValue(CONFIG.CHANGELOG_KEY, CONFIG.VERSION);
        console.log(`[YouTube PiP] Обновлено до v${CONFIG.VERSION}`);
      } catch (e) {}
    },
    showDialog() {
      alert(
        `YouTube PiP v${CONFIG.VERSION}\n\n` +
        `✨ Добавлено:\n` +
        `• Кнопка «Развернуть на весь экран» в PiP\n` +
        `• Хоткей Alt+F\n\n` +
        `⌨️ Горячие клавиши:\n` +
        `• Alt+P — PiP\n` +
        `• Alt+F — полный экран`
      );
    }
  };

  const Styles = {
    inject() {
      if (document.getElementById(CONFIG.STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = CONFIG.STYLE_ID;
      style.textContent = `
        #${CONFIG.BUTTON_ID}, .${CONFIG.BUTTON_CLASS},
        #${CONFIG.FS_BUTTON_ID}, .${CONFIG.FS_BUTTON_CLASS} {
          width: 48px !important; height: 48px !important;
          min-width: 48px !important;
          display: inline-flex !important;
          justify-content: center !important; align-items: center !important;
          padding: 0 !important; margin: 0 2px !important;
          border: none !important; outline: none !important;
          background: transparent !important; color: #fff !important;
          cursor: pointer !important; z-index: 99999 !important;
          flex-shrink: 0 !important; position: relative !important;
        }
        #${CONFIG.BUTTON_ID}:hover, .${CONFIG.BUTTON_CLASS}:hover,
        #${CONFIG.FS_BUTTON_ID}:hover, .${CONFIG.FS_BUTTON_CLASS}:hover {
          background: rgba(255, 255, 255, 0.2) !important;
        }
        #${CONFIG.BUTTON_ID} svg, .${CONFIG.BUTTON_CLASS} svg,
        #${CONFIG.FS_BUTTON_ID} svg, .${CONFIG.FS_BUTTON_CLASS} svg {
          width: 24px !important; height: 24px !important;
          fill: none !important; stroke: #fff !important;
          stroke-width: 2 !important;
          stroke-linecap: round !important; stroke-linejoin: round !important;
          pointer-events: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  };

  const PiP = {
    async toggle(event) {
      if (event) {
        event.preventDefault(); event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }
      try {
        const video = Utils.getVideo();
        if (!video) return;
        if (!document.pictureInPictureEnabled) return;
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          if (video.paused) await video.play().catch(() => {});
          await video.requestPictureInPicture();
        }
      } catch (e) { console.error('[YouTube PiP]', e); }
    },
    isActive() { return !!document.pictureInPictureElement; }
  };

  const Fullscreen = {
    async enter(event) {
      if (event) {
        event.preventDefault(); event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        }
        const player = Utils.getPlayer();
        if (!player) return;
        if (player.requestFullscreen) await player.requestFullscreen();
        else if (player.webkitRequestFullscreen) await player.webkitRequestFullscreen();
        else if (player.mozRequestFullScreen) await player.mozRequestFullScreen();
        else if (player.msRequestFullscreen) await player.msRequestFullscreen();
      } catch (e) { console.error('[YouTube PiP]', e); }
    }
  };

  const Button = {
    createPip() {
      const btn = document.createElement('button');
      btn.id = CONFIG.BUTTON_ID;
      btn.type = 'button';
      btn.className = `ytp-button ${CONFIG.BUTTON_CLASS}`;
      btn.setAttribute('aria-label', 'Мини-окно (Picture-in-Picture)');
      btn.setAttribute('title', 'Мини-окно — Alt+P');
      btn.appendChild(Utils.createSvgPip());
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        PiP.toggle();
      }, true);
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      return btn;
    },
    createFullscreen() {
      const btn = document.createElement('button');
      btn.id = CONFIG.FS_BUTTON_ID;
      btn.type = 'button';
      btn.className = `ytp-button ${CONFIG.FS_BUTTON_CLASS}`;
      btn.setAttribute('aria-label', 'Развернуть на весь экран');
      btn.setAttribute('title', 'Развернуть на весь экран — Alt+F');
      btn.appendChild(Utils.createSvgFullscreen());
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        Fullscreen.enter();
      }, true);
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      return btn;
    }
  };

  const Injector = {
    findControls() {
      const sels = [
        '.ytp-right-controls-right', '.ytp-right-controls',
        '#movie_player .ytp-right-controls-right',
        '#movie_player .ytp-right-controls',
        '.ytp-chrome-controls .ytp-right-controls',
        '.ytp-chrome-bottom .ytp-right-controls'
      ];
      for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
      return null;
    },
    findFullscreenButton(controls) {
      return controls.querySelector('.ytp-fullscreen-button') ||
        controls.querySelector('button[aria-label*="полный" i]') ||
        controls.querySelector('button[title*="полный" i]') ||
        controls.querySelector('button[aria-label*="Full" i]') ||
        controls.querySelector('button[title*="Full" i]');
    },
    injectPipButton() {
      Styles.inject();
      if (document.getElementById(CONFIG.BUTTON_ID)) return true;
      const controls = this.findControls();
      if (!controls) return false;
      document.querySelectorAll(`.${CONFIG.BUTTON_CLASS}`).forEach(el => {
        if (el.id !== CONFIG.BUTTON_ID) el.remove();
      });
      const btn = Button.createPip();
      const fsBtn = this.findFullscreenButton(controls);
      if (fsBtn) controls.insertBefore(btn, fsBtn);
      else controls.appendChild(btn);
      State.injected = true;
      return true;
    },
    injectFullscreenButton() {
      Styles.inject();
      if (document.getElementById(CONFIG.FS_BUTTON_ID)) return true;
      const controls = this.findControls();
      if (!controls) return false;
      const btn = Button.createFullscreen();
      const pipBtn = document.getElementById(CONFIG.BUTTON_ID);
      if (pipBtn && pipBtn.parentNode === controls) {
        controls.insertBefore(btn, pipBtn.nextSibling);
      } else {
        const fsBtn = this.findFullscreenButton(controls);
        if (fsBtn) controls.insertBefore(btn, fsBtn);
        else controls.appendChild(btn);
      }
      State.fsInjected = true;
      return true;
    },
    removeFullscreenButton() {
      const btn = document.getElementById(CONFIG.FS_BUTTON_ID);
      if (btn) btn.remove();
      State.fsInjected = false;
    },
    updateButtons() {
      if (PiP.isActive()) {
        if (!document.getElementById(CONFIG.FS_BUTTON_ID)) this.injectFullscreenButton();
      } else {
        this.removeFullscreenButton();
      }
    },
    startWatching() {
      document.addEventListener('yt-navigate-finish', () => {
        setTimeout(() => { this.injectPipButton(); this.updateButtons(); }, 400);
        setTimeout(() => { this.injectPipButton(); this.updateButtons(); }, 1500);
      });
      if (State.observer) State.observer.disconnect();
      State.observer = new MutationObserver(() => {
        if (!document.getElementById(CONFIG.BUTTON_ID)) this.injectPipButton();
        this.updateButtons();
      });
      State.observer.observe(document.documentElement, { childList: true, subtree: true });
      const video = Utils.getVideo();
      if (video) {
        video.addEventListener('enterpictureinpicture', () => this.updateButtons());
        video.addEventListener('leavepictureinpicture', () => this.updateButtons());
      }
    }
  };

  const Hotkey = {
    register() {
      document.addEventListener('keydown', (e) => {
        if (Utils.isEditableElement(document.activeElement)) return;
        const hkPip = CONFIG.HOTKEY_PIP, hkFs = CONFIG.HOTKEY_FS;
        if (e.altKey === hkPip.alt && e.ctrlKey === hkPip.ctrl && e.shiftKey === hkPip.shift &&
            e.metaKey === hkPip.meta && e.key.toLowerCase() === hkPip.key) {
          e.preventDefault(); e.stopPropagation(); PiP.toggle(); return;
        }
        if (e.altKey === hkFs.alt && e.ctrlKey === hkFs.ctrl && e.shiftKey === hkFs.shift &&
            e.metaKey === hkFs.meta && e.key.toLowerCase() === hkFs.key) {
          e.preventDefault(); e.stopPropagation(); Fullscreen.enter();
        }
      }, true);
    }
  };

  const Menu = {
    register() {
      GM_registerMenuCommand(`📋 Что нового в v${CONFIG.VERSION}`, () => Changelog.showDialog());
    }
  };

  async function init() {
    console.log(`[YouTube PiP] v${CONFIG.VERSION} загружается...`);
    await Changelog.checkAndShow();
    Menu.register();
    Hotkey.register();
    Injector.injectPipButton();
    Injector.startWatching();
    console.log(`[YouTube PiP] v${CONFIG.VERSION} готов`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
