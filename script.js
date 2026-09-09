/*
 * EPUB 阅读器 —— 基于 epub.js (v0.3) 渲染核心
 * 功能：打开/拖拽加载、明暗主题、字号与衬线切换、嵌套目录、
 *       全书进度条、CFI 级阅读位置记忆、键盘/触摸翻页
 */
(function () {
    'use strict';

    var STORAGE = {
        theme: 'epub-reader-theme',
        fontSize: 'epub-reader-font-size',
        serif: 'epub-reader-serif',
        progress: 'epub-reader-progress'
    };

    var FONT_MIN = 14;
    var FONT_MAX = 26;
    var FONT_DEFAULT = 17;

    var SERIF_STACK = "'Source Han Serif SC', 'Noto Serif CJK SC', 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', serif";
    var SANS_STACK = "'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Hiragino Sans GB', 'SimHei', sans-serif";

    // epub.js 书内主题（应用外壳主题由 style.css 的 CSS 变量负责）
    var BOOK_THEMES = {
        light: {
            body: {
                color: '#322c26 !important',
                background: '#fffdf8 !important',
                'line-height': '1.8 !important'
            },
            a: { color: '#9a5d43 !important' },
            img: { 'box-shadow': 'none !important' }
        },
        dark: {
            body: {
                color: '#e7e0d5 !important',
                background: '#191816 !important',
                'line-height': '1.8 !important'
            },
            a: { color: '#d89a76 !important' },
            img: { 'box-shadow': 'none !important' }
        }
    };

    class EpubReader {
        constructor() {
            this.book = null;
            this.rendition = null;
            this.bookKey = null;       // 文件名 + 大小，用于匹配进度
            this.bookTitle = '';
            this.locationsReady = false;
            this.lastLocation = null;
            this.pendingRestore = null;
            this.restoredProgressOverride = null;
            this.touchStartX = 0;

            this.fontSize = this.loadFontSize();
            this.serif = localStorage.getItem(STORAGE.serif) !== '0';

            this.initElements();
            this.initTheme();
            this.bindEvents();
            this.updateFontUI();
            this.checkSavedProgress();
        }

        initElements() {
            this.elements = {
                fileInput: document.getElementById('file-input'),
                openFileBtn: document.getElementById('open-file'),
                toggleTocBtn: document.getElementById('toggle-toc'),
                tocPanel: document.getElementById('toc-panel'),
                tocMask: document.getElementById('toc-mask'),
                tocList: document.getElementById('toc-list'),
                viewer: document.getElementById('viewer'),
                emptyState: document.getElementById('empty-state'),
                loading: document.getElementById('loading'),
                loadingText: document.getElementById('loading-text'),
                prevPageBtn: document.getElementById('prev-page'),
                nextPageBtn: document.getElementById('next-page'),
                progressFill: document.getElementById('progress-fill'),
                progressText: document.getElementById('progress-text'),
                bookTitle: document.getElementById('book-title'),
                themeToggle: document.getElementById('theme-toggle'),
                fontDecrease: document.getElementById('font-decrease'),
                fontIncrease: document.getElementById('font-increase'),
                fontSizeLabel: document.getElementById('font-size-label'),
                fontFamilyToggle: document.getElementById('font-family-toggle'),
                dropOverlay: document.getElementById('drop-overlay')
            };
        }

        /* ================= 主题 ================= */

        initTheme() {
            var saved = localStorage.getItem(STORAGE.theme);
            var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.theme = saved || (prefersDark ? 'dark' : 'light');
            this.applyTheme();
        }

        toggleTheme() {
            this.theme = this.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem(STORAGE.theme, this.theme);
            this.applyTheme();
        }

        applyTheme() {
            document.documentElement.setAttribute('data-theme', this.theme);
            this.elements.themeToggle.textContent = this.theme === 'dark' ? '🌙' : '☀️';
            // epub.js 的主题切换是即时的，无需重新渲染
            if (this.rendition) {
                this.rendition.themes.select(this.theme);
            }
        }

        /* ================= 字号 / 字体 ================= */

        loadFontSize() {
            var n = parseInt(localStorage.getItem(STORAGE.fontSize), 10);
            if (isNaN(n)) return FONT_DEFAULT;
            return Math.min(FONT_MAX, Math.max(FONT_MIN, n));
        }

        changeFontSize(delta) {
            this.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, this.fontSize + delta));
            localStorage.setItem(STORAGE.fontSize, String(this.fontSize));
            this.updateFontUI();
            if (this.rendition) {
                this.rendition.themes.fontSize(this.fontSize + 'px');
            }
        }

        toggleSerif() {
            this.serif = !this.serif;
            localStorage.setItem(STORAGE.serif, this.serif ? '1' : '0');
            this.updateFontUI();
            if (this.rendition) {
                this.rendition.themes.font(this.fontStack());
            }
        }

        fontStack() {
            return this.serif ? SERIF_STACK : SANS_STACK;
        }

        updateFontUI() {
            this.elements.fontSizeLabel.textContent = this.fontSize;
            this.elements.fontFamilyToggle.textContent = this.serif ? '宋体' : '黑体';
            this.elements.fontFamilyToggle.title = this.serif ? '当前：宋体风格，点击切换黑体' : '当前：黑体风格，点击切换宋体';
        }

        // 每次 display 后应用字号/字体，保证新章节生效
        applyReadingPrefs() {
            if (!this.rendition) return;
            this.rendition.themes.fontSize(this.fontSize + 'px');
            this.rendition.themes.font(this.fontStack());
        }

        /* ================= 事件绑定 ================= */

        bindEvents() {
            var self = this;
            var el = this.elements;

            el.openFileBtn.addEventListener('click', function () { el.fileInput.click(); });
            el.fileInput.addEventListener('change', function (e) {
                var file = e.target.files[0];
                if (file) self.loadBook(file);
                el.fileInput.value = ''; // 允许重复选择同一文件
            });

            el.toggleTocBtn.addEventListener('click', function () { self.toggleToc(); });
            el.tocMask.addEventListener('click', function () { self.closeToc(); });

            el.prevPageBtn.addEventListener('click', function () { self.prev(); });
            el.nextPageBtn.addEventListener('click', function () { self.next(); });

            el.themeToggle.addEventListener('click', function () { self.toggleTheme(); });
            el.fontDecrease.addEventListener('click', function () { self.changeFontSize(-1); });
            el.fontIncrease.addEventListener('click', function () { self.changeFontSize(1); });
            el.fontFamilyToggle.addEventListener('click', function () { self.toggleSerif(); });

            // 键盘快捷键（外层文档；iframe 内按键由 rendition 事件转发）
            document.addEventListener('keydown', function (e) { self.handleKeydown(e); });

            // 拖拽打开
            var dragDepth = 0;
            window.addEventListener('dragenter', function (e) {
                e.preventDefault();
                dragDepth++;
                el.dropOverlay.classList.add('visible');
            });
            window.addEventListener('dragover', function (e) { e.preventDefault(); });
            window.addEventListener('dragleave', function (e) {
                e.preventDefault();
                if (--dragDepth <= 0) {
                    dragDepth = 0;
                    el.dropOverlay.classList.remove('visible');
                }
            });
            window.addEventListener('drop', function (e) {
                e.preventDefault();
                dragDepth = 0;
                el.dropOverlay.classList.remove('visible');
                var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (file) self.loadBook(file);
            });
        }

        handleKeydown(e) {
            var tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            switch (e.key) {
                case 'ArrowLeft':
                    this.prev();
                    break;
                case 'ArrowRight':
                    this.next();
                    break;
                case 'Escape':
                    this.closeToc();
                    break;
                case 't':
                case 'T':
                    this.toggleTheme();
                    break;
            }
        }

        prev() { if (this.rendition) this.rendition.prev(); }
        next() { if (this.rendition) this.rendition.next(); }

        /* ================= 目录抽屉 ================= */

        toggleToc() {
            var open = this.elements.tocPanel.classList.toggle('open');
            this.elements.tocMask.classList.toggle('visible', open);
        }

        closeToc() {
            this.elements.tocPanel.classList.remove('open');
            this.elements.tocMask.classList.remove('visible');
        }

        /* ================= 书籍加载 ================= */

        async loadBook(file) {
            if (!/\.epub$/i.test(file.name)) {
                this.toast('请选择 .epub 格式的文件');
                return;
            }

            this.showLoading('正在加载书籍…');
            try {
                // 清理旧书
                if (this.rendition) {
                    this.rendition.destroy();
                    this.rendition = null;
                }
                this.elements.viewer.innerHTML = '';
                this.book = null;
                this.locationsReady = false;
                this.lastLocation = null;
                this.setProgress(null);

                var buffer = await file.arrayBuffer();
                this.book = ePub(buffer);
                this.bookKey = file.name + ':' + file.size;
                await this.book.opened;

                var meta = this.book.packaging.metadata;
                this.bookTitle = meta.title || file.name.replace(/\.epub$/i, '');
                this.elements.bookTitle.textContent = this.bookTitle;
                document.title = this.bookTitle + ' · EPUB阅读器';

                this.rendition = this.book.renderTo(this.elements.viewer, {
                    width: '100%',
                    height: '100%',
                    flow: 'paginated',
                    spread: 'none',
                    minSpreadWidth: 10000 // 永远单栏
                });

                this.rendition.themes.register('light', BOOK_THEMES.light);
                this.rendition.themes.register('dark', BOOK_THEMES.dark);
                this.rendition.themes.select(this.theme);
                this.applyReadingPrefs();
                this.bindRenditionEvents();

                // 恢复位置（仅限同一本书）
                var target;
                if (this.pendingRestore && this.pendingRestore.bookKey === this.bookKey) {
                    target = this.pendingRestore.cfi;
                }
                this.pendingRestore = null;

                await this.rendition.display(target);

                this.hideLoading();
                this.elements.emptyState.classList.add('hidden');
                this.renderTOC();

                // 后台生成 locations，用于全书百分比
                var self = this;
                this.book.locations.generate(1000).then(function () {
                    self.locationsReady = true;
                    if (self.lastLocation) self.updateProgress(self.lastLocation);
                }).catch(function (e) {
                    console.warn('locations 生成失败:', e);
                });
            } catch (err) {
                console.error('加载书籍失败:', err);
                this.hideLoading();
                var reason = (err && (err.message || err.toString())) || '未知错误';
                this.showEmptyState('😕', '书籍加载失败', reason);
                this.toast('书籍加载失败：' + reason);
            }
        }

        bindRenditionEvents() {
            var self = this;
            var r = this.rendition;

            r.on('relocated', function (location) {
                self.lastLocation = location;
                self.updateProgress(location);
                self.saveProgress(location);
                self.highlightToc(location.start && location.start.href);
                self.elements.prevPageBtn.disabled = !!location.atStart;
                self.elements.nextPageBtn.disabled = !!location.atEnd;
            });

            // iframe 内的键盘事件转发
            r.on('keydown', function (e) { self.handleKeydown(e); });

            // 点击左右边缘翻页（链接点击不拦截）
            r.on('click', function (e) {
                try {
                    if (e.target && e.target.closest && e.target.closest('a')) return;
                } catch (err) { /* 忽略跨文档异常 */ }
                var rect = self.elements.viewer.getBoundingClientRect();
                var x = e.clientX - rect.left;
                if (x < rect.width * 0.2) self.prev();
                else if (x > rect.width * 0.8) self.next();
            });

            // 触摸滑动翻页
            r.on('touchstart', function (e) {
                if (e.changedTouches && e.changedTouches[0]) {
                    self.touchStartX = e.changedTouches[0].clientX;
                }
            });
            r.on('touchend', function (e) {
                if (!e.changedTouches || !e.changedTouches[0]) return;
                var dx = e.changedTouches[0].clientX - self.touchStartX;
                if (Math.abs(dx) > 50) {
                    if (dx < 0) self.next();
                    else self.prev();
                }
            });
        }

        /* ================= 目录 ================= */

        renderTOC() {
            var list = this.elements.tocList;
            list.innerHTML = '';
            var toc = (this.book.navigation && this.book.navigation.toc) || [];

            if (!toc.length) {
                list.innerHTML = '<li class="toc-empty">本书没有目录</li>';
                return;
            }
            for (var i = 0; i < toc.length; i++) {
                this.appendTocItem(list, toc[i], 0);
            }
        }

        appendTocItem(parent, item, depth) {
            var self = this;
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = '#';
            a.className = 'toc-link';
            a.style.paddingLeft = (14 + depth * 18) + 'px';
            a.textContent = (item.label || '未命名章节').replace(/\s+/g, ' ').trim();
            a.dataset.href = item.href || '';
            a.addEventListener('click', function (e) {
                e.preventDefault();
                if (item.href) {
                    self.restoredProgressOverride = null;
                    self.rendition.display(item.href);
                }
                if (window.innerWidth <= 768) self.closeToc();
            });
            li.appendChild(a);
            parent.appendChild(li);

            var subs = item.subitems || [];
            for (var i = 0; i < subs.length; i++) {
                this.appendTocItem(parent, subs[i], depth + 1);
            }
        }

        highlightToc(href) {
            if (!href) return;
            var current = href.split('#')[0];
            var links = this.elements.tocList.querySelectorAll('.toc-link');
            links.forEach(function (link) {
                var itemHref = (link.dataset.href || '').split('#')[0];
                link.classList.toggle('active', itemHref === current);
            });
        }

        /* ================= 进度 ================= */

        updateProgress(location) {
            var pct = null;
            if (this.locationsReady && location && location.start) {
                pct = Math.round(this.book.locations.percentageFromCfi(location.start.cfi) * 100);
            }
            this.setProgress(pct);
        }

        setProgress(pct) {
            if (pct === null || pct === undefined || isNaN(pct)) {
                this.elements.progressFill.style.width = '0%';
                this.elements.progressText.textContent = this.book ? '定位中…' : '--%';
                return;
            }
            pct = Math.min(100, Math.max(0, pct));
            this.elements.progressFill.style.width = pct + '%';
            this.elements.progressText.textContent = pct + '%';
        }

        /* ================= 进度记忆 ================= */

        saveProgress(location) {
            if (!this.bookKey || !location || !location.start) return;
            var pct = this.locationsReady
                ? Math.round(this.book.locations.percentageFromCfi(location.start.cfi) * 100)
                : null;
            var progress = {
                bookKey: this.bookKey,
                bookTitle: this.bookTitle,
                cfi: location.start.cfi,
                percent: pct,
                timestamp: new Date().toISOString()
            };
            try {
                localStorage.setItem(STORAGE.progress, JSON.stringify(progress));
            } catch (e) { /* 存储不可用时静默失败 */ }
        }

        checkSavedProgress() {
            var saved;
            try {
                saved = JSON.parse(localStorage.getItem(STORAGE.progress) || 'null');
            } catch (e) {
                saved = null;
            }
            if (saved && saved.cfi) {
                this.showProgressRestoreDialog(saved);
            }
        }

        showProgressRestoreDialog(progress) {
            var self = this;
            var timeStr = new Date(progress.timestamp).toLocaleString('zh-CN');
            var pctText = progress.percent !== null && progress.percent !== undefined
                ? progress.percent + '%'
                : '未知位置';

            var dialog = document.createElement('div');
            dialog.className = 'progress-dialog';
            dialog.innerHTML =
                '<div class="progress-dialog-content">' +
                '    <h3>📚 恢复阅读进度？</h3>' +
                '    <p class="dialog-book"><strong></strong></p>' +
                '    <p>上次读到：全书 ' + pctText + '</p>' +
                '    <p class="progress-time">' + timeStr + '</p>' +
                '    <div class="progress-dialog-buttons">' +
                '        <button id="restore-yes" class="btn btn-primary">继续阅读</button>' +
                '        <button id="restore-no" class="btn">从头开始</button>' +
                '    </div>' +
                '</div>';
            dialog.querySelector('.dialog-book strong').textContent = progress.bookTitle || '未命名书籍';
            document.body.appendChild(dialog);

            dialog.querySelector('#restore-yes').addEventListener('click', function () {
                self.pendingRestore = progress;
                dialog.remove();
                self.showEmptyState(
                    '📂',
                    '请重新选择书籍文件',
                    '《' + (progress.bookTitle || '') + '》',
                    true
                );
            });

            dialog.querySelector('#restore-no').addEventListener('click', function () {
                localStorage.removeItem(STORAGE.progress);
                dialog.remove();
            });
        }

        /* ================= UI 辅助 ================= */

        showEmptyState(icon, title, sub, withButton) {
            var self = this;
            var el = this.elements.emptyState;
            el.classList.remove('hidden');
            el.innerHTML =
                '<div class="empty-icon">' + icon + '</div>' +
                '<p class="empty-title"></p>' +
                '<p class="empty-sub"></p>' +
                (withButton ? '<button id="empty-open-btn" class="btn btn-primary">选择文件</button>' : '');
            el.querySelector('.empty-title').textContent = title;
            el.querySelector('.empty-sub').textContent = sub || '';
            if (withButton) {
                el.querySelector('#empty-open-btn').addEventListener('click', function () {
                    self.elements.fileInput.click();
                });
            }
        }

        showLoading(text) {
            this.elements.loadingText.textContent = text || '正在加载…';
            this.elements.loading.classList.remove('hidden');
        }

        hideLoading() {
            this.elements.loading.classList.add('hidden');
        }

        toast(message) {
            var t = document.createElement('div');
            t.className = 'toast';
            t.textContent = message;
            document.body.appendChild(t);
            // 强制 reflow 以触发过渡
            void t.offsetWidth;
            t.classList.add('visible');
            setTimeout(function () {
                t.classList.remove('visible');
                setTimeout(function () { t.remove(); }, 400);
            }, 2400);
        }
    }


    /* ================= 稳定性与大书优化 ================= */

    var EXACT_LOCATION_MAX_BYTES = 16 * 1024 * 1024;
    var EXACT_LOCATION_MAX_SPINE = 350;
    var PROGRESS_STORE_VERSION = 2;
    var PROGRESS_BOOK_LIMIT = 20;

    var baseApplyTheme = EpubReader.prototype.applyTheme;
    EpubReader.prototype.applyTheme = function () {
        baseApplyTheme.call(this);
        this.elements.themeToggle.setAttribute(
            'aria-label',
            this.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'
        );
        this.elements.themeToggle.setAttribute('aria-pressed', this.theme === 'dark' ? 'true' : 'false');
    };

    var baseUpdateFontUI = EpubReader.prototype.updateFontUI;
    EpubReader.prototype.updateFontUI = function () {
        baseUpdateFontUI.call(this);
        this.elements.fontDecrease.disabled = this.fontSize <= FONT_MIN;
        this.elements.fontIncrease.disabled = this.fontSize >= FONT_MAX;
        this.elements.fontFamilyToggle.setAttribute('aria-label', this.elements.fontFamilyToggle.title);
    };

    var baseShowLoading = EpubReader.prototype.showLoading;
    EpubReader.prototype.showLoading = function (text) {
        baseShowLoading.call(this, text);
        this.elements.loading.setAttribute('role', 'status');
        this.elements.loading.setAttribute('aria-live', 'polite');
        this.elements.loading.setAttribute('aria-hidden', 'false');
    };

    var baseHideLoading = EpubReader.prototype.hideLoading;
    EpubReader.prototype.hideLoading = function () {
        baseHideLoading.call(this);
        this.elements.loading.setAttribute('aria-hidden', 'true');
    };

    // 不在启动时用旧进度弹窗打断用户；选择到同一本书时自动恢复。
    EpubReader.prototype.checkSavedProgress = function () {
        this.loadToken = 0;
        this.locationsTimer = null;
        this.navigating = false;
        this.pendingRestore = null;

        var buttons = [
            this.elements.openFileBtn,
            this.elements.toggleTocBtn,
            this.elements.fontDecrease,
            this.elements.fontIncrease,
            this.elements.fontFamilyToggle,
            this.elements.themeToggle,
            this.elements.prevPageBtn,
            this.elements.nextPageBtn
        ];
        buttons.forEach(function (button) { button.setAttribute('type', 'button'); });

        this.elements.toggleTocBtn.setAttribute('aria-controls', 'toc-panel');
        this.elements.toggleTocBtn.setAttribute('aria-expanded', 'false');
        this.elements.tocPanel.setAttribute('aria-hidden', 'true');
        this.elements.progressFill.setAttribute('role', 'progressbar');
        this.elements.progressFill.setAttribute('aria-label', '阅读进度');
        this.elements.progressFill.setAttribute('aria-valuemin', '0');
        this.elements.progressFill.setAttribute('aria-valuemax', '100');
        this.elements.progressFill.setAttribute('aria-valuenow', '0');
        this.setBookReady(false);
        this.hideLoading();
    };

    EpubReader.prototype.setBookReady = function (ready) {
        this.elements.toggleTocBtn.disabled = !ready;
        if (!ready) {
            this.elements.prevPageBtn.disabled = true;
            this.elements.nextPageBtn.disabled = true;
            this.closeToc();
        }
    };

    EpubReader.prototype.toggleToc = function () {
        if (this.elements.toggleTocBtn.disabled) return;
        var open = this.elements.tocPanel.classList.toggle('open');
        this.elements.tocMask.classList.toggle('visible', open);
        this.elements.toggleTocBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        this.elements.tocPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
    };

    EpubReader.prototype.closeToc = function () {
        this.elements.tocPanel.classList.remove('open');
        this.elements.tocMask.classList.remove('visible');
        this.elements.toggleTocBtn.setAttribute('aria-expanded', 'false');
        this.elements.tocPanel.setAttribute('aria-hidden', 'true');
    };

    EpubReader.prototype.destroyCurrentBook = function () {
        if (this.locationsTimer) {
            clearTimeout(this.locationsTimer);
            this.locationsTimer = null;
        }

        var rendition = this.rendition;
        var book = this.book;
        this.rendition = null;
        this.book = null;
        this.bookKey = null;
        this.locationsReady = false;
        this.lastLocation = null;
        this.navigating = false;
        this.restoredProgressOverride = null;

        if (rendition) {
            try { rendition.destroy(); } catch (e) { console.warn('渲染器清理失败:', e); }
        }
        if (book && typeof book.destroy === 'function') {
            try { book.destroy(); } catch (e) { console.warn('书籍资源清理失败:', e); }
        }
        this.elements.viewer.innerHTML = '';
        this.setBookReady(false);
    };

    EpubReader.prototype.loadBook = async function (file) {
        if (!file || !/\.epub$/i.test(file.name)) {
            this.toast('请选择 .epub 格式的文件');
            return;
        }

        var token = ++this.loadToken;
        var candidateBook = null;
        this.destroyCurrentBook();
        this.setProgress(null);
        this.elements.tocList.innerHTML = '';
        this.elements.bookTitle.textContent = '正在打开…';
        this.elements.bookTitle.title = file.name;
        this.showLoading('正在加载《' + file.name.replace(/\.epub$/i, '') + '》…');

        try {
            var buffer = await file.arrayBuffer();
            if (token !== this.loadToken) return;

            candidateBook = ePub(buffer);
            await candidateBook.opened;
            if (token !== this.loadToken) {
                if (typeof candidateBook.destroy === 'function') candidateBook.destroy();
                return;
            }

            this.book = candidateBook;
            candidateBook = null;
            this.bookKey = file.name + ':' + file.size;

            var meta = (this.book.packaging && this.book.packaging.metadata) || {};
            this.bookTitle = meta.title ? String(meta.title).trim() : file.name.replace(/\.epub$/i, '');
            this.elements.bookTitle.textContent = this.bookTitle;
            this.elements.bookTitle.title = this.bookTitle;
            document.title = this.bookTitle + ' · EPUB阅读器';

            this.rendition = this.book.renderTo(this.elements.viewer, {
                width: '100%',
                height: '100%',
                flow: 'paginated',
                spread: 'none',
                minSpreadWidth: 10000
            });
            this.rendition.themes.register('light', BOOK_THEMES.light);
            this.rendition.themes.register('dark', BOOK_THEMES.dark);
            this.rendition.themes.select(this.theme);
            this.applyReadingPrefs();
            this.bindRenditionEvents();

            var saved = this.getSavedProgress(this.bookKey);
            var restored = false;
            if (saved && saved.cfi) {
                var savedPercent = saved.percent === null || saved.percent === undefined
                    ? null
                    : Number(saved.percent);
                if (savedPercent !== null && !isFinite(savedPercent)) savedPercent = null;
                this.restoredProgressOverride = { percent: savedPercent };
                try {
                    await this.rendition.display(saved.cfi);
                    restored = true;
                } catch (restoreError) {
                    console.warn('旧进度已失效，将从头开始:', restoreError);
                    this.removeSavedProgress(this.bookKey);
                    this.restoredProgressOverride = null;
                    await this.rendition.display();
                }
            } else {
                await this.rendition.display();
                this.restoredProgressOverride = null;
            }

            if (token !== this.loadToken) return;

            this.hideLoading();
            this.elements.emptyState.classList.add('hidden');
            this.renderTOC();
            this.setBookReady(true);
            this.scheduleLocationGeneration(this.book, file, token);

            if (restored) {
                var pct = saved.percent;
                this.toast(pct === null || pct === undefined ? '已恢复上次阅读位置' : '已恢复到上次的 ' + pct + '%');
            }
        } catch (err) {
            if (candidateBook && typeof candidateBook.destroy === 'function') {
                try { candidateBook.destroy(); } catch (cleanupError) { /* 忽略 */ }
            }
            if (token !== this.loadToken) return;

            console.error('加载书籍失败:', err);
            this.destroyCurrentBook();
            this.hideLoading();
            this.setProgress(null);
            this.elements.bookTitle.textContent = '未选择书籍';
            this.elements.bookTitle.title = '未选择书籍';
            document.title = 'EPUB阅读器';
            var reason = (err && (err.message || err.toString())) || '文件可能已损坏或不是有效的 EPUB';
            this.showEmptyState('😕', '书籍加载失败', reason, true);
            this.toast('书籍加载失败：' + reason);
        }
    };

    EpubReader.prototype.scheduleLocationGeneration = function (book, file, token) {
        var spineLength = book && book.spine && book.spine.items ? book.spine.items.length : 0;
        var shouldGenerate = file.size <= EXACT_LOCATION_MAX_BYTES && spineLength <= EXACT_LOCATION_MAX_SPINE;
        var self = this;

        if (!shouldGenerate) {
            this.elements.progressText.title = '大型书籍使用章节与页码估算进度，避免长时间卡顿';
            return;
        }

        this.locationsTimer = setTimeout(function () {
            self.locationsTimer = null;
            if (token !== self.loadToken || self.book !== book) return;

            book.locations.generate(1200).then(function () {
                if (token !== self.loadToken || self.book !== book) return;
                self.locationsReady = true;
                self.restoredProgressOverride = null;
                if (self.lastLocation) {
                    self.updateProgress(self.lastLocation);
                    self.saveProgress(self.lastLocation);
                }
            }).catch(function (err) {
                if (token === self.loadToken && self.book === book) {
                    console.warn('精确进度索引生成失败，将继续使用估算进度:', err);
                }
            });
        }, 500);
    };

    EpubReader.prototype.bindRenditionEvents = function () {
        var self = this;
        var r = this.rendition;

        r.on('relocated', function (location) {
            if (self.rendition !== r) return;
            self.navigating = false;
            self.lastLocation = location;
            if (self.restoredProgressOverride) {
                self.setProgress(self.restoredProgressOverride.percent, false);
                self.elements.progressText.title = '已恢复上次进度，正在校准精确位置';
            } else {
                self.updateProgress(location);
                self.saveProgress(location);
            }
            self.highlightToc(location.start && location.start.href);
            self.elements.prevPageBtn.disabled = !!location.atStart;
            self.elements.nextPageBtn.disabled = !!location.atEnd;
        });

        r.on('rendered', function () {
            if (self.rendition === r) self.applyReadingPrefs();
        });
        r.on('keydown', function (e) {
            if (self.rendition === r) self.handleKeydown(e);
        });
        r.on('click', function (e) {
            if (self.rendition !== r) return;
            try {
                if (e.target && e.target.closest && e.target.closest('a')) {
                    self.restoredProgressOverride = null;
                    return;
                }
            } catch (err) { /* 忽略跨文档异常 */ }
            var width = self.elements.viewer.getBoundingClientRect().width;
            var x = e.clientX;
            if (x < width * 0.18) self.prev();
            else if (x > width * 0.82) self.next();
        });
        r.on('touchstart', function (e) {
            if (self.rendition !== r) return;
            self.touchStartX = e.changedTouches && e.changedTouches[0]
                ? e.changedTouches[0].clientX
                : null;
        });
        r.on('touchend', function (e) {
            if (self.rendition !== r || self.touchStartX === null || !e.changedTouches || !e.changedTouches[0]) return;
            var dx = e.changedTouches[0].clientX - self.touchStartX;
            self.touchStartX = null;
            if (Math.abs(dx) > 50) {
                if (dx < 0) self.next();
                else self.prev();
            }
        });
    };

    EpubReader.prototype.handleKeydown = function (e) {
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;

        if (e.key === 'Escape') {
            this.closeToc();
            return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (!this.rendition) return;
            e.preventDefault();
            if (e.key === 'ArrowLeft') this.prev();
            else this.next();
            return;
        }
        if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            this.toggleTheme();
        }
    };

    EpubReader.prototype.navigate = function (direction) {
        if (!this.rendition || this.navigating) return;
        var self = this;
        var r = this.rendition;
        this.restoredProgressOverride = null;
        this.navigating = true;
        Promise.resolve(r[direction]()).catch(function (err) {
            if (self.rendition === r) console.warn('翻页失败:', err);
        }).then(function () {
            if (self.rendition === r) self.navigating = false;
        });
    };

    EpubReader.prototype.prev = function () { this.navigate('prev'); };
    EpubReader.prototype.next = function () { this.navigate('next'); };

    EpubReader.prototype.calculateProgress = function (location) {
        if (!this.book || !location || !location.start) return null;
        if (location.atStart) return { percent: 0, exact: this.locationsReady };
        if (location.atEnd) return { percent: 100, exact: this.locationsReady };

        if (this.locationsReady) {
            try {
                var exact = this.book.locations.percentageFromCfi(location.start.cfi);
                if (isFinite(exact)) return { percent: exact * 100, exact: true };
            } catch (e) { /* 回退到结构估算 */ }
        }

        var items = this.book.spine && this.book.spine.items ? this.book.spine.items : [];
        if (!items.length) return null;
        var index = Number(location.start.index);
        if (!isFinite(index)) {
            index = -1;
            for (var i = 0; i < items.length; i++) {
                if (items[i].href === location.start.href) {
                    index = i;
                    break;
                }
            }
        }
        if (index < 0) return null;

        var displayed = location.start.displayed || {};
        var total = Number(displayed.total) || 1;
        var page = Number(displayed.page) || 1;
        var withinSection = Math.max(0, Math.min(1, (page - 1) / total));
        return { percent: ((index + withinSection) / items.length) * 100, exact: false };
    };

    EpubReader.prototype.updateProgress = function (location) {
        var progress = this.calculateProgress(location);
        this.setProgress(progress && progress.percent, progress ? !progress.exact : false);
    };

    EpubReader.prototype.setProgress = function (pct, approximate) {
        if (pct === null || pct === undefined || !isFinite(pct)) {
            this.elements.progressFill.style.width = '0%';
            this.elements.progressFill.setAttribute('aria-valuenow', '0');
            this.elements.progressText.textContent = this.book ? '定位中…' : '--%';
            this.elements.progressText.title = '';
            return;
        }
        pct = Math.round(Math.min(100, Math.max(0, pct)));
        this.elements.progressFill.style.width = pct + '%';
        this.elements.progressFill.setAttribute('aria-valuenow', String(pct));
        this.elements.progressText.textContent = pct + '%';
        this.elements.progressText.title = approximate ? '估算进度' : '精确进度';
    };

    EpubReader.prototype.readProgressStore = function () {
        var parsed = null;
        try { parsed = JSON.parse(localStorage.getItem(STORAGE.progress) || 'null'); } catch (e) { /* 忽略损坏数据 */ }
        if (parsed && parsed.version === PROGRESS_STORE_VERSION && parsed.books && typeof parsed.books === 'object') {
            return parsed;
        }
        var store = { version: PROGRESS_STORE_VERSION, books: {} };
        if (parsed && parsed.bookKey && parsed.cfi) store.books[parsed.bookKey] = parsed;
        return store;
    };

    EpubReader.prototype.getSavedProgress = function (bookKey) {
        var books = this.readProgressStore().books;
        return Object.prototype.hasOwnProperty.call(books, bookKey) ? books[bookKey] : null;
    };

    EpubReader.prototype.removeSavedProgress = function (bookKey) {
        var store = this.readProgressStore();
        delete store.books[bookKey];
        try { localStorage.setItem(STORAGE.progress, JSON.stringify(store)); } catch (e) { /* 忽略 */ }
    };

    EpubReader.prototype.saveProgress = function (location) {
        if (!this.bookKey || !location || !location.start) return;
        var calculated = this.calculateProgress(location);
        var progress = {
            bookKey: this.bookKey,
            bookTitle: this.bookTitle,
            cfi: location.start.cfi,
            percent: calculated ? Math.round(calculated.percent) : null,
            timestamp: new Date().toISOString()
        };
        var store = this.readProgressStore();
        store.books[this.bookKey] = progress;

        var keys = Object.keys(store.books);
        if (keys.length > PROGRESS_BOOK_LIMIT) {
            keys.sort(function (a, b) {
                return String(store.books[b].timestamp || '').localeCompare(String(store.books[a].timestamp || ''));
            });
            keys.slice(PROGRESS_BOOK_LIMIT).forEach(function (key) { delete store.books[key]; });
        }
        try { localStorage.setItem(STORAGE.progress, JSON.stringify(store)); } catch (e) { /* 存储不可用时静默失败 */ }
    };

    // epub.js 的 atEnd 可能仅表示已进入最后一个 spine，百分比应优先按 CFI 计算。
    EpubReader.prototype.calculateProgress = function (location) {
        if (!this.book || !location || !location.start) return null;

        if (this.locationsReady) {
            try {
                var exact = this.book.locations.percentageFromCfi(location.start.cfi);
                if (isFinite(exact)) return { percent: exact * 100, exact: true };
            } catch (e) { /* 回退到结构估算 */ }
        }

        var items = this.book.spine && this.book.spine.items ? this.book.spine.items : [];
        if (!items.length) return null;
        var index = Number(location.start.index);
        if (!isFinite(index)) {
            index = -1;
            for (var i = 0; i < items.length; i++) {
                if (items[i].href === location.start.href) {
                    index = i;
                    break;
                }
            }
        }
        if (index < 0) return null;

        var displayed = location.start.displayed || {};
        var total = Math.max(1, Number(displayed.total) || 1);
        var page = Math.max(1, Number(displayed.page) || 1);
        if (location.atStart) return { percent: 0, exact: false };
        if (location.atEnd && index === items.length - 1 && page >= total) return { percent: 100, exact: false };

        var withinSection = Math.max(0, Math.min(1, (page - 1) / total));
        return { percent: ((index + withinSection) / items.length) * 100, exact: false };
    };

    var baseToast = EpubReader.prototype.toast;
    EpubReader.prototype.toast = function (message) {
        if (/^已恢复到上次的/.test(message) && this.lastLocation && this.locationsReady) {
            var current = this.calculateProgress(this.lastLocation);
            if (current) message = '已恢复到上次的 ' + Math.round(current.percent) + '%';
        }
        baseToast.call(this, message);
    };

    // 粗粒度 locations 在章节内部可能提前返回 0/100，遇到这种边界值时改用页内估算。
    var calculateProgressWithBoundaryFallback = EpubReader.prototype.calculateProgress;
    EpubReader.prototype.calculateProgress = function (location) {
        var progress = calculateProgressWithBoundaryFallback.call(this, location);
        if (!progress || !progress.exact || !location) return progress;
        if ((progress.percent <= 0 && !location.atStart) || (progress.percent >= 100 && !location.atEnd)) {
            var exactReady = this.locationsReady;
            this.locationsReady = false;
            var estimated = calculateProgressWithBoundaryFallback.call(this, location);
            this.locationsReady = exactReady;
            return estimated || progress;
        }
        return progress;
    };

    // epub.js 会保留已注入的主题样式；每次切换都把当前主题覆盖层移到最后，
    // 避免暗色主题的 !important 规则在切回亮色后继续生效。
    EpubReader.prototype.applyBookThemeToContents = function () {
        if (!this.rendition) return;
        var dark = this.theme === 'dark';
        var foreground = dark ? '#e7e0d5' : '#322c26';
        var background = dark ? '#191816' : '#fffdf8';
        var link = dark ? '#d89a76' : '#9a5d43';
        var selection = dark ? 'rgba(10, 132, 255, 0.38)' : 'rgba(0, 113, 227, 0.22)';
        var contents = this.rendition.getContents ? this.rendition.getContents() : [];

        contents.forEach(function (content) {
            var doc = content && content.document;
            if (!doc || !doc.head) return;
            var oldStyle = doc.getElementById('epub-reader-theme-override');
            if (oldStyle) oldStyle.remove();

            var style = doc.createElement('style');
            style.id = 'epub-reader-theme-override';
            style.setAttribute('data-reader-theme', dark ? 'dark' : 'light');
            style.textContent =
                'html, body {' +
                'color: ' + foreground + ' !important;' +
                'background: ' + background + ' !important;' +
                'background-color: ' + background + ' !important;' +
                '}' +
                'a { color: ' + link + ' !important; }' +
                '::selection { background: ' + selection + '; }';
            doc.head.appendChild(style);
        });
    };

    var applyThemeWithContentOverride = EpubReader.prototype.applyTheme;
    EpubReader.prototype.applyTheme = function () {
        applyThemeWithContentOverride.call(this);
        this.applyBookThemeToContents();
    };

    var applyReadingPrefsWithTheme = EpubReader.prototype.applyReadingPrefs;
    EpubReader.prototype.applyReadingPrefs = function () {
        applyReadingPrefsWithTheme.call(this);
        this.applyBookThemeToContents();
    };

    // 覆盖 EPUB 内常见正文标签的残缺内嵌字体，避免黑体模式出现缺字或混合字形。
    EpubReader.prototype.applyBookTypographyToContents = function () {
        if (!this.rendition) return;
        var stack = this.fontStack();
        var mode = this.serif ? 'serif' : 'sans';
        var contents = this.rendition.getContents ? this.rendition.getContents() : [];

        contents.forEach(function (content) {
            var doc = content && content.document;
            if (!doc || !doc.head) return;
            var oldStyle = doc.getElementById('epub-reader-font-override');
            if (oldStyle) oldStyle.remove();

            var style = doc.createElement('style');
            style.id = 'epub-reader-font-override';
            style.setAttribute('data-reader-font', mode);
            style.textContent =
                'html, body, p, div, span, li, blockquote, ' +
                'h1, h2, h3, h4, h5, h6, a, td, th, figcaption {' +
                'font-family: ' + stack + ' !important;' +
                '}' +
                'body {' +
                'text-rendering: optimizeLegibility;' +
                '-webkit-font-smoothing: antialiased;' +
                '}' +
                'code, pre, kbd, samp {' +
                'font-family: ui-monospace, SFMono-Regular, Consolas, monospace !important;' +
                '}';
            doc.head.appendChild(style);
        });
    };

    var toggleSerifWithTypography = EpubReader.prototype.toggleSerif;
    EpubReader.prototype.toggleSerif = function () {
        toggleSerifWithTypography.call(this);
        this.applyBookTypographyToContents();
    };

    var applyReadingPrefsWithTypography = EpubReader.prototype.applyReadingPrefs;
    EpubReader.prototype.applyReadingPrefs = function () {
        applyReadingPrefsWithTypography.call(this);
        this.applyBookTypographyToContents();
    };
    // 初始化阅读器
    document.addEventListener('DOMContentLoaded', function () {
        window.epubReader = new EpubReader();
    });
})();
