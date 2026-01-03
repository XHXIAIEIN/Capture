// 常量定义
const CONSTANTS = {
    DEFAULT_QUALITY: 0.8,
    ZIP_COMPRESSION_LEVEL: 9
};

// 工具类
class Utils {
    static formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`;
    }

    static async loadImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    static createDownloadLink(imgData, fileName) {
        const link = document.createElement('a');
        link.href = `data:image/png;base64,${imgData}`;
        link.download = fileName;
        link.innerText = `Download ${fileName}`;
        link.style.display = 'block';
        return link;
    }
}

// 图片处理类
class ImageProcessor {
    constructor(UI) {
        this.UI = UI;
    }

    async captureAndSaveImage(photos, fileName, format, quality) {
        const { columnsInput, rowGapInput, columnGapInput, maxWidthInput, paddingXInput, paddingYInput, bgColorInput, pageBorderRadiusInput } = this.UI;
        
        try {
            const fragment = document.createDocumentFragment();
            photos.forEach(photo => fragment.appendChild(photo.cloneNode(true)));

            const tempDiv = this.createTempDiv({
                fragment,
                columnsInput,
                rowGapInput,
                columnGapInput,
                paddingYInput,
                paddingXInput,
                bgColorInput,
                maxWidthInput,
                pageBorderRadiusInput
            });

            document.body.appendChild(tempDiv);
            const canvas = await html2canvas(tempDiv, { backgroundColor: null });
            document.body.removeChild(tempDiv);

            const dataUrl = format === 'jpg' || format === 'avif' 
                ? canvas.toDataURL(`image/${format}`, quality)
                : canvas.toDataURL(`image/${format}`);

            if (fileName) {
                saveAs(dataUrl, fileName);
            }

            return dataUrl.split(',')[1];
        } catch (error) {
            console.error('截图时出错:', error);
            throw error;
        }
    }

    createTempDiv({ fragment, columnsInput, rowGapInput, columnGapInput, paddingYInput, paddingXInput, bgColorInput, maxWidthInput, pageBorderRadiusInput }) {
        const tempDiv = document.createElement('div');
        Object.assign(tempDiv.style, {
            display: 'grid',
            boxSizing: 'border-box',
            backgroundColor: bgColorInput.value,
            gridTemplateColumns: `repeat(${columnsInput.value}, 1fr)`,
            gap: `${rowGapInput.value}px ${columnGapInput.value}px`,
            padding: `${paddingYInput.value}px ${paddingXInput.value}px`,
            borderRadius: `${pageBorderRadiusInput.value}px`,
            width: `${maxWidthInput.value}px`
        });
        tempDiv.appendChild(fragment);
        return tempDiv;
    }
}

// UI管理类
class UIManager {
    constructor() {
        this.UI = this.initializeUI();
        this.imageProcessor = new ImageProcessor(this.UI);
        this.setupEventListeners();
        this.isGenerating = false;
        this.isDragOverActive = false;
        this.lastClickTime = 0;
        // 拖拽相关状态
        this.isImageDragging = false;
        this.draggedClone = null;
        this.draggedElement = null;
        this.insertIndicator = null;
        this.dragState = null;
        this.globalMoveHandler = null;
        this.globalEndHandler = null;
        this.lastInsertPosition = null;
        this.dragStartThreshold = 5; // 拖拽启动距离阈值
        this.worker = null;
        this.initializeWorker();
        this.checkFileSystemSupport();
    }

    initializeWorker() {
        try {
            this.worker = new Worker('worker.js');
            this.worker.onmessage = (e) => this.handleWorkerMessage(e);
            this.worker.onerror = (error) => {
                console.error('Worker error:', error);
                this.showProgress(this.UI.progressContainer, this.UI.progressText, 'Worker 初始化失败，使用主线程处理', false);
            };
        } catch (error) {
            console.error('Failed to create worker:', error);
            this.worker = null;
        }
    }

    checkFileSystemSupport() {
        const { downloadMode } = this.UI;
        
        if (!('showDirectoryPicker' in window)) {
            // 如果不支持文件系统API，禁用文件夹选项并切换到浏览器下载
            const folderOption = downloadMode.querySelector('option[value="folder"]');
            if (folderOption) {
                folderOption.disabled = true;
                folderOption.textContent = '保存到文件夹 (不支持)';
            }
            downloadMode.value = 'browser';
        }
    }

    base64ToBlob(base64Data, contentType) {
        const byteCharacters = atob(base64Data);
        const byteArrays = [];
        
        for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
            const slice = byteCharacters.slice(offset, offset + 1024);
            const byteNumbers = new Array(slice.length);
            
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }
        
        return new Blob(byteArrays, { type: contentType });
    }

    handleWorkerMessage(e) {
        const { type, data, error, phase, isAppend } = e.data;
        
        switch (type) {
            case 'progress':
                this.updateWorkerProgress(data || e.data);
                break;
            case 'filesProcessed':
                this.onFilesProcessed(data, isAppend);
                break;
            case 'zipCreated':
                this.onZipCreated(data);
                break;
            case 'filesSorted':
                this.onFilesSorted(data);
                break;
            case 'error':
                console.error(`Worker error in ${phase}:`, error);
                this.showProgress(this.UI.progressContainer, this.UI.progressText, `处理失败: ${error}`, false);
                break;
        }
    }

    updateWorkerProgress(progressData) {
        const { phase, current, total, percentage } = progressData;
        let message = '';
        
        switch (phase) {
            case 'metadata':
                message = `正在分析图片... (${current}/${total})`;
                break;
            case 'zip_add':
                message = `正在添加到压缩包... (${current}/${total})`;
                break;
            case 'zip_generate':
                message = `正在生成压缩包... ${percentage}%`;
                break;
        }
        
        if (message) {
            this.UI.progressText.innerText = message;
        }
    }

    initializeUI() {
        return {
            dropArea: document.getElementById('dropArea'),
            fileInputImages: document.getElementById('fileInputImages'),
            fileInputFolder: document.getElementById('fileInputFolder'),
            btnSelectImages: document.getElementById('btnSelectImages'),
            btnSelectFolder: document.getElementById('btnSelectFolder'),
            captureButton: document.getElementById('captureButton'),
            sortOrder: document.getElementById('sortOrder'),
            maxWidthInput: document.getElementById('maxWidth'),
            columnsInput: document.getElementById('columns'),
            rowsInput: document.getElementById('rows'),
            columnGapInput: document.getElementById('columnGap'),
            rowGapInput: document.getElementById('rowGap'),
            paddingXInput: document.getElementById('paddingX'),
            paddingYInput: document.getElementById('paddingY'),
            bgColorInput: document.getElementById('bgColor'),
            photoWall: document.getElementById('photoWall'),
            downloadMode: document.getElementById('downloadMode'),
            progressContainer: document.getElementById('progressContainer'),
            progressText: document.getElementById('progressText'),
            photoWallContainer: document.getElementById('photoWallContainer'),
            linksContainer: document.getElementById('linksContainer'),
            imageBorderRadiusInput: document.getElementById('imageBorderRadius'),
            pageBorderRadiusInput: document.getElementById('pageBorderRadius'),
            imageFormat: document.getElementById('imageFormat'),
            imageQuality: document.getElementById('imageQuality'),
            imageAlignment: document.getElementById('imageAlignment'),
            addMoreHint: document.getElementById('addMoreHint'),
            appendMode: document.getElementById('appendMode')
        };
    }

    // 检测是否为移动设备
    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) ||
               ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    }

    // 检测是否支持文件夹选择
    supportsFolderSelection() {
        const input = document.createElement('input');
        return 'webkitdirectory' in input;
    }

    // 根据设备类型初始化UI
    initializeDeviceUI() {
        const { btnSelectFolder, dropArea } = this.UI;
        const isMobile = this.isMobileDevice();
        const supportsFolder = this.supportsFolderSelection();

        // 移动端或不支持文件夹选择时隐藏文件夹按钮
        if (isMobile || !supportsFolder) {
            btnSelectFolder.classList.add('hidden');
        }

        // 更新提示文字
        const dropHint = dropArea.querySelector('.drop-hint');
        if (dropHint) {
            if (isMobile) {
                dropHint.textContent = '支持多选 · 从相册选择';
            } else {
                dropHint.textContent = '支持多选 · 可拖拽文件到此处';
            }
        }
    }

    setupEventListeners() {
        const { dropArea, fileInputImages, fileInputFolder, btnSelectImages, btnSelectFolder, captureButton, sortOrder, photoWallContainer } = this.UI;

        // 初始化：检测设备类型并调整UI
        this.initializeDeviceUI();

        // 选择图片按钮
        btnSelectImages.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isImageDragging) return;
            fileInputImages.click();
        });

        // 选择文件夹按钮
        btnSelectFolder.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isImageDragging) return;
            fileInputFolder.click();
        });

        // 主拖拽区域点击事件（点击内容区域时打开图片选择）
        dropArea.addEventListener('click', (e) => {
            // 如果点击的是按钮，不处理
            if (e.target.closest('.drop-btn')) return;
            if (this.isImageDragging) return;
            const now = Date.now();
            if (now - this.lastClickTime > 300) {
                this.lastClickTime = now;
                fileInputImages.click();
            }
        });
        dropArea.addEventListener('dragover', event => {
            // 只处理文件拖拽，忽略图片重排序
            if (!this.isImageDragging) {
                event.preventDefault();
                dropArea.classList.add('hover');
            }
        });
        dropArea.addEventListener('drop', async (event) => {
            // 只处理文件拖拽，忽略图片重排序
            if (!this.isImageDragging) {
                event.preventDefault();
                dropArea.classList.remove('hover');
                const isAppend = this.UI.photoWall.children.length > 0;
                // 处理拖放数据（支持跨应用拖放）
                await this.handleDropData(event.dataTransfer, isAppend);
            }
        });
        dropArea.addEventListener('dragleave', () => dropArea.classList.remove('hover'));
        
        // 图片区域点击事件 - 只在特定区域触发文件导入
        photoWallContainer.addEventListener('click', (event) => {
            // 检查是否正在进行图片拖拽
            if (this.isImageDragging) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            
            // 只有点击addMoreHint区域才触发文件导入
            if (event.target.closest('#addMoreHint')) {
                // 这个会被addMoreHint的专门事件处理器处理，这里不处理
                return;
            }
            
            // 其他背景区域点击不触发任何操作
            event.preventDefault();
            event.stopPropagation();
        });
        
        // 添加更多提示区域的点击事件
        this.UI.addMoreHint.addEventListener('click', (event) => {
            if (this.isImageDragging) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            event.stopPropagation();
            const now = Date.now();
            if (now - this.lastClickTime > 300) {
                this.lastClickTime = now;
                fileInputImages.click();
            }
        });

        // 添加更多提示区域的拖拽效果
        this.UI.addMoreHint.addEventListener('dragover', (event) => {
            if (!this.isImageDragging) {
                event.preventDefault();
                this.UI.addMoreHint.classList.add('drag-over');
            }
        });
        this.UI.addMoreHint.addEventListener('dragleave', () => {
            this.UI.addMoreHint.classList.remove('drag-over');
        });
        this.UI.addMoreHint.addEventListener('drop', async (event) => {
            this.UI.addMoreHint.classList.remove('drag-over');
            if (!this.isImageDragging) {
                event.preventDefault();
                event.stopPropagation();
                await this.handleDropData(event.dataTransfer, true);
            }
        });
        photoWallContainer.addEventListener('dragover', event => {
            // 简化的拖拽类型检查
            if (this.isImageDragging) {
                // 如果是图片重排序，不处理任何事件，让photoWall处理
                return;
            }
            
            const isFileDrag = event.dataTransfer.types.includes('Files');
            if (isFileDrag) {
                event.preventDefault();
                photoWallContainer.classList.add('drag-hover');
                // 在进度文本区域显示轻量提示
                if (this.UI.progressText && !this.isDragOverActive) {
                    this.isDragOverActive = true;
                    this.UI.progressText.textContent = '释放以添加图片';
                    this.UI.progressContainer.style.display = 'block';
                }
            }
        });
        photoWallContainer.addEventListener('drop', async (event) => {
            // 简化的拖拽类型检查
            if (this.isImageDragging) {
                // 如果是图片重排序，不处理任何事件，让photoWall处理
                return;
            }

            event.preventDefault();
            photoWallContainer.classList.remove('drag-hover');
            this.isDragOverActive = false;
            // 图片区域总是增量添加模式
            await this.handleDropData(event.dataTransfer, true);
        });
        photoWallContainer.addEventListener('dragleave', (event) => {
            // 简化的拖拽类型检查
            if (this.isImageDragging) {
                // 如果是图片重排序，不处理任何事件
                return;
            }
            
            photoWallContainer.classList.remove('drag-hover');
            this.isDragOverActive = false;
            // 延迟清除提示，避免在拖拽过程中频繁切换
            setTimeout(() => {
                if (!this.isDragOverActive && this.UI.photoWall.children.length > 0) {
                    this.updateLayout();
                }
            }, 100);
        });
        
        // 图片选择输入变化事件
        fileInputImages.addEventListener('change', event => {
            const isAppend = this.UI.photoWall.children.length > 0;
            this.handleFiles(event.target.files, isAppend);
            event.target.value = '';
        });

        // 文件夹选择输入变化事件
        fileInputFolder.addEventListener('change', event => {
            const isAppend = this.UI.photoWall.children.length > 0;
            this.handleFiles(event.target.files, isAppend);
            event.target.value = '';
        });

        captureButton.addEventListener('click', () => this.captureAndSaveImages());
        sortOrder.addEventListener('change', () => this.handleSort());
        this.UI.appendMode.addEventListener('change', () => this.updateDropAreaText());

        Object.values(this.UI).forEach(element => {
            if (element && ['INPUT', 'SELECT'].includes(element.tagName)) {
                element.addEventListener('change', () => this.updateLayout());
            }
        });

        // 添加全局点击事件监听器，防止拖拽结束后的误触发
        document.addEventListener('click', (event) => {
            if (this.isImageDragging) {
                // 检查是否点击的是文件输入相关的元素
                if (event.target === fileInputImages ||
                    event.target === fileInputFolder ||
                    event.target.closest('#dropArea') ||
                    event.target.closest('#photoWallContainer') ||
                    event.target.closest('#addMoreHint')) {
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                }
            }
        }, true); // 使用捕获阶段
    }

    // 处理拖放数据（支持跨应用拖放）
    async handleDropData(dataTransfer, isAppend = false) {
        const files = [];

        // 优先处理文件列表
        if (dataTransfer.files && dataTransfer.files.length > 0) {
            for (const file of dataTransfer.files) {
                if (file.type.startsWith('image/')) {
                    files.push(file);
                }
            }
        }

        // 如果没有文件，尝试从items获取（iOS跨应用拖放）
        if (files.length === 0 && dataTransfer.items) {
            const itemPromises = [];

            for (const item of dataTransfer.items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) {
                        files.push(file);
                    }
                } else if (item.kind === 'string' && item.type === 'text/uri-list') {
                    // 处理图片URL（某些应用可能传递URL）
                    itemPromises.push(new Promise((resolve) => {
                        item.getAsString(async (url) => {
                            try {
                                if (url && (url.startsWith('http') || url.startsWith('blob:'))) {
                                    const response = await fetch(url);
                                    const blob = await response.blob();
                                    if (blob.type.startsWith('image/')) {
                                        const fileName = `image_${Date.now()}.${blob.type.split('/')[1] || 'png'}`;
                                        const file = new File([blob], fileName, { type: blob.type });
                                        resolve(file);
                                        return;
                                    }
                                }
                            } catch (e) {
                                console.warn('无法获取拖放的图片URL:', e);
                            }
                            resolve(null);
                        });
                    }));
                }
            }

            // 等待所有URL处理完成
            if (itemPromises.length > 0) {
                const urlFiles = await Promise.all(itemPromises);
                for (const file of urlFiles) {
                    if (file) files.push(file);
                }
            }
        }

        if (files.length > 0) {
            this.handleFiles(files, isAppend);
        } else {
            this.showProgress(this.UI.progressContainer, this.UI.progressText, '未检测到图片文件', false);
            setTimeout(() => {
                this.UI.progressContainer.style.display = 'none';
            }, 2000);
        }
    }

    async handleFiles(files, isAppend = false) {
        const { photoWall, sortOrder, progressContainer, progressText, captureButton, photoWallContainer } = this.UI;

        // 清除拖拽状态
        this.isDragOverActive = false;
        photoWallContainer.classList.remove('drag-hover');

        if (!isAppend) {
        photoWall.innerHTML = '';
        photoWallContainer.style.display = 'none';
            this.currentProcessedFiles = [];
        }
        
        progressContainer.style.display = 'block';

        const fileArray = Array.from(files).filter(file => file.type.startsWith('image/'));
        
        if (fileArray.length === 0) {
            this.showProgress(progressContainer, progressText, '没有找到图片文件', false);
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 2000);
            return;
        }
        
        if (this.worker) {
            // Use Web Worker for file processing
            this.showProgress(progressContainer, progressText, isAppend ? '正在添加新图片...' : '正在分析图片...', true);
            this.worker.postMessage({
                type: 'processFiles',
                data: {
                    files: fileArray,
                    sortOrder: sortOrder.value,
                    isAppend: isAppend,
                    appendMode: isAppend ? this.UI.appendMode.value : 'append',
                    existingFiles: isAppend && this.currentProcessedFiles ? this.currentProcessedFiles : []
                }
            });
        } else {
            // Fallback to main thread with chunked processing
            await this.handleFilesMainThread(fileArray, sortOrder.value, isAppend);
        }
    }

    async handleFilesMainThread(fileArray, sortOrder, isAppend = false) {
        const { photoWall, progressContainer, progressText, captureButton, photoWallContainer, appendMode } = this.UI;
        
        this.showProgress(progressContainer, progressText, '正在对文件排序...', true);

        let sortedFiles;
        let newFilesOnly = [];
        
        // 如果是追加模式，根据添加方式处理
        if (isAppend && this.currentProcessedFiles) {
            const existingFiles = this.currentProcessedFiles.map(data => data.file || data);
            
            if (appendMode.value === 'append') {
                // 添加到末尾：先排序新文件，然后追加到现有文件后面
                const sortedNewFiles = this.sortFiles(fileArray, sortOrder);
                sortedFiles = [...existingFiles, ...sortedNewFiles];
                newFilesOnly = sortedNewFiles; // 记录新文件用于局部渲染
            } else {
                // 按当前排序插入：合并所有文件后重新排序
                const allFiles = [...existingFiles, ...fileArray];
                sortedFiles = this.sortFiles(allFiles, sortOrder);
            }
        } else {
            // 首次导入，直接排序
            sortedFiles = this.sortFiles(fileArray, sortOrder);
        }

        this.showProgress(progressContainer, progressText, isAppend ? '正在添加图片...' : '正在导入图片...', true);

        // 如果是追加到末尾模式，只渲染新文件
        if (isAppend && appendMode.value === 'append' && newFilesOnly.length > 0) {
            // 局部渲染：只添加新文件
            const chunkSize = 5;
            for (let i = 0; i < newFilesOnly.length; i += chunkSize) {
                const chunk = newFilesOnly.slice(i, i + chunkSize);
                
                await new Promise(resolve => {
                    setTimeout(async () => {
                        for (const file of chunk) {
                            await this.loadImage(file, photoWall);
                        }
                        this.updateProgress(progressText, Math.min(i + chunkSize, newFilesOnly.length) / newFilesOnly.length, '正在添加新图片...');
                        resolve();
                    }, 0);
                });
            }
            this.showProgress(progressContainer, progressText, `已添加 ${newFilesOnly.length} 张新图片`, false);
        } else {
            // 全量渲染：清空后重新渲染所有图片
            if (isAppend) {
                photoWall.innerHTML = '';
            }

            const chunkSize = 5;
            for (let i = 0; i < sortedFiles.length; i += chunkSize) {
                const chunk = sortedFiles.slice(i, i + chunkSize);
                
                await new Promise(resolve => {
                    setTimeout(async () => {
                        for (const file of chunk) {
                await this.loadImage(file, photoWall);
                        }
                        this.updateProgress(progressText, Math.min(i + chunkSize, sortedFiles.length) / sortedFiles.length, isAppend ? '正在添加图片...' : '正在导入图片...');
                        resolve();
                    }, 0);
                });
            }
            this.showProgress(progressContainer, progressText, '导入完成', false);
        }

        // 更新当前处理的文件列表
        this.currentProcessedFiles = sortedFiles.map(file => ({
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            width: file.width || 0,
            height: file.height || 0,
            aspectRatio: file.aspectRatio || 0,
            resolution: file.resolution || 0,
            file: file
        }));

        this.updateLayout();

        if (photoWall.children.length > 0) {
            photoWallContainer.style.display = 'flex';
            captureButton.style.display = 'block';
            // 更新拖拽区域提示文字
            this.updateDropAreaText();
        }
    }

    onFilesProcessed(processedFiles, isAppend = false) {
        // Worker 已经处理了合并和排序，直接使用返回的文件列表
        const previousCount = this.currentProcessedFiles ? this.currentProcessedFiles.length : 0;
        this.currentProcessedFiles = processedFiles;
        
        // 如果是追加模式且选择添加到末尾，只渲染新添加的图片
        if (isAppend && this.UI.appendMode.value === 'append') {
            const newFiles = processedFiles.slice(previousCount);
            this.renderNewFiles(newFiles);
        } else {
            // 其他情况重新渲染所有图片
            this.renderProcessedFiles(this.currentProcessedFiles, isAppend);
        }
    }

    async renderProcessedFiles(processedFiles, isAppend = false) {
        const { photoWall, progressContainer, progressText, captureButton, photoWallContainer } = this.UI;
        
        this.showProgress(progressContainer, progressText, isAppend ? '正在添加图片...' : '正在渲染图片...', true);

        // 如果是追加模式，清空现有显示重新渲染所有图片
        if (isAppend) {
            photoWall.innerHTML = '';
        }

        // Render images in chunks to avoid blocking
        const chunkSize = 5;
        for (let i = 0; i < processedFiles.length; i += chunkSize) {
            const chunk = processedFiles.slice(i, i + chunkSize);
            
            await new Promise(resolve => {
                setTimeout(async () => {
                    for (const fileData of chunk) {
                        await this.loadImageFromFileData(fileData, photoWall);
                    }
                    this.updateProgress(progressText, Math.min(i + chunkSize, processedFiles.length) / processedFiles.length, isAppend ? '正在添加图片...' : '正在渲染图片...');
                    resolve();
                }, 0);
            });
        }

        this.showProgress(progressContainer, progressText, '导入完成', false);
        this.updateLayout();

        if (photoWall.children.length > 0) {
            photoWallContainer.style.display = 'flex';
            captureButton.style.display = 'block';
            // 更新拖拽区域提示文字
            this.updateDropAreaText();
        }
    }

    async renderNewFiles(newFiles) {
        const { photoWall, progressContainer, progressText, captureButton, photoWallContainer } = this.UI;
        
        if (newFiles.length === 0) {
            this.showProgress(progressContainer, progressText, '没有新图片需要添加', false);
            return;
        }

        this.showProgress(progressContainer, progressText, '正在添加新图片...', true);

        // 只渲染新添加的图片，不清空现有图片
        const chunkSize = 5;
        for (let i = 0; i < newFiles.length; i += chunkSize) {
            const chunk = newFiles.slice(i, i + chunkSize);
            
            await new Promise(resolve => {
                setTimeout(async () => {
                    for (const fileData of chunk) {
                        await this.loadImageFromFileData(fileData, photoWall);
                    }
                    this.updateProgress(progressText, Math.min(i + chunkSize, newFiles.length) / newFiles.length, '正在添加新图片...');
                    resolve();
                }, 0);
            });
        }

        this.showProgress(progressContainer, progressText, `已添加 ${newFiles.length} 张新图片`, false);
        this.updateLayout();

        if (photoWall.children.length > 0) {
            photoWallContainer.style.display = 'flex';
            captureButton.style.display = 'block';
            // 更新拖拽区域提示文字
            this.updateDropAreaText();
        }
    }

    async loadImageFromFileData(fileData, photoWall) {
        try {
            const img = await Utils.loadImage(fileData.file);
            img.className = 'photo';
            img.setAttribute('alt', fileData.name);
            img.setAttribute('title', fileData.name);
            img.setAttribute('name', fileData.name);
            img.setAttribute('size', fileData.size);
            img.setAttribute('type', fileData.type);
            img.setAttribute('date', fileData.lastModified);
            img.setAttribute('lastModified', Utils.formatDate(new Date(fileData.lastModified)));
            img.setAttribute('width', fileData.width);
            img.setAttribute('height', fileData.height);
            img.setAttribute('aspectRatio', fileData.aspectRatio);

            const imgContainer = document.createElement('div');
            imgContainer.className = 'photo-container';
            imgContainer.appendChild(img);
            imgContainer.setAttribute('width', fileData.width);
            imgContainer.setAttribute('height', fileData.height);
            imgContainer.setAttribute('aspectRatio', fileData.aspectRatio);

            // 添加iOS风格拖拽事件监听器
            this.setupImageDragEvents(imgContainer, photoWall);

            this.insertImageContainer(imgContainer, photoWall);
        } catch (error) {
            console.error('加载图片时出错:', error);
        }
    }

    async loadImage(file, photoWall) {
        try {
            const img = await Utils.loadImage(file);
            img.className = 'photo';
            img.setAttribute('alt', file.name);
            img.setAttribute('title', file.name);
            img.setAttribute('name', file.name);
            img.setAttribute('size', file.size);
            img.setAttribute('type', file.type);
            img.setAttribute('date', file.lastModified);
            img.setAttribute('lastModified', Utils.formatDate(new Date(file.lastModified)));

            const width = img.naturalWidth;
            const height = img.naturalHeight;
            const aspectRatio = (width / height).toFixed(2);
            file.width = width;
            file.height = height;
            file.aspectRatio = parseFloat(aspectRatio);
            file.resolution = width * height;
            img.setAttribute('width', width);
            img.setAttribute('height', height);
            img.setAttribute('aspectRatio', aspectRatio);

            const imgContainer = document.createElement('div');
            imgContainer.className = 'photo-container';
            imgContainer.appendChild(img);
            imgContainer.setAttribute('width', width);
            imgContainer.setAttribute('height', height);
            imgContainer.setAttribute('aspectRatio', aspectRatio);

            // 添加iOS风格拖拽事件监听器
            this.setupImageDragEvents(imgContainer, photoWall);

            this.insertImageContainer(imgContainer, photoWall);
        } catch (error) {
            console.error('加载图片时出错:', error);
            throw error;
        }
    }

    // 插入图片容器到正确位置（在addMoreHint之前）
    insertImageContainer(imgContainer, photoWall) {
        const addMoreHint = photoWall.querySelector('#addMoreHint');
        if (addMoreHint) {
            photoWall.insertBefore(imgContainer, addMoreHint);
        } else {
            photoWall.appendChild(imgContainer);
        }
    }

    // 图片拖拽系统 - 直接拖拽模式
    setupImageDragEvents(imgContainer, photoWall) {
        imgContainer.draggable = false;

        const handleStart = (e) => {
            if (this.isImageDragging) return;

            e.preventDefault();
            e.stopPropagation();

            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);

            // 设置拖拽准备状态
            this.dragState = {
                container: imgContainer,
                photoWall: photoWall,
                startX: clientX,
                startY: clientY,
                hasDragStarted: false
            };

            imgContainer.classList.add('drag-ready');
            this.setupGlobalDragListeners();
        };

        imgContainer.addEventListener('mousedown', handleStart);
        imgContainer.addEventListener('touchstart', handleStart, { passive: false });

        imgContainer.addEventListener('click', (e) => {
            if (this.isImageDragging) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        });

        if (!photoWall.hasAttribute('data-drag-setup')) {
            this.setupPhotoWallDragEvents(photoWall);
            photoWall.setAttribute('data-drag-setup', 'true');
        }
    }

    setupGlobalDragListeners() {
        if (this.globalMoveHandler || this.globalEndHandler) {
            this.cleanupGlobalListeners();
        }

        this.globalMoveHandler = (e) => {
            if (!this.dragState) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);

            // 检测是否超过拖拽启动阈值
            if (!this.dragState.hasDragStarted) {
                const deltaX = Math.abs(clientX - this.dragState.startX);
                const deltaY = Math.abs(clientY - this.dragState.startY);

                if (deltaX > this.dragStartThreshold || deltaY > this.dragStartThreshold) {
                    this.dragState.hasDragStarted = true;
                    this.startDragMode(this.dragState.container, this.dragState.photoWall);
                }
            }

            if (this.isImageDragging) {
                this.updateDragPosition(clientX, clientY, this.dragState.photoWall);
            }
        };

        this.globalEndHandler = (e) => {
            if (this.dragState) {
                if (this.isImageDragging) {
                    this.endDragMode();
                }
                this.cancelDragState();
            }
        };

        document.addEventListener('mousemove', this.globalMoveHandler, { passive: false, capture: true });
        document.addEventListener('touchmove', this.globalMoveHandler, { passive: false, capture: true });
        document.addEventListener('mouseup', this.globalEndHandler, { capture: true });
        document.addEventListener('touchend', this.globalEndHandler, { capture: true });
        document.addEventListener('touchcancel', this.globalEndHandler, { capture: true });
        window.addEventListener('mousemove', this.globalMoveHandler, { passive: false });
        window.addEventListener('touchmove', this.globalMoveHandler, { passive: false });
    }

    cleanupGlobalListeners() {
        if (this.globalMoveHandler) {
            document.removeEventListener('mousemove', this.globalMoveHandler, { capture: true });
            document.removeEventListener('touchmove', this.globalMoveHandler, { capture: true });
            window.removeEventListener('mousemove', this.globalMoveHandler);
            window.removeEventListener('touchmove', this.globalMoveHandler);
        }
        if (this.globalEndHandler) {
            document.removeEventListener('mouseup', this.globalEndHandler, { capture: true });
            document.removeEventListener('touchend', this.globalEndHandler, { capture: true });
            document.removeEventListener('touchcancel', this.globalEndHandler, { capture: true });
        }
        this.globalMoveHandler = null;
        this.globalEndHandler = null;
    }

    cancelDragState() {
        if (this.dragState) {
            if (this.dragState.container) {
                this.dragState.container.classList.remove('drag-ready');
            }
            this.dragState = null;
        }
        this.lastInsertPosition = null;
        this.cleanupGlobalListeners();
    }

    startDragMode(imgContainer, photoWall) {
        if (this.isImageDragging || !this.dragState) return;

        this.isImageDragging = true;

        if (navigator.vibrate) {
            navigator.vibrate(30);
        }

        // 创建拖拽克隆
        const rect = imgContainer.getBoundingClientRect();
        const clone = imgContainer.cloneNode(true);
        clone.className = 'drag-clone';
        clone.style.cssText = `
            position: fixed;
            left: 0;
            top: 0;
            width: ${rect.width}px;
            height: ${rect.height}px;
            z-index: 10000;
            pointer-events: none;
            transform: translate(${rect.left}px, ${rect.top}px) scale(1.05);
            will-change: transform;
        `;

        document.body.appendChild(clone);
        this.draggedClone = clone;

        // 创建插入指示器
        const indicator = document.createElement('div');
        indicator.className = 'drag-insert-indicator';
        this.insertIndicator = indicator;

        // 设置原始元素样式
        imgContainer.classList.add('dragging');
        imgContainer.classList.remove('drag-ready');
        this.draggedElement = imgContainer;

        // 更新克隆位置
        this.updateDragPosition(this.dragState.startX, this.dragState.startY, photoWall);

        document.body.classList.add('drag-mode-active');
        document.body.style.overflow = 'hidden';
        document.body.style.userSelect = 'none';
    }

    updateDragPosition(x, y, photoWall) {
        if (!this.draggedClone) return;

        const offsetX = this.draggedClone.offsetWidth / 2;
        const offsetY = this.draggedClone.offsetHeight / 2;

        this.draggedClone.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px) scale(1.05)`;

        requestAnimationFrame(() => {
            this.updateInsertPosition(photoWall, x, y);
        });
    }

    endDragMode() {
        if (!this.isImageDragging) return;

        // 执行重排序
        if (this.insertIndicator && this.insertIndicator.parentNode && this.draggedElement) {
            this.insertIndicator.parentNode.insertBefore(this.draggedElement, this.insertIndicator);
        }

        // 清理拖拽元素
        if (this.draggedClone) {
            this.draggedClone.remove();
            this.draggedClone = null;
        }

        if (this.insertIndicator) {
            this.insertIndicator.remove();
            this.insertIndicator = null;
        }

        if (this.draggedElement) {
            this.draggedElement.classList.remove('dragging', 'drag-ready');
            this.draggedElement = null;
        }

        document.body.classList.remove('drag-mode-active');
        document.body.style.overflow = '';
        document.body.style.userSelect = '';

        this.lastInsertPosition = null;
        this.isImageDragging = false;
    }

    updateInsertPosition(photoWall, x, y) {
        if (!this.insertIndicator || !this.draggedElement) return;

        const containers = Array.from(photoWall.children).filter(child =>
            child.classList.contains('photo-container') &&
            !child.classList.contains('dragging') &&
            child.id !== 'addMoreHint'
        );

        if (containers.length === 0) {
            const addMoreHint = photoWall.querySelector('#addMoreHint');
            if (addMoreHint && this.insertIndicator.parentNode !== photoWall) {
                photoWall.insertBefore(this.insertIndicator, addMoreHint);
            } else if (!addMoreHint) {
                photoWall.appendChild(this.insertIndicator);
            }
            return;
        }

        let bestTarget = null;
        let insertBefore = true;
        let minDistance = Infinity;

        for (const container of containers) {
            const rect = container.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // 计算到左边缘和右边缘的距离
            const distToLeft = Math.abs(x - rect.left) + Math.abs(y - centerY);
            const distToRight = Math.abs(x - rect.right) + Math.abs(y - centerY);

            if (distToLeft < minDistance) {
                minDistance = distToLeft;
                bestTarget = container;
                insertBefore = true;
            }
            if (distToRight < minDistance) {
                minDistance = distToRight;
                bestTarget = container;
                insertBefore = false;
            }
        }

        if (bestTarget) {
            const newPosition = { target: bestTarget, before: insertBefore };

            const needsMove = !this.lastInsertPosition ||
                             this.lastInsertPosition.target !== bestTarget ||
                             this.lastInsertPosition.before !== insertBefore;

            if (needsMove) {
                try {
                    if (insertBefore) {
                        bestTarget.parentNode.insertBefore(this.insertIndicator, bestTarget);
                    } else {
                        bestTarget.parentNode.insertBefore(this.insertIndicator, bestTarget.nextSibling);
                    }
                    this.lastInsertPosition = newPosition;
                } catch (error) {
                    console.warn('插入指示器位置更新失败:', error);
                }
            }
        }
    }

    setupPhotoWallDragEvents(photoWall) {
        photoWall.addEventListener('click', (e) => {
            if (e.target.closest('.photo-container') || e.target.closest('.photo')) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        });
    }





    sortFiles(files, order) {
        return files.sort((a, b) => {
            switch (order) {
                case 'nameAsc': return a.name.localeCompare(b.name);
                case 'nameDesc': return b.name.localeCompare(a.name);
                case 'dateAsc': return a.lastModified - b.lastModified;
                case 'dateDesc': return b.lastModified - a.lastModified;
                case 'sizeAsc': return a.size - b.size;
                case 'sizeDesc': return b.size - a.size;
                case 'typeAsc': return a.type.localeCompare(b.type);
                case 'typeDesc': return b.type.localeCompare(a.type);
                case 'widthAsc': return a.width - b.width;
                case 'widthDesc': return b.width - a.width;
                case 'heightAsc': return a.height - b.height;
                case 'heightDesc': return b.height - a.height;
                case 'aspectRatioAsc': return a.aspectRatio - b.aspectRatio;
                case 'aspectRatioDesc': return b.aspectRatio - a.aspectRatio;
                case 'resolutionAsc': return (a.width * a.height) - (b.width * b.height);
                case 'resolutionDesc': return (b.width * b.height) - (a.width * a.height);
                default: return 0;
            }
        });
    }

    handleSort() {
        const { photoWall, sortOrder, progressContainer, progressText } = this.UI;

        if (this.currentProcessedFiles && this.currentProcessedFiles.length > 0 && this.worker) {
            // Use worker to sort already processed files
            this.showProgress(progressContainer, progressText, '正在重新排序...', true);
            this.worker.postMessage({
                type: 'sortFiles',
                data: {
                    filesToSort: this.currentProcessedFiles,
                    order: sortOrder.value
                }
            });
        } else {
            // Fallback to main thread sorting
            this.handleSortMainThread();
        }
    }

    handleSortMainThread() {
        const { photoWall, sortOrder } = this.UI;
            // 只获取photo-container元素，排除addMoreHint
            const images = Array.from(photoWall.children).filter(child => 
                child.classList.contains('photo-container')
            );
            const sortedImages = this.sortFiles(images.map(img => ({
                name: img.getAttribute('name'),
                lastModified: new Date(img.getAttribute('lastModified')).getTime(),
                size: parseInt(img.getAttribute('size')),
                type: img.getAttribute('type'),
                width: parseInt(img.getAttribute('width')),
                height: parseInt(img.getAttribute('height')),
                aspectRatio: parseFloat(img.getAttribute('aspectRatio')),
                resolution: parseInt(img.getAttribute('width')) * parseInt(img.getAttribute('height')),
                element: img
        })), sortOrder.value);
    
            // 保存addMoreHint元素
            const addMoreHint = photoWall.querySelector('#addMoreHint');
            photoWall.innerHTML = '';
            
            // 重新插入排序后的图片
            sortedImages.forEach(file => this.insertImageContainer(file.element, photoWall));
            
            // 确保addMoreHint在最后
            if (addMoreHint) {
                photoWall.appendChild(addMoreHint);
            }
            
            this.updateLayout();
        }

    onFilesSorted(sortedFiles) {
        this.currentProcessedFiles = sortedFiles;
        this.renderProcessedFiles(sortedFiles);
    }

    async captureAndSaveImages() {
        if (this.isGenerating) return;
        
        const { photoWall, rowsInput, columnsInput, downloadMode, progressContainer, progressText, captureButton, linksContainer, imageFormat, imageQuality } = this.UI;
        // 只获取photo-container元素，排除addMoreHint
        const photos = Array.from(photoWall.children).filter(child => 
            child.classList.contains('photo-container')
        );
        const imagesPerCapture = parseInt(rowsInput.value) * parseInt(columnsInput.value);
        const totalScreenshots = Math.ceil(photos.length / imagesPerCapture);
        const format = imageFormat.value;
        const quality = parseInt(imageQuality.value) / 100;
        const downloadModeValue = downloadMode.value;
    
        try {
            this.isGenerating = true;
            captureButton.style.display = 'none';
            this.showProgress(progressContainer, progressText, '正在截图...', true);
        
            linksContainer.innerHTML = '';
        
            if (downloadModeValue === 'folder') {
                // 保存到文件夹模式
                await this.saveToFolder(photos, imagesPerCapture, format, quality);
            } else if (downloadModeValue === 'browser') {
                // 浏览器下载模式
                await this.processImagesChunked(photos, imagesPerCapture, false, format, quality);
                this.showProgress(progressContainer, progressText, '截图完成', false);
            } else {
                // 打包下载模式
                const imageDataArray = await this.processImagesChunked(photos, imagesPerCapture, true, format, quality);
                
                if (this.worker) {
                    this.showProgress(progressContainer, progressText, '正在打包...', false);
                    this.worker.postMessage({
                        type: 'createZip',
                        data: {
                            imageDataArray,
                            format
                        }
                    });
                } else {
                    // Fallback to main thread zip creation
                    await this.createZipMainThread(imageDataArray, format);
                }
            }
        } catch (error) {
            console.error('生成截图时出错:', error);
            this.showProgress(progressContainer, progressText, '生成失败，请重试', false);
            this.isGenerating = false;
            this.resetUIState();
        }
    }

    async saveToFolder(photos, imagesPerCapture, format, quality) {
        const { progressText } = this.UI;
        
        try {
            // 检查浏览器是否支持 File System Access API
            if (!('showDirectoryPicker' in window)) {
                throw new Error('您的浏览器不支持文件夹保存功能，请使用其他下载方式');
            }
            
            // 让用户选择保存文件夹
            this.showProgress(this.UI.progressContainer, progressText, '请选择保存文件夹...', true);
            
            let directoryHandle;
            try {
                directoryHandle = await window.showDirectoryPicker();
            } catch (error) {
                if (error.name === 'AbortError') {
                    this.showProgress(this.UI.progressContainer, progressText, '用户取消了文件夹选择', false);
                    return;
                }
                throw error;
            }
            
            this.showProgress(this.UI.progressContainer, progressText, '正在截图并保存...', true);
            
            const chunkSize = 2; // Process 2 screenshots at a time
            
            for (let i = 0; i < photos.length; i += imagesPerCapture * chunkSize) {
                const chunkedPromises = [];
                
                for (let j = 0; j < chunkSize && i + j * imagesPerCapture < photos.length; j++) {
                    const startIndex = i + j * imagesPerCapture;
                    const endIndex = Math.min(startIndex + imagesPerCapture, photos.length);
                    const photoChunk = photos.slice(startIndex, endIndex);
                    const screenshotIndex = Math.floor(startIndex / imagesPerCapture);
                    
                    chunkedPromises.push(
                        new Promise(resolve => {
                            setTimeout(async () => {
                                try {
                                    const fileName = `${(screenshotIndex + 1).toString().padStart(3, '0')}.${format}`;
                                    const imgData = await this.imageProcessor.captureAndSaveImage(photoChunk, null, format, quality);
                                    
                                    // 将base64转换为blob
                                    const blob = this.base64ToBlob(imgData, `image/${format}`);
                                    
                                    // 保存到选择的文件夹
                                    const fileHandle = await directoryHandle.getFileHandle(fileName, { 
                                        create: true 
                                    });
                                    const writable = await fileHandle.createWritable();
                                    await writable.write(blob);
                                    await writable.close();
                                    
                                    resolve();
                                } catch (error) {
                                    console.error('保存文件出错:', error);
                                    resolve();
                                }
                            }, 0);
                        })
                    );
                }
                
                await Promise.all(chunkedPromises);
                
                const processed = Math.min(i + imagesPerCapture * chunkSize, photos.length);
                this.updateProgress(progressText, processed / photos.length, '正在截图并保存...');
            }
            
            this.showProgress(this.UI.progressContainer, progressText, '所有文件已保存到文件夹', false);
            
        } catch (error) {
            console.error('保存到文件夹失败:', error);
            if (error.name === 'AbortError') {
                this.showProgress(this.UI.progressContainer, progressText, '用户取消了文件夹选择', false);
            } else {
                this.showProgress(this.UI.progressContainer, progressText, `保存失败: ${error.message}`, false);
            }
        } finally {
            this.isGenerating = false;
            this.resetUIState();
        }
    }

    async processImagesChunked(photos, imagesPerCapture, collectData, format, quality) {
        const { progressText } = this.UI;
        const imageDataArray = [];
        const chunkSize = 2; // Process 2 screenshots at a time
        
        for (let i = 0; i < photos.length; i += imagesPerCapture * chunkSize) {
            const chunkedPromises = [];
            
            for (let j = 0; j < chunkSize && i + j * imagesPerCapture < photos.length; j++) {
                const startIndex = i + j * imagesPerCapture;
                const endIndex = Math.min(startIndex + imagesPerCapture, photos.length);
                const photoChunk = photos.slice(startIndex, endIndex);
                const screenshotIndex = Math.floor(startIndex / imagesPerCapture);
                
                chunkedPromises.push(
                    new Promise(resolve => {
                        setTimeout(async () => {
                            try {
                                const fileName = collectData ? null : `${(screenshotIndex + 1).toString().padStart(3, '0')}.${format}`;
                                const imgData = await this.imageProcessor.captureAndSaveImage(photoChunk, fileName, format, quality);
                                
                                if (collectData) {
                                    resolve({ data: imgData, index: screenshotIndex });
                                } else {
                                    if (!fileName) {
                                        this.UI.linksContainer.appendChild(Utils.createDownloadLink(imgData, `${(screenshotIndex + 1).toString().padStart(3, '0')}.${format}`));
                                    }
                                    resolve();
                                }
                            } catch (error) {
                                console.error('截图处理出错:', error);
                                resolve(collectData ? null : undefined);
                            }
                        }, 0);
                    })
                );
            }
            
            const results = await Promise.all(chunkedPromises);
            
            if (collectData) {
                imageDataArray.push(...results.filter(r => r !== null));
            }
            
            const processed = Math.min(i + imagesPerCapture * chunkSize, photos.length);
            this.updateProgress(progressText, processed / photos.length, '正在截图...');
        }
        
        return collectData ? imageDataArray : null;
    }

    async createZipMainThread(imageDataArray, format) {
        const { progressContainer, progressText } = this.UI;
        
        try {
            const zip = new JSZip();
            const formattedDate = Utils.formatDate(new Date());
            
            // Add images to zip
            imageDataArray.forEach(({ data, index }) => {
                const fileName = `${(index + 1).toString().padStart(3, '0')}.${format}`;
                zip.file(fileName, data, { base64: true });
            });
            
            this.showProgress(progressContainer, progressText, '正在生成压缩包...', false);
            
            const content = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: CONSTANTS.ZIP_COMPRESSION_LEVEL },
                onUpdate: (metadata) => {
                    const percentage = Math.min(Math.round(metadata.percent), 100);
                    progressText.innerText = `正在生成压缩包... ${percentage}%`;
                }
            });
            
            saveAs(content, `Screenshots_${formattedDate}.zip`);
            this.showProgress(progressContainer, progressText, '完成', false);
        } catch (error) {
            console.error('ZIP 生成失败:', error);
            this.showProgress(progressContainer, progressText, 'ZIP 生成失败', false);
        } finally {
            this.isGenerating = false;
            this.resetUIState();
        }
    }

    onZipCreated(zipData) {
        const { content, fileName } = zipData;
        saveAs(content, fileName);
        this.showProgress(this.UI.progressContainer, this.UI.progressText, '完成', false);
        this.isGenerating = false;
        this.resetUIState();
        }

    updateLayout() {
        const { photoWall, captureButton, photoWallContainer, progressContainer, progressText } = this.UI;

        const photoCount = photoWall.children.length;

        if (photoCount <= 0) {
            photoWall.innerHTML = '';
            progressText.innerText = '';
            captureButton.style.display = 'none';
            photoWallContainer.style.display = 'none';
            progressContainer.style.display = 'none';
            this.updateDropAreaText();
            return;
        }

        const { columnsInput, rowsInput, rowGapInput, columnGapInput, maxWidthInput, paddingXInput, paddingYInput, bgColorInput, imageBorderRadiusInput, pageBorderRadiusInput, imageAlignment } = this.UI;

        photoWall.style.padding = `${paddingYInput.value}px ${paddingXInput.value}px`;
        photoWall.style.gridTemplateColumns = `repeat(${columnsInput.value}, 1fr)`;
        photoWall.style.gridRowGap = `${rowGapInput.value}px`;
        photoWall.style.gridColumnGap = `${columnGapInput.value}px`;
        photoWall.style.maxWidth = `${maxWidthInput.value}px`;
        photoWall.style.backgroundColor = bgColorInput.value;
        photoWall.style.borderRadius = `${pageBorderRadiusInput.value}px`;

        photoWall.style.alignItems = imageAlignment.value;
        photoWall.style.justifyItems = imageAlignment.value;
        
        document.querySelectorAll('.photo-container').forEach(container => {
            container.style.borderRadius = `${imageBorderRadiusInput.value}px`;
            container.style.alignItems = imageAlignment.value;
            container.style.justifyContent = imageAlignment.value;
        });

        document.querySelectorAll('.photo').forEach(photo => {
            photo.style.borderRadius = `${imageBorderRadiusInput.value}px`;
        });

        const photosPerCapture = parseInt(columnsInput.value) * parseInt(rowsInput.value);
        const totalScreenshots = Math.ceil(photoCount / photosPerCapture);
        // 只在不是拖拽状态时更新进度文本
        if (!this.isDragOverActive) {
        progressText.innerText = `文件夹包含${photoCount}个图片，预计生成${totalScreenshots}张截图`;
        }
    }

    showProgress(container, textElement, text, progress = 100, percentage=false) {
        container.style.display = 'block';
        textElement.innerText = text;
        if(percentage){
            this.updateProgress(textElement, progress / 100, text);
        }
    }

    updateProgress(textElement, percentage, text) {
        textElement.innerText = `${text} ${Math.round(Math.min(percentage, 1) * 100)}%`;
    }

    updateDropAreaText() {
        const { dropArea, photoWall, addMoreHint, appendMode } = this.UI;
        // 只计算photo-container数量
        const photoCount = Array.from(photoWall.children).filter(
            child => child.classList.contains('photo-container')
        ).length;

        if (photoCount > 0) {
            dropArea.textContent = '添加更多图片';
            addMoreHint.style.display = 'flex';
            // 更新提示文字
            const modeText = appendMode.value === 'append' ? '添加到末尾' : '按排序插入';
            const pElement = addMoreHint.querySelector('p');
            if (pElement) {
                pElement.textContent = `${modeText}`;
            }
        } else {
            dropArea.textContent = '点击此处，导入文件夹';
            addMoreHint.style.display = 'none';
        }
    }

    resetUIState() {
        const { captureButton, progressContainer } = this.UI;
        
        if (captureButton) {
            captureButton.style.display = 'block';
        }
        
        if (progressContainer) {
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 2000);
        }
    }

    // 清理资源
    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }

        if (this.isImageDragging) {
            this.endDragMode();
        }

        if (this.dragState) {
            this.cancelDragState();
        }

        this.cleanupGlobalListeners();
    }
}

// 初始化应用
let uiManager;
document.addEventListener('DOMContentLoaded', () => {
    uiManager = new UIManager();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (uiManager) {
        uiManager.destroy();
    }
});
