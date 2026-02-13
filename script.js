class EpubReader {
    constructor() {
        this.currentBook = null;
        this.currentPage = 0;
        this.totalPages = 0;
        this.toc = [];
        this.spine = [];
        this.bookTitle = '';
        this.manifest = {}; // 添加清单用于存储资源映射
        
        this.initElements();
        this.bindEvents();
    }

    initElements() {
        this.elements = {
            fileInput: document.getElementById('file-input'),
            openFileBtn: document.getElementById('open-file'),
            toggleTocBtn: document.getElementById('toggle-toc'),
            tocPanel: document.getElementById('toc-panel'),
            tocList: document.getElementById('toc-list'),
            content: document.getElementById('content'),
            prevPageBtn: document.getElementById('prev-page'),
            nextPageBtn: document.getElementById('next-page'),
            pageInfo: document.getElementById('page-info'),
            bookTitle: document.getElementById('book-title'),
            themeToggle: document.getElementById('theme-toggle')
        };
        
        // 初始化主题
        this.initTheme();
        
        // 检查是否有保存的阅读进度
        this.checkSavedProgress();
    }
    
    // 保存阅读进度
    saveProgress() {
        if (this.currentBook && this.spine.length > 0) {
            const progress = {
                bookName: this.currentBook,
                bookTitle: this.bookTitle,
                currentChapter: this.currentPage,
                totalChapters: this.totalPages,
                timestamp: new Date().toISOString()
            };
            localStorage.setItem('epub-reader-progress', JSON.stringify(progress));
        }
    }
    
    // 检查保存的阅读进度
    checkSavedProgress() {
        const saved = localStorage.getItem('epub-reader-progress');
        if (saved) {
            try {
                const progress = JSON.parse(saved);
                // 显示恢复提示
                this.showProgressRestoreDialog(progress);
            } catch (e) {
                console.warn('读取保存的进度失败:', e);
            }
        }
    }
    
    // 显示恢复进度对话框
    showProgressRestoreDialog(progress) {
        const date = new Date(progress.timestamp);
        const timeStr = date.toLocaleString('zh-CN');
        
        const dialog = document.createElement('div');
        dialog.className = 'progress-dialog';
        dialog.innerHTML = `
            <div class="progress-dialog-content">
                <h3>📚 恢复阅读进度？</h3>
                <p><strong>${progress.bookTitle || progress.bookName}</strong></p>
                <p>上次阅读：第 ${progress.currentChapter + 1} 章 / 共 ${progress.totalChapters} 章</p>
                <p class="progress-time">${timeStr}</p>
                <div class="progress-dialog-buttons">
                    <button id="restore-yes" class="btn btn-primary">继续阅读</button>
                    <button id="restore-no" class="btn">从头开始</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // 绑定按钮事件
        dialog.querySelector('#restore-yes').addEventListener('click', () => {
            this.restoreProgress(progress);
            dialog.remove();
        });
        
        dialog.querySelector('#restore-no').addEventListener('click', () => {
            localStorage.removeItem('epub-reader-progress');
            dialog.remove();
        });
        
        this.savedProgress = progress;
    }
    
    // 恢复阅读进度
    async restoreProgress(progress) {
        // 等待用户选择文件
        this.pendingRestore = progress;
        this.elements.content.innerHTML = `
            <div class="restore-hint">
                <p>请重新选择书籍：<strong>${progress.bookName}</strong></p>
                <button id="select-file-btn" class="btn">选择文件</button>
            </div>
        `;
        
        document.getElementById('select-file-btn').addEventListener('click', () => {
            this.elements.fileInput.click();
        });
    }
    
    initTheme() {
        // 检查本地存储或系统偏好
        const savedTheme = localStorage.getItem('epub-reader-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.documentElement.setAttribute('data-theme', 'dark');
            this.elements.themeToggle.textContent = '☀️';
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            this.elements.themeToggle.textContent = '🌙';
        }
    }
    
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('epub-reader-theme', newTheme);
        this.elements.themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        
        // 如果有书籍正在阅读，重新渲染当前页以应用新主题
        if (this.currentBook && this.spine.length > 0) {
            this.goToPage(this.currentPage);
        }
    }

    bindEvents() {
        this.elements.openFileBtn.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.loadBook(file);
            }
        });

        this.elements.toggleTocBtn.addEventListener('click', () => {
            this.elements.tocPanel.classList.toggle('hidden');
        });

        this.elements.prevPageBtn.addEventListener('click', () => {
            this.goToPage(this.currentPage - 1);
        });

        this.elements.nextPageBtn.addEventListener('click', () => {
            this.goToPage(this.currentPage + 1);
        });
        
        // 主题切换
        this.elements.themeToggle.addEventListener('click', () => {
            this.toggleTheme();
        });
        
        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                this.goToPage(this.currentPage - 1);
            } else if (e.key === 'ArrowRight') {
                this.goToPage(this.currentPage + 1);
            } else if (e.key === 'Escape') {
                this.elements.tocPanel.classList.add('hidden');
            } else if (e.key === 't' || e.key === 'T') {
                this.toggleTheme();
            }
        });
        
        // 页面关闭前保存进度
        window.addEventListener('beforeunload', () => {
            this.saveProgress();
        });
    }

    async loadBook(file) {
        try {
            // 检查是否是恢复进度的同一本书
            const isRestoring = this.pendingRestore && this.pendingRestore.bookName === file.name;
            
            // 显示加载状态
            this.elements.content.innerHTML = '<p>正在加载书籍...</p>';
            
            // 使用JSZip读取EPUB文件
            const zip = new JSZip();
            const zipContent = await zip.loadAsync(file);
            
            // 解析EPUB结构
            await this.parseEpub(zipContent);
            
            // 标记书籍已加载
            this.currentBook = file.name;
            
            // 决定从哪一章开始
            let startChapter = 0;
            if (isRestoring && this.pendingRestore.currentChapter < this.totalPages) {
                startChapter = this.pendingRestore.currentChapter;
                this.pendingRestore = null;
            }
            
            // 显示指定章节
            await this.goToPage(startChapter);
            
            // 更新UI
            this.elements.bookTitle.textContent = this.bookTitle || file.name;
            this.renderTOC();
            
            // 高亮当前章节的目录项
            this.highlightCurrentChapter();
            
        } catch (error) {
            console.error('加载书籍失败:', error);
            this.elements.content.innerHTML = '<p>加载书籍失败，请确保选择的是有效的EPUB文件。</p>';
        }
    }

    async parseEpub(zip) {
        // 查找container.xml文件
        const containerXml = await zip.file('META-INF/container.xml').async('string');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'text/xml');
        
        // 获取content.opf路径
        const rootFile = containerDoc.querySelector('rootfile');
        const contentOpfPath = rootFile.getAttribute('full-path');
        const basePath = contentOpfPath.substring(0, contentOpfPath.lastIndexOf('/') + 1);
        
        // 读取content.opf
        const contentOpf = await zip.file(contentOpfPath).async('string');
        const contentDoc = parser.parseFromString(contentOpf, 'text/xml');
        
        // 获取书名
        const titleElement = contentDoc.querySelector('title');
        this.bookTitle = titleElement ? titleElement.textContent : '未知书名';
        
        // 解析manifest（资源清单）
        const manifestItems = contentDoc.querySelectorAll('manifest item');
        this.manifest = {};
        manifestItems.forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            const mediaType = item.getAttribute('media-type');
            this.manifest[id] = {
                href: basePath + href,
                mediaType: mediaType
            };
        });
        
        // 解析spine（页面顺序）
        const spineItems = contentDoc.querySelectorAll('spine itemref');
        this.spine = Array.from(spineItems).map(item => {
            const idref = item.getAttribute('idref');
            return {
                id: idref,
                href: this.manifest[idref].href
            };
        });
        
        // 解析目录 - 尝试多种方式
        const spine = contentDoc.querySelector('spine');
        const tocId = spine ? spine.getAttribute('toc') : null;
        
        if (tocId) {
            const tocItem = contentDoc.querySelector(`manifest item[id="${tocId}"]`);
            if (tocItem) {
                const tocPath = basePath + tocItem.getAttribute('href');
                const tocContent = await zip.file(tocPath).async('string');
                this.parseTOC(tocContent, basePath);
            }
        } else {
            // EPUB 3: 尝试从 manifest 找 nav 文件
            const navItem = contentDoc.querySelector('manifest item[properties~="nav"]');
            if (navItem) {
                const tocPath = basePath + navItem.getAttribute('href');
                try {
                    const tocContent = await zip.file(tocPath).async('string');
                    this.parseTOC(tocContent, basePath);
                } catch (e) {
                    console.warn('导航文件解析失败:', e);
                }
            }
        }
        
        // 保存zip对象以便后续读取章节内容
        this.zip = zip;
        this.basePath = basePath;
        
        // 设置总页数
        this.totalPages = this.spine.length;
    }

    parseTOC(tocContent, basePath) {
        const parser = new DOMParser();
        const tocDoc = parser.parseFromString(tocContent, 'text/xml');
        
        // 先尝试 NCX 格式 (EPUB 2)
        const navPoints = tocDoc.querySelectorAll('navPoint');
        if (navPoints.length > 0) {
            this.toc = Array.from(navPoints).map(navPoint => {
                const navLabel = navPoint.querySelector('navLabel text');
                const content = navPoint.querySelector('content');
                const label = navLabel ? navLabel.textContent : '无标题';
                const contentSrc = content ? content.getAttribute('src') : '';
                const playOrder = navPoint.getAttribute('playOrder');
                
                return {
                    label,
                    href: basePath + contentSrc,
                    playOrder: parseInt(playOrder) || 0
                };
            });
        } else {
            // 尝试 XHTML nav 格式 (EPUB 3)
            const navLinks = tocDoc.querySelectorAll('nav[epub\\:type="toc"] a, nav a[href]');
            this.toc = Array.from(navLinks).map((link, index) => {
                return {
                    label: link.textContent.trim() || '无标题',
                    href: basePath + link.getAttribute('href'),
                    playOrder: index + 1
                };
            });
        }
    }

    renderTOC() {
        this.elements.tocList.innerHTML = '';
        
        this.toc.forEach((item, index) => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#';
            a.className = 'toc-link';
            a.textContent = item.label;
            a.dataset.href = item.href;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateToHref(item.href);
            });
            
            li.appendChild(a);
            this.elements.tocList.appendChild(li);
        });
        
        // 高亮当前章节
        this.highlightCurrentChapter();
    }

    async goToPage(pageIndex) {
        if (pageIndex < 0 || pageIndex >= this.totalPages) return;
        
        this.currentPage = pageIndex;
        const chapter = this.spine[pageIndex];
        
        try {
            const chapterContent = await this.zip.file(chapter.href).async('string');
            this.displayChapter(chapterContent, chapter.href);
            this.updateNavigation();
            
            // 保存阅读进度
            this.saveProgress();
            
            // 高亮当前章节的目录项
            this.highlightCurrentChapter();
            
            // 滚动到顶部
            this.elements.content.scrollTop = 0;
        } catch (error) {
            console.error('加载章节失败:', error);
            this.elements.content.innerHTML = '<p>无法加载此章节</p>';
        }
    }
    
    // 高亮当前章节的目录项
    highlightCurrentChapter() {
        const tocLinks = this.elements.tocList.querySelectorAll('.toc-link');
        tocLinks.forEach((link, index) => {
            link.classList.remove('active');
            // 尝试匹配当前章节
            const chapterFile = this.spine[this.currentPage]?.href.split('/').pop();
            if (link.dataset.href && link.dataset.href.includes(chapterFile)) {
                link.classList.add('active');
            }
        });
    }

    async displayChapter(content, href) {
        // 创建一个包装div来处理相对链接
        const wrapper = document.createElement('div');
        wrapper.innerHTML = content;
        
        // 处理相对链接
        const basePath = href.substring(0, href.lastIndexOf('/') + 1);
        
        // 处理图片资源 - 支持相对路径和 ../ 
        const images = wrapper.querySelectorAll('img[src]');
        for (let img of images) {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('http') && !src.startsWith('data:')) {
                // 处理相对路径 (包括 ../)
                const imagePath = this.resolvePath(basePath, src);
                try {
                    const imageFile = this.zip.file(imagePath);
                    if (imageFile) {
                        // 根据文件扩展名确定MIME类型
                        let mimeType = 'image/jpeg';
                        const lowerSrc = src.toLowerCase();
                        if (lowerSrc.endsWith('.png')) {
                            mimeType = 'image/png';
                        } else if (lowerSrc.endsWith('.gif')) {
                            mimeType = 'image/gif';
                        } else if (lowerSrc.endsWith('.webp')) {
                            mimeType = 'image/webp';
                        } else if (lowerSrc.endsWith('.bmp')) {
                            mimeType = 'image/bmp';
                        } else if (lowerSrc.endsWith('.svg')) {
                            mimeType = 'image/svg+xml';
                        }
                        
                        const imageData = await imageFile.async('base64');
                        img.src = `data:${mimeType};base64,${imageData}`;
                    }
                } catch (e) {
                    console.warn('图片加载失败:', src);
                }
            }
        }
        
        // 处理CSS样式链接
        const links = wrapper.querySelectorAll('link[rel="stylesheet"]');
        for (let link of links) {
            const hrefAttr = link.getAttribute('href');
            if (hrefAttr && !hrefAttr.startsWith('http')) {
                const cssPath = this.resolvePath(basePath, hrefAttr);
                try {
                    const cssFile = this.zip.file(cssPath);
                    if (cssFile) {
                        const cssContent = await cssFile.async('string');
                        // 创建内联样式替代外部链接
                        const styleElement = document.createElement('style');
                        styleElement.textContent = cssContent;
                        link.parentNode.replaceChild(styleElement, link);
                    }
                } catch (e) {
                    console.warn('CSS加载失败:', hrefAttr);
                }
            }
        }
        
        // 应用默认样式以改善段落显示（支持暗黑模式）
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const defaultStyles = `
            <style>
                body {
                    font-family: 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
                    line-height: 1.9;
                    word-wrap: break-word;
                    padding: 0;
                    margin: 0;
                    background-color: ${isDark ? '#16213e' : '#ffffff'};
                    color: ${isDark ? '#eaeaea' : '#2c3e50'};
                }
                p {
                    margin: 0 0 1.2em 0;
                    text-indent: 2em;
                    text-align: justify;
                }
                h1, h2, h3, h4, h5, h6 {
                    margin: 1.5em 0 0.8em 0;
                    line-height: 1.3;
                    font-weight: 600;
                }
                img {
                    max-width: 100%;
                    height: auto;
                    display: block;
                    margin: 1.5em auto;
                    border-radius: 4px;
                }
                div {
                    margin: 0.5em 0;
                }
            </style>
        `;
        
        this.elements.content.innerHTML = defaultStyles;
        this.elements.content.appendChild(wrapper);
    }

    async navigateToHref(targetHref) {
        // 处理带锚点的链接 (如 chapter1.html#section1)
        const [hrefPath, anchor] = targetHref.split('#');
        
        // 找到匹配的章节
        const chapterIndex = this.spine.findIndex(chapter => {
            const chapterFile = chapter.href.split('/').pop();
            const targetFile = hrefPath.split('/').pop();
            return chapterFile === targetFile || chapter.href === hrefPath;
        });
        
        if (chapterIndex !== -1) {
            await this.goToPage(chapterIndex);
            // 如果有锚点，滚动到对应位置
            if (anchor) {
                const element = document.getElementById(anchor) || 
                                document.querySelector(`[name="${anchor}"]`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth' });
                }
            }
        } else {
            console.warn('未找到对应章节:', targetHref);
        }
    }

    updateNavigation() {
        this.elements.prevPageBtn.disabled = this.currentPage <= 0;
        this.elements.nextPageBtn.disabled = this.currentPage >= this.totalPages - 1;
        this.elements.pageInfo.textContent = `第 ${this.currentPage + 1} 章，共 ${this.totalPages} 章`;
    }
    
    // 辅助方法：解析相对路径 (处理 ../ 和 ./)
    resolvePath(basePath, relativePath) {
        if (relativePath.startsWith('/')) return relativePath.substring(1);
        
        const baseParts = basePath.split('/').filter(p => p);
        const pathParts = relativePath.split('/');
        
        for (const part of pathParts) {
            if (part === '..') {
                baseParts.pop();
            } else if (part !== '.' && part !== '') {
                baseParts.push(part);
            }
        }
        
        return baseParts.join('/');
    }
}

// 初始化阅读器
document.addEventListener('DOMContentLoaded', () => {
    window.epubReader = new EpubReader();
});