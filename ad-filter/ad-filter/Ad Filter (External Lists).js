// ==UserScript==
// @name         Ad Filter (External Lists)
// @namespace    https://github.com/Stiffan-de/stiff-scripts
// @version      1.4.1
// @description  Фильтр рекламы: внешние списки, автономное обновление, живая панель с таймером, кэш, свои правила, :has-text(), настраиваемые хоткеи.
// @author       Stiffan-de
// @copyright    2026, Stiffan-de (https://github.com/Stiffan-de)
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @homepageURL  https://github.com/Stiffan-de/stiff-scripts
// @supportURL   https://github.com/Stiffan-de/stiff-scripts/issues
// @updateURL    https://raw.githubusercontent.com/Stiffan-de/stiff-scripts/main/ad-filter/ad-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/Stiffan-de/stiff-scripts/main/ad-filter/ad-filter.user.js
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      easylist.to
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      filters.adtidy.org
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* eslint-disable no-return-assign */

(function () {
    'use strict';

    // ============================================================
    //  КОНФИГ
    // ============================================================
    const CONFIG = {
        VERSION: '1.4.1',
        CACHE_TTL: 24 * 60 * 60 * 1000,
        FETCH_TIMEOUT: 20000,
        APPLY_DEBOUNCE: 500,
        MAX_CACHE_RULES: 200000,
        AUTO_REFRESH_HOURS: 6,
        AUTO_REFRESH_CHECK_MS: 60000,
        PANEL_UPDATE_MS: 2000,
        STORAGE_KEYS: {
            CACHE: 'adf_cache_v3',
            CUSTOM: 'adf_custom_rules',
            EXCLUDES: 'adf_excludes',
            ENABLED: 'adf_enabled',
            LAST_UPDATE: 'adf_last_update',
            HOTKEYS: 'adf_hotkeys'
        },
        DEFAULT_HOTKEYS: {
            togglePanel: 'Alt+A',
            toggleFilter: 'Alt+Shift+F'
        },
        FILTER_SOURCES: [
            { name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
            { name: 'uBlock Filters', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt' },
            { name: 'YouTube Clear View', url: 'https://raw.githubusercontent.com/yokoffing/filterlists/main/youtube_clear_view.txt' },
            { name: 'AdGuard Base', url: 'https://filters.adtidy.org/extension/ublock/filters/2.txt' }
        ]
    };

    // ============================================================
    //  СОСТОЯНИЕ
    // ============================================================
    let enabled = true;
    let rules = [];
    let customRules = [];
    let excludes = [];
    let lastUpdate = 0;
    let hotkeys = { ...CONFIG.DEFAULT_HOTKEYS };
    let _timeout = null;
    let _appliedNow = 0;
    let panel = null;
    let recordingKey = null;
    let panelUpdateTimer = null;

    // ============================================================
    //  STORAGE
    // ============================================================
    async function storeGet(key, def) {
        try {
            const v = await GM_getValue(key, def);
            return v === undefined ? def : v;
        } catch (e) { return def; }
    }

    async function storeSet(key, val) {
        try { await GM_setValue(key, val); return true; }
        catch (e) { return false; }
    }

    async function storeDel(key) {
        try { await GM_deleteValue(key); return true; }
        catch (e) { return false; }
    }

    // ============================================================
    //  PARSER
    // ============================================================
    const PROCEDURAL = [
        ':has-text', ':matches-css', ':matches-media', ':matches-path',
        ':min-text-length', '+js', '##+js', '#@#+js'
    ];

    function parseRule(line) {
        const t = line.trim();
        if (!t || t.startsWith('!') || t.startsWith('[')) return null;

        let sep = null, isExc = false;
        if (t.includes('#@#')) { sep = '#@#'; isExc = true; }
        else if (t.includes('##')) { sep = '##'; }
        else return null;

        const parts = t.split(sep);
        if (parts.length !== 2) return null;

        const domain = parts[0].trim();
        const sel = parts[1].trim();
        if (!domain || !sel) return null;
        if (PROCEDURAL.some(m => sel.includes(m))) return null;
        if (sel.startsWith('{') || sel.startsWith(':')) return null;

        let hasText = null;
        const m = sel.match(/:has-text\(([^)]+)\)/);
        if (m) hasText = m[1].trim().replace(/^["']|["']$/g, '');
        const cleanSel = sel.replace(/:has-text\([^)]+\)/g, '').trim();

        return { domain, selector: cleanSel, hasText, isException: isExc };
    }

    function parseList(text) {
        const out = [];
        for (const line of text.split('\n')) {
            const r = parseRule(line);
            if (r) out.push(r);
        }
        return out;
    }

    // ============================================================
    //  FETCH
    // ============================================================
    function fetchUrl(url) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: CONFIG.FETCH_TIMEOUT,
                onload: (r) => resolve(r.status >= 200 && r.status < 300 ? r.responseText : null),
                onerror: () => resolve(null),
                ontimeout: () => resolve(null)
            });
        });
    }

    async function fetchAll() {
        const all = [];
        for (const src of CONFIG.FILTER_SOURCES) {
            const text = await fetchUrl(src.url);
            if (!text) continue;
            const parsed = parseList(text);
            all.push(...parsed);
            console.log(`[AdF] ${src.name}: ${parsed.length} rules`);
        }
        return all;
    }

    // ============================================================
    //  CACHE
    // ============================================================
    async function cacheGet() {
        const c = await storeGet(CONFIG.STORAGE_KEYS.CACHE, null);
        if (!c || !c.ts || !c.rules) return null;
        if (Date.now() - c.ts > CONFIG.CACHE_TTL) {
            await storeDel(CONFIG.STORAGE_KEYS.CACHE);
            return null;
        }
        return c.rules;
    }

    async function cacheSet(r) {
        const lim = r.slice(0, CONFIG.MAX_CACHE_RULES);
        await storeSet(CONFIG.STORAGE_KEYS.CACHE, { ts: Date.now(), rules: lim });
    }

    async function cacheClear() {
        await storeDel(CONFIG.STORAGE_KEYS.CACHE);
    }

    // ============================================================
    //  MATCHER
    // ============================================================
    function domainMatch(ruleDomain, cur) {
        if (ruleDomain === cur || ruleDomain === '*') return true;
        if (ruleDomain.startsWith('*.')) {
            const b = ruleDomain.slice(2);
            return cur.endsWith('.' + b) || cur === b;
        }
        if (ruleDomain === 'www.' + cur) return true;
        if (cur === 'www.' + ruleDomain) return true;
        return false;
    }

    function isExcluded(host) {
        return excludes.some(ex => {
            ex = (ex || '').trim().toLowerCase();
            if (!ex) return false;
            if (ex === host) return true;
            if (ex.startsWith('*.')) {
                const b = ex.slice(2);
                return host.endsWith('.' + b) || host === b;
            }
            return host.includes(ex);
        });
    }

    // ============================================================
    //  APPLIER
    // ============================================================
    function applyRule(rule) {
        let cnt = 0;
        try {
            const els = document.querySelectorAll(rule.selector);
            els.forEach(el => {
                if (rule.hasText) {
                    const txt = (el.textContent || '').toLowerCase();
                    if (!txt.includes(rule.hasText.toLowerCase())) return;
                }
                if (el.style.display !== 'none') {
                    el.style.display = 'none';
                    el.dataset.adfHidden = 'true';
                    cnt++;
                }
            });
        } catch (e) { /* invalid */ }
        return cnt;
    }

    function applyAll() {
        if (!enabled) return;
        if (isExcluded(location.hostname)) return;

        const all = [...rules, ...customRules];
        const exc = all.filter(r => r.isException);
        const norm = all.filter(r => !r.isException);
        let applied = 0;

        for (const rule of norm) {
            if (!domainMatch(rule.domain, location.hostname)) continue;
            if (exc.some(e => e.selector === rule.selector && domainMatch(e.domain, location.hostname))) continue;
            applied += applyRule(rule);
        }
        _appliedNow = applied;
        if (applied > 0) console.log(`[AdF] Applied ${applied} on ${location.hostname}`);
    }

    function restore() {
        document.querySelectorAll('[data-adf-hidden="true"]').forEach(el => {
            el.style.display = '';
            delete el.dataset.adfHidden;
        });
    }

    // ============================================================
    //  HOTKEYS
    // ============================================================
    function parseCombo(c) {
        if (typeof c !== 'string' || !c) return null;
        const parts = c.split('+').map(p => p.trim());
        return {
            alt: parts.includes('Alt'),
            ctrl: parts.includes('Ctrl'),
            shift: parts.includes('Shift'),
            meta: parts.includes('Meta'),
            key: (parts.filter(p => !['Alt', 'Ctrl', 'Shift', 'Meta'].includes(p))[0] || '').toLowerCase()
        };
    }

    function isValidCombo(combo) {
        if (typeof combo !== 'string' || !combo) return false;
        const p = parseCombo(combo);
        if (!p) return false;
        if (!p.alt && !p.ctrl && !p.shift && !p.meta) return false;
        if (!p.key) return false;
        return true;
    }

    function comboMatch(e, c) {
        const p = parseCombo(c);
        if (!p) return false;
        return e.altKey === p.alt && e.ctrlKey === p.ctrl &&
               e.shiftKey === p.shift && e.metaKey === p.meta &&
               e.key.toLowerCase() === p.key;
    }

    function eventToCombo(e) {
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');

        let key = e.key;
        if (key === ' ') key = 'Space';
        if (key.length === 1) key = key.toUpperCase();
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;

        parts.push(key);
        return parts.join('+');
    }

    function registerHotkeys() {
        document.addEventListener('keydown', (e) => {
            if (recordingKey) {
                e.preventDefault();
                e.stopPropagation();

                if (e.key === 'Escape') {
                    recordingKey = null;
                    renderPanel();
                    return;
                }

                const combo = eventToCombo(e);
                if (!combo) return;

                const p = parseCombo(combo);
                if (!p.alt && !p.ctrl && !p.shift && !p.meta) return;

                hotkeys[recordingKey] = combo;
                storeSet(CONFIG.STORAGE_KEYS.HOTKEYS, hotkeys);
                console.log(`[AdF] Hotkey set: ${recordingKey} = ${combo}`);
                recordingKey = null;
                renderPanel();
                return;
            }

            const tag = (document.activeElement?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;

            if (comboMatch(e, hotkeys.togglePanel)) {
                e.preventDefault();
                e.stopPropagation();
                togglePanel();
            } else if (comboMatch(e, hotkeys.toggleFilter)) {
                e.preventDefault();
                e.stopPropagation();
                toggleFilter();
            }
        }, true);
    }

    async function loadHotkeys() {
        try {
            const saved = await storeGet(CONFIG.STORAGE_KEYS.HOTKEYS, null);
            if (!saved || typeof saved !== 'object') return;

            for (const action of Object.keys(CONFIG.DEFAULT_HOTKEYS)) {
                const combo = saved[action];
                if (combo && isValidCombo(combo)) {
                    hotkeys[action] = combo;
                }
            }

            await storeSet(CONFIG.STORAGE_KEYS.HOTKEYS, hotkeys);
        } catch (e) {
            console.warn('[AdF] loadHotkeys error:', e);
        }
    }

    // ============================================================
    //  AUTO-REFRESH
    // ============================================================
    const AutoRefresh = {
        timer: null,

        start() {
            console.log('[AdF] AutoRefresh запущен');
            this.check();

            if (this.timer) clearInterval(this.timer);
            this.timer = setInterval(() => this.check(), CONFIG.AUTO_REFRESH_CHECK_MS);

            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.check();
            });
        },

        async check() {
            try {
                if (!enabled) return;

                const ageMs = Date.now() - lastUpdate;
                const ageHours = ageMs / (1000 * 60 * 60);

                if (ageHours < CONFIG.AUTO_REFRESH_HOURS) return;

                console.log(`[AdF] Автообновление: кэш старше ${ageHours.toFixed(1)}ч`);
                await refresh(true);

                if (panel && panel.style.display === 'flex') {
                    renderPanel();
                }
            } catch (e) {
                console.warn('[AdF] AutoRefresh error:', e);
            }
        }
    };

    // ============================================================
    //  PANEL
    // ============================================================
    function buildPanel() {
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'adf-panel';
        panel.style.cssText = [
            'position: fixed',
            'top: 80px',
            'right: 20px',
            'width: 340px',
            'max-height: 70vh',
            'background: #1e1e2e',
            'color: #e0e0e0',
            'border-radius: 12px',
            'z-index: 999999',
            'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            'font-size: 13px',
            'box-shadow: 0 8px 32px rgba(0,0,0,0.5)',
            'display: none',
            'flex-direction: column',
            'overflow: hidden',
            'border: 1px solid #333'
        ].join(';');

        const header = document.createElement('div');
        header.id = 'adf-panel-header';
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#2a2a3a;border-bottom:1px solid #444;cursor:move;user-select:none;';

        const title = document.createElement('div');
        title.textContent = '🛡️ Ad Filter v' + CONFIG.VERSION;
        title.style.cssText = 'font-weight:600;font-size:14px;';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:22px;padding:0 6px;line-height:1;';
        closeBtn.addEventListener('click', () => {
            if (panel) panel.style.display = 'none';
            stopPanelLiveUpdate();
        });

        header.appendChild(title);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.id = 'adf-panel-body';
        body.style.cssText = 'flex:1;overflow-y:auto;padding:12px;';

        panel.appendChild(header);
        panel.appendChild(body);
        document.body.appendChild(panel);

        makeDraggable(panel, header);
        return panel;
    }

    function makeDraggable(el, handle) {
        let ox = 0, oy = 0, drag = false;

        const move = (e) => {
            if (!drag) return;
            let nl = Math.max(0, Math.min(e.clientX - ox, window.innerWidth - el.offsetWidth));
            let nt = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - el.offsetHeight));
            el.style.left = nl + 'px';
            el.style.top = nt + 'px';
        };

        const up = () => {
            drag = false;
            handle.style.cursor = 'move';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        };

        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            drag = true;
            const r = el.getBoundingClientRect();
            ox = e.clientX - r.left;
            oy = e.clientY - r.top;
            el.style.left = r.left + 'px';
            el.style.top = r.top + 'px';
            el.style.right = 'auto';
            handle.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    }

    function buildHotkeyRow(label, action) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;';

        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.color = '#999';

        const isRecording = recordingKey === action;

        const btn = document.createElement('button');
        btn.textContent = isRecording ? '⏺ Нажмите...' : hotkeys[action];
        btn.style.cssText = [
            'background:' + (isRecording ? '#ff6b6b' : '#3a3a4a'),
            'color:#fff',
            'border:1px solid ' + (isRecording ? '#ff6b6b' : '#555'),
            'border-radius:4px',
            'padding:3px 8px',
            'font-size:11px',
            'font-family:monospace',
            'cursor:pointer',
            'min-width:110px',
            'text-align:center'
        ].join(';');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            recordingKey = action;
            renderPanel();
        });

        row.appendChild(lbl);
        row.appendChild(btn);
        return row;
    }

    function formatLastUpdate(ts) {
        if (!ts) return 'никогда';
        const d = new Date(ts);
        return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU');
    }

    function formatNextRefresh() {
        if (!lastUpdate) return '—';

        const ageMs = Date.now() - lastUpdate;
        const intervalMs = CONFIG.AUTO_REFRESH_HOURS * 60 * 60 * 1000;
        const nextMs = intervalMs - ageMs;

        if (nextMs <= 0) return 'сейчас';

        const hours = Math.floor(nextMs / (60 * 60 * 1000));
        const minutes = Math.floor((nextMs % (60 * 60 * 1000)) / (60 * 1000));
        const seconds = Math.floor((nextMs % (60 * 1000)) / 1000);

        if (hours > 0) {
            return `${hours}ч ${String(minutes).padStart(2, '0')}м ${String(seconds).padStart(2, '0')}с`;
        }
        return `${minutes}м ${String(seconds).padStart(2, '0')}с`;
    }

    function renderPanel() {
        try {
            const body = document.getElementById('adf-panel-body');
            if (!body) return;

            while (body.firstChild) body.removeChild(body.firstChild);

            const sb = document.createElement('div');
            sb.style.cssText = 'background:#2a2a3a;border-radius:8px;padding:10px;margin-bottom:12px;';

            const lines = [
                ['Статус', enabled ? '✅ Включён' : '⏸️ Выключен'],
                ['Правил из списков', String(rules.length || 0)],
                ['Своих правил', String(customRules.length || 0)],
                ['Исключений', String(excludes.length || 0)],
                ['Скрыто на этой странице', String(_appliedNow || 0)],
                ['Обновлён', formatLastUpdate(lastUpdate)],
                ['Следующее обновление', formatNextRefresh()]
            ];

            lines.forEach(([l, v]) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0;';
                const ls = document.createElement('span');
                ls.textContent = l;
                ls.style.color = '#999';
                const vs = document.createElement('span');
                vs.textContent = v;
                vs.style.fontWeight = '500';
                if (l === 'Обновлён') vs.style.color = '#4a90e2';
                if (l === 'Следующее обновление') vs.style.color = '#4caf50';
                row.appendChild(ls);
                row.appendChild(vs);
                sb.appendChild(row);
            });
            body.appendChild(sb);

            const actions = [
                { l: '🔄 Обновить списки', a: () => refresh(true) },
                { l: '⏸️ Вкл/Выкл фильтр', a: () => toggleFilter() },
                { l: '🗑️ Очистить кэш', a: async () => {
                    if (confirm('Очистить кэш?')) { await cacheClear(); alert('Кэш очищен'); }
                }}
            ];
            actions.forEach(({ l, a }) => {
                const btn = document.createElement('button');
                btn.textContent = l;
                btn.style.cssText = 'width:100%;padding:8px;margin-bottom:6px;background:#4a90e2;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;';
                btn.addEventListener('mouseenter', () => { btn.style.background = '#357abd'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = '#4a90e2'; });
                btn.addEventListener('click', async () => { await a(); await renderPanel(); });
                body.appendChild(btn);
            });

            const hkSection = document.createElement('div');
            hkSection.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #333;';

            const hkTitle = document.createElement('div');
            hkTitle.textContent = '⌨️ Горячие клавиши';
            hkTitle.style.cssText = 'font-size:11px;color:#888;text-transform:uppercase;margin-bottom:8px;';
            hkSection.appendChild(hkTitle);

            hkSection.appendChild(buildHotkeyRow('Открыть панель', 'togglePanel'));
            hkSection.appendChild(buildHotkeyRow('Вкл/Выкл фильтр', 'toggleFilter'));

            const hint = document.createElement('div');
            hint.textContent = 'Клик по комбинации → нажмите новые клавиши. Esc — отмена.';
            hint.style.cssText = 'font-size:10px;color:#666;margin-top:8px;line-height:1.4;';
            hkSection.appendChild(hint);

            body.appendChild(hkSection);
        } catch (e) {
            console.error('[AdF] renderPanel error:', e);
        }
    }

    function startPanelLiveUpdate() {
        if (panelUpdateTimer) clearInterval(panelUpdateTimer);
        panelUpdateTimer = setInterval(() => {
            if (panel && panel.style.display === 'flex') {
                renderPanel();
            } else {
                clearInterval(panelUpdateTimer);
                panelUpdateTimer = null;
            }
        }, CONFIG.PANEL_UPDATE_MS);
    }

    function stopPanelLiveUpdate() {
        if (panelUpdateTimer) {
            clearInterval(panelUpdateTimer);
            panelUpdateTimer = null;
        }
    }

    function togglePanel() {
        if (!panel) buildPanel();
        if (!panel) return;

        const visible = panel.style.display === 'flex';
        panel.style.display = visible ? 'none' : 'flex';

        if (!visible) {
            renderPanel();
            startPanelLiveUpdate();
        } else {
            stopPanelLiveUpdate();
        }
    }

    async function toggleFilter() {
        enabled = !enabled;
        await storeSet(CONFIG.STORAGE_KEYS.ENABLED, enabled);
        if (enabled) applyAll();
        else restore();
    }

    async function refresh(force) {
        console.log('[AdF] Обновление списков...');
        rules = await fetchAll();
        lastUpdate = Date.now();
        await storeSet(CONFIG.STORAGE_KEYS.LAST_UPDATE, lastUpdate);
        await cacheSet(rules);
        applyAll();
        console.log(`[AdF] Обновлено: ${rules.length} правил`);
    }

    // ============================================================
    //  OBSERVER
    // ============================================================
    function startObserver() {
        new MutationObserver(() => {
            clearTimeout(_timeout);
            _timeout = setTimeout(applyAll, CONFIG.APPLY_DEBOUNCE);
        }).observe(document.body, { childList: true, subtree: true });
    }

    // ============================================================
    //  МЕНЮ
    // ============================================================
    function registerMenu() {
        GM_registerMenuCommand('🌐 Открыть панель', () => togglePanel());
        GM_registerMenuCommand('⏸️ Вкл/Выкл фильтр', () => toggleFilter());
        GM_registerMenuCommand('🔄 Обновить списки', () => refresh(true));
        GM_registerMenuCommand('➕ Добавить правило', async () => {
            const input = prompt('Формат: domain##selector\nПример: youtube.com##.video-ads', '');
            if (!input) return;
            const rule = parseRule(input);
            if (!rule) { alert('Неверный формат'); return; }
            customRules.push(rule);
            await storeSet(CONFIG.STORAGE_KEYS.CUSTOM, customRules);
            applyAll();
            alert('Правило добавлено');
        });
        GM_registerMenuCommand('🚫 Добавить исключение', async () => {
            const input = prompt('Домен:', location.hostname);
            if (!input) return;
            excludes.push(input.trim().toLowerCase());
            await storeSet(CONFIG.STORAGE_KEYS.EXCLUDES, excludes);
            alert('Исключение добавлено');
        });
        GM_registerMenuCommand('🗑️ Очистить кэш', async () => {
            await cacheClear();
            alert('Кэш очищен');
        });
        GM_registerMenuCommand('📊 Статистика', () => {
            alert(
                `Правил: ${rules.length}\n` +
                `Своих: ${customRules.length}\n` +
                `Исключений: ${excludes.length}\n` +
                `Скрыто здесь: ${_appliedNow}\n` +
                `Обновлён: ${formatLastUpdate(lastUpdate)}\n` +
                `Следующее: ${formatNextRefresh()}\n` +
                `Панель: ${hotkeys.togglePanel}\n` +
                `Фильтр: ${hotkeys.toggleFilter}`
            );
        });
    }

    // ============================================================
    //  ЗАПУСК
    // ============================================================
    (async () => {
        try {
            console.log('[AdF] Script loaded on', location.hostname);

            enabled = (await storeGet(CONFIG.STORAGE_KEYS.ENABLED, true)) !== false;
            customRules = (await storeGet(CONFIG.STORAGE_KEYS.CUSTOM, [])) || [];
            excludes = (await storeGet(CONFIG.STORAGE_KEYS.EXCLUDES, [])) || [];
            lastUpdate = (await storeGet(CONFIG.STORAGE_KEYS.LAST_UPDATE, 0)) || 0;

            await loadHotkeys();

            registerMenu();
            registerHotkeys();

            const cached = await cacheGet();
            if (cached) {
                rules = cached;
            } else {
                rules = await fetchAll();
                lastUpdate = Date.now();
                await storeSet(CONFIG.STORAGE_KEYS.LAST_UPDATE, lastUpdate);
                await cacheSet(rules);
            }

            applyAll();
            startObserver();
            AutoRefresh.start();

            console.log('[AdF] Initialized v' + CONFIG.VERSION);
        } catch (e) {
            console.error('[AdF] Init failed:', e);
        }
    })();

})();
