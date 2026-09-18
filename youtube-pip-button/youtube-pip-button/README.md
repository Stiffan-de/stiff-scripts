# 🎬 YouTube PiP Button

Небольшой userscript, который добавляет кнопку Picture-in-Picture в плеер YouTube и горячую клавишу `Alt+P`.

## ✨ Возможности

- 🖼️ **Кнопка PiP** в панели управления плеером.
- ⌨️ **Горячая клавиша** `Alt+P` для быстрого открытия мини-окна.
- 🖥️ **Кнопка Fullscreen** в PiP-режиме — разворачивает видео на весь экран.
- ⌨️ **Хоткей** `Alt+F` — развернуть на весь экран.
- 🔄 Работает на `youtube.com`, `m.youtube.com`.
- 📱 Совместимость со старым и новым UI.
- 📜 **Changelog** через меню Tampermonkey.

## 📥 Установка

1. Установи **Tampermonkey** или **Violentmonkey**.
2. Нажми **[Установить](https://raw.githubusercontent.com/StiffMusic/stiffmusic-userscripts/main/youtube-pip-button/youtube-pip-button.user.js)**.
3. Подтверди установку.

## 🎯 Использование

| Действие | Как |
|---|---|
| Открыть мини-окно | Клик по кнопке PiP в плеере или `Alt+P` |
| Закрыть мини-окно | Клик по кнопке PiP или `Alt+P` |
| Развернуть на весь экран | Кнопка Fullscreen (появляется в PiP) или `Alt+F` |

## 📜 Changelog

### 1.4.0 (18.09.2026)
- 🖥️ Кнопка «Развернуть на весь экран» в PiP-режиме.
- ⌨️ Хоткей `Alt+F`.

### 1.3.0 (17.09.2026)
- 🧩 Модульная структура.
- 🐛 Клик по кнопке PiP теперь работает корректно.

### 1.2.1 (15.09.2026)
- 🔒 Убран `innerHTML` (Trusted Types).
- 🎯 `@run-at` изменён на `document-idle`.

### 1.0.0 (01.09.2026)
- 🎉 Первый релиз.

## 🐛 Проблемы

Создай **[issue](https://github.com/StiffMusic/stiffmusic-userscripts/issues)** с описанием проблемы и скриншотом консоли (`F12` → Console).

## 📜 Лицензия

[PolyForm Noncommercial 1.0.0](../LICENSE) — **коммерческое использование запрещено**.
