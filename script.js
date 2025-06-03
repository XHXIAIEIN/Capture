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
        this.isImageDragging = false; // 全局图片拖拽状态
        this.draggedClone = null; // iOS风格拖拽克隆
        this.draggedElement = null; // 当前拖拽的元素
        this.placeholder = null; // 占位符元素
        this.dragState = null; // 拖拽状态
        this.globalMoveHandler = null; // 全局移动事件处理器
        this.globalEndHandler = null; // 全局结束事件处理器
        this.lastPlaceholderPosition = null; // 上一次占位符位置
        this.placeholderUpdateThrottle = false; // 占位符更新节流
        this.captureLayer = null; // 事件捕获层
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
            fileInput: document.getElementById('fileInput'),
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

    setupEventListeners() {
        const { dropArea, fileInput, captureButton, sortOrder, photoWallContainer } = this.UI;
        
        // 主拖拽区域事件
        dropArea.addEventListener('click', () => {
            // 检查是否正在进行图片拖拽
            if (this.isImageDragging) {
                return;
            }
            const now = Date.now();
            if (now - this.lastClickTime > 300) { // 300ms防抖
                this.lastClickTime = now;
                fileInput.click();
            }
        });
        dropArea.addEventListener('dragover', event => {
            // 只处理文件拖拽，忽略图片重排序
            if (!this.isImageDragging) {
                event.preventDefault();
                dropArea.classList.add('hover');
            }
        });
        dropArea.addEventListener('drop', event => {
            // 只处理文件拖拽，忽略图片重排序
            if (!this.isImageDragging && event.dataTransfer.files) {
                event.preventDefault();
                dropArea.classList.remove('hover');
                // 检查是否已有图片，如果有则为增量添加模式
                const isAppend = this.UI.photoWall.children.length > 0;
                this.handleFiles(event.dataTransfer.files, isAppend);
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
            // 检查是否正在进行图片拖拽
            if (this.isImageDragging) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            
            event.stopPropagation(); // 阻止事件冒泡
            const now = Date.now();
            if (now - this.lastClickTime > 300) { // 300ms防抖
                this.lastClickTime = now;
                fileInput.click();
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
        photoWallContainer.addEventListener('drop', event => {
            // 简化的拖拽类型检查
            if (this.isImageDragging) {
                // 如果是图片重排序，不处理任何事件，让photoWall处理
                return;
            }
            
            const isFileDrag = event.dataTransfer.files && event.dataTransfer.files.length > 0;
            if (isFileDrag) {
                event.preventDefault();
                photoWallContainer.classList.remove('drag-hover');
                this.isDragOverActive = false;
                // 图片区域总是增量添加模式
                this.handleFiles(event.dataTransfer.files, true);
            }
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
        
        fileInput.addEventListener('change', event => {
            // 检查是否已有图片，如果有则为增量添加模式
            const isAppend = this.UI.photoWall.children.length > 0;
            this.handleFiles(event.target.files, isAppend);
            // 重置文件输入，允许选择相同文件
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
                if (event.target === fileInput || 
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

    // 连贯的拖拽交互系统
    setupImageDragEvents(imgContainer, photoWall) {
        // 禁用默认拖拽
        imgContainer.draggable = false;
        
        // 鼠标/触摸开始事件
        const handleStart = (e) => {
            if (this.isImageDragging) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            
            // 设置拖拽状态
            this.dragState = {
                container: imgContainer,
                photoWall: photoWall,
                startX: clientX,
                startY: clientY,
                longPressTimer: null,
                isLongPressing: true
            };
            
            // 显示长按提示
            imgContainer.classList.add('long-pressing');
            
            // 设置长按计时器
            this.dragState.longPressTimer = setTimeout(() => {
                if (this.dragState && this.dragState.isLongPressing) {
                    this.startDragMode(imgContainer, photoWall);
                }
            }, 200);
            
            // 立即设置全局事件监听器
            this.setupGlobalDragListeners();
        };

        // 绑定开始事件
        imgContainer.addEventListener('mousedown', handleStart);
        imgContainer.addEventListener('touchstart', handleStart, { passive: false });

        // 点击事件处理
        imgContainer.addEventListener('click', (e) => {
            if (this.isImageDragging) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        });

        // 为photoWall设置拖拽接收事件（只设置一次）
        if (!photoWall.hasAttribute('data-drag-setup')) {
            this.setupPhotoWallDragEvents(photoWall);
            photoWall.setAttribute('data-drag-setup', 'true');
        }
    }

    // 设置全局事件监听器（确保拖拽连贯性）
    setupGlobalDragListeners() {
        // 如果已经设置过，先清理
        if (this.globalMoveHandler || this.globalEndHandler) {
            this.cleanupGlobalListeners();
        }

        // 全局移动事件
        this.globalMoveHandler = (e) => {
            if (!this.dragState) return;
            
            // 强制阻止默认行为和事件传播，确保拖拽优先级
            e.preventDefault();
            e.stopImmediatePropagation();
            
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            
            // 如果还在长按阶段，检查移动距离
            if (this.dragState.isLongPressing) {
                const deltaX = Math.abs(clientX - this.dragState.startX);
                const deltaY = Math.abs(clientY - this.dragState.startY);
                
                if (deltaX > 10 || deltaY > 10) {
                    this.cancelDragState();
                    return;
                }
            }
            
            // 如果在拖拽模式，更新位置
            if (this.isImageDragging) {
                this.updateDragPosition(clientX, clientY, this.dragState.photoWall);
            }
        };

        // 全局结束事件
        this.globalEndHandler = (e) => {
            if (this.dragState) {
                if (this.isImageDragging) {
                    this.endDragMode();
                }
                this.cancelDragState();
            }
        };

        // 绑定全局事件 - 使用捕获阶段确保优先级
        document.addEventListener('mousemove', this.globalMoveHandler, { 
            passive: false, 
            capture: true 
        });
        document.addEventListener('touchmove', this.globalMoveHandler, { 
            passive: false, 
            capture: true 
        });
        document.addEventListener('mouseup', this.globalEndHandler, { 
            capture: true 
        });
        document.addEventListener('touchend', this.globalEndHandler, { 
            capture: true 
        });
        document.addEventListener('touchcancel', this.globalEndHandler, { 
            capture: true 
        });
        
        // 额外绑定window级别的事件作为备份
        window.addEventListener('mousemove', this.globalMoveHandler, { 
            passive: false 
        });
        window.addEventListener('touchmove', this.globalMoveHandler, { 
            passive: false 
        });
    }

    // 清理全局事件监听器
    cleanupGlobalListeners() {
        if (this.globalMoveHandler) {
            // 清理document级别的事件监听器
            document.removeEventListener('mousemove', this.globalMoveHandler, { capture: true });
            document.removeEventListener('touchmove', this.globalMoveHandler, { capture: true });
            
            // 清理window级别的事件监听器
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

    // 取消拖拽状态
    cancelDragState() {
        if (this.dragState) {
            if (this.dragState.longPressTimer) {
                clearTimeout(this.dragState.longPressTimer);
            }
            if (this.dragState.container) {
                this.dragState.container.classList.remove('long-pressing');
            }
            this.dragState = null;
        }
        
        // 清理事件捕获层
        if (this.captureLayer) {
            this.captureLayer.remove();
            this.captureLayer = null;
        }
        
        // 清理占位符状态
        this.lastPlaceholderPosition = null;
        this.placeholderUpdateThrottle = false;
        
        this.cleanupGlobalListeners();
    }

    // 开始拖拽模式
    startDragMode(imgContainer, photoWall) {
        if (this.isImageDragging || !this.dragState) return;
        
        this.isImageDragging = true;
        this.dragState.isLongPressing = false;
        
        // 震动反馈
        if (navigator.vibrate) {
            navigator.vibrate(50);
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
            transform: translate(${rect.left}px, ${rect.top}px) scale(1.1) rotate(2deg);
            box-shadow: 0 15px 35px rgba(0,0,0,0.3);
            border-radius: 12px;
            transition: none;
            opacity: 0.9;
        `;
        
        document.body.appendChild(clone);
        this.draggedClone = clone;
        
        // 创建占位符
        const placeholder = document.createElement('div');
        placeholder.className = 'ios-placeholder';
        placeholder.style.cssText = `
            width: 100%;
            height: ${imgContainer.offsetHeight}px;
            border: 2px dashed #007bff;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
            animation: placeholderPulse 1.5s ease-in-out infinite;
        `;
        
        // 创建预览图片
        const previewImg = imgContainer.querySelector('.photo').cloneNode(true);
        previewImg.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.6;
            filter: grayscale(80%) brightness(0.7);
        `;
        
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 12px;
            font-weight: 600;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.9);
            pointer-events: none;
            backdrop-filter: blur(1px);
        `;
        overlay.textContent = '📍 放置位置';
        
        placeholder.appendChild(previewImg);
        placeholder.appendChild(overlay);
        
        imgContainer.parentNode.insertBefore(placeholder, imgContainer.nextSibling);
        this.placeholder = placeholder;
        
        // 设置原始元素样式
        imgContainer.style.opacity = '0.3';
        imgContainer.style.transform = 'scale(0.95)';
        imgContainer.classList.add('ios-dragging');
        this.draggedElement = imgContainer;
        
        // 立即更新克隆位置到当前鼠标位置
        this.updateDragPosition(this.dragState.startX, this.dragState.startY, photoWall);
        
        // 创建事件捕获层，确保拖拽事件不被其他元素拦截
        const captureLayer = document.createElement('div');
        captureLayer.id = 'drag-capture-layer';
        captureLayer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 9999;
            pointer-events: none;
            background: transparent;
        `;
        document.body.appendChild(captureLayer);
        this.captureLayer = captureLayer;
        
        // 全局样式
        document.body.classList.add('ios-drag-mode');
        document.body.style.overflow = 'hidden';
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';
    }

    // 更新拖拽位置
    updateDragPosition(x, y, photoWall) {
        if (!this.draggedClone || !this.placeholder) return;
        
        // 更新克隆位置 - 直接跟随鼠标
        const offsetX = this.draggedClone.offsetWidth / 2;
        const offsetY = this.draggedClone.offsetHeight / 2;
        
        this.draggedClone.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px) scale(1.1) rotate(2deg)`;
        
        // 使用节流更新占位符位置，防止边缘抖动
        if (!this.placeholderUpdateThrottle) {
            this.placeholderUpdateThrottle = true;
            requestAnimationFrame(() => {
                this.updatePlaceholderPosition(photoWall, x, y);
                this.placeholderUpdateThrottle = false;
            });
        }
    }

    // 结束拖拽模式
    endDragMode() {
        if (!this.isImageDragging) return;
        
        // 执行重排序
        if (this.placeholder && this.draggedElement) {
            this.placeholder.parentNode.insertBefore(this.draggedElement, this.placeholder);
        }
        
        // 清理拖拽元素
        if (this.draggedClone) {
            this.draggedClone.remove();
            this.draggedClone = null;
        }
        
        if (this.placeholder) {
            this.placeholder.remove();
            this.placeholder = null;
        }
        
        if (this.draggedElement) {
            this.draggedElement.style.opacity = '1';
            this.draggedElement.style.transform = '';
            this.draggedElement.classList.remove('ios-dragging', 'long-pressing');
            this.draggedElement = null;
        }
        
        // 清理事件捕获层
        if (this.captureLayer) {
            this.captureLayer.remove();
            this.captureLayer = null;
        }
        
        // 恢复全局样式
        document.body.classList.remove('ios-drag-mode');
        document.body.style.overflow = '';
        document.body.style.userSelect = '';
        document.body.style.webkitUserSelect = '';
        
        // 清理占位符状态
        this.lastPlaceholderPosition = null;
        this.placeholderUpdateThrottle = false;
        
        this.isImageDragging = false;
    }

    updatePlaceholderPosition(photoWall, x, y) {
        if (!this.placeholder || !this.draggedElement) return;
        
        // 获取所有图片容器（排除正在拖拽的、占位符和addMoreHint）
        const containers = Array.from(photoWall.children).filter(child => 
            child.classList.contains('photo-container') && 
            !child.classList.contains('ios-dragging') &&
            !child.classList.contains('ios-placeholder') &&
            child.id !== 'addMoreHint'
        );
        
        if (containers.length === 0) {
            if (this.placeholder.parentNode !== photoWall) {
                // 插入到addMoreHint之前
                const addMoreHint = photoWall.querySelector('#addMoreHint');
                if (addMoreHint) {
                    photoWall.insertBefore(this.placeholder, addMoreHint);
                } else {
                    photoWall.appendChild(this.placeholder);
                }
            }
            return;
        }
        
        // 智能位置检测：加入阈值防止抖动
        let bestContainer = null;
        let insertAfter = false;
        let minDistance = Infinity;
        const POSITION_THRESHOLD = 20; // 20px阈值防止边缘抖动
        
        for (const container of containers) {
            const rect = container.getBoundingClientRect();
            
            // 计算到容器中心的距离
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distanceToCenter = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
            
            if (distanceToCenter < minDistance) {
                minDistance = distanceToCenter;
                bestContainer = container;
                
                // 增强的位置判断：加入阈值检测
                const relativeX = x - centerX;
                const relativeY = y - centerY;
                
                // 使用阈值防止在边界附近频繁切换
                if (Math.abs(relativeX) > POSITION_THRESHOLD || Math.abs(relativeY) > POSITION_THRESHOLD) {
                    // 只有在明显偏向某一侧时才改变插入位置
                    insertAfter = relativeX > 0 || relativeY > 0;
                } else {
                    // 在阈值范围内，保持上一次的决定
                    if (this.lastPlaceholderPosition && this.lastPlaceholderPosition.container === container) {
                        insertAfter = this.lastPlaceholderPosition.insertAfter;
                    } else {
                        insertAfter = relativeX > 0 || relativeY > 0;
                    }
                }
            }
        }
        
        // 检查是否需要移动占位符
        if (bestContainer) {
            const currentPosition = {
                container: bestContainer,
                insertAfter: insertAfter
            };
            
            // 只有当位置真正改变时才移动，减少DOM操作
            const needsMove = !this.lastPlaceholderPosition || 
                             this.lastPlaceholderPosition.container !== bestContainer ||
                             this.lastPlaceholderPosition.insertAfter !== insertAfter;
            
            if (needsMove) {
                try {
                    if (insertAfter) {
                        bestContainer.parentNode.insertBefore(this.placeholder, bestContainer.nextSibling);
                    } else {
                        bestContainer.parentNode.insertBefore(this.placeholder, bestContainer);
                    }
                    this.lastPlaceholderPosition = currentPosition;
                } catch (error) {
                    console.warn('占位符插入失败:', error);
                }
            }
        }
    }

    // 简化的photoWall事件处理
    setupPhotoWallDragEvents(photoWall) {
        // 点击事件处理
        photoWall.addEventListener('click', (e) => {
            // 如果点击的是图片相关元素，阻止事件传播
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
        const { fileInput, photoWall, sortOrder, progressContainer, progressText } = this.UI;
        const files = Array.from(fileInput.files);
        
        if (files.length > 0) {
            this.handleFiles(files);
        } else if (this.currentProcessedFiles && this.worker) {
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
        if (photoWall.children.length > 0) {
            dropArea.textContent = '添加更多图片';
            addMoreHint.style.display = 'block';
            // 更新提示文字以反映当前添加模式
            const modeText = appendMode.value === 'append' ? '添加到末尾' : '按排序插入';
            addMoreHint.querySelector('p').textContent = `点击此处或拖拽文件到这里（${modeText}）`;
        } else {
            dropArea.textContent = '导入图片文件夹';
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
        
        // 清理拖拽状态
        if (this.isImageDragging) {
            this.endDragMode();
        }
        
        if (this.dragState) {
            this.cancelDragState();
        }
        
        // 清理全局事件监听器
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
