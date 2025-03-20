// 常量定义
const CONSTANTS = {
    DEFAULT_QUALITY: 0.8,
    ZIP_COMPRESSION_LEVEL: 9,
    PROGRESS_UPDATE_INTERVAL: 100
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

    async processImages(photos, imagesPerCapture, addToZip, format, quality, zip = null) {
        const { progressText, linksContainer } = this.UI;
        
        try {
            for (let i = 0; i < photos.length; i += imagesPerCapture) {
                const fileName = `${(i / imagesPerCapture + 1).toString().padStart(3, '0')}.${format}`;
                const imgData = await this.captureAndSaveImage(photos.slice(i, i + imagesPerCapture), addToZip ? null : fileName, format, quality);
                
                if (addToZip) {
                    zip.file(fileName, imgData, { base64: true });
                } else {
                    linksContainer.appendChild(Utils.createDownloadLink(imgData, fileName));
                }
                
                this.updateProgress(progressText, (i + imagesPerCapture) / photos.length, '正在截图...');
            }
        } catch (error) {
            console.error('处理图片时出错:', error);
            throw error;
        }
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

    updateProgress(textElement, percentage, text) {
        textElement.innerText = `${text} ${Math.round(Math.min(percentage, 1) * 100)}%`;
    }
}

// UI管理类
class UIManager {
    constructor() {
        this.UI = this.initializeUI();
        this.imageProcessor = new ImageProcessor(this.UI);
        this.setupEventListeners();
        this.isGenerating = false;
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
            fileThresholdInput: document.getElementById('fileThreshold'),
            progressContainer: document.getElementById('progressContainer'),
            progressText: document.getElementById('progressText'),
            photoWallContainer: document.getElementById('photoWallContainer'),
            linksContainer: document.getElementById('linksContainer'),
            progressBar: document.getElementById('progressBar'),
            imageBorderRadiusInput: document.getElementById('imageBorderRadius'),
            pageBorderRadiusInput: document.getElementById('pageBorderRadius'),
            imageFormat: document.getElementById('imageFormat'),
            imageQuality: document.getElementById('imageQuality'),
            imageAlignment: document.getElementById('imageAlignment')
        };
    }

    setupEventListeners() {
        const { dropArea, fileInput, captureButton, sortOrder } = this.UI;
        
        dropArea.addEventListener('click', () => fileInput.click());
        dropArea.addEventListener('dragover', event => {
            event.preventDefault();
            dropArea.classList.add('hover');
        });
        dropArea.addEventListener('drop', event => {
            event.preventDefault();
            dropArea.classList.remove('hover');
            this.handleFiles(event.dataTransfer.files);
        });
        dropArea.addEventListener('dragleave', () => dropArea.classList.remove('hover'));
        fileInput.addEventListener('change', event => this.handleFiles(event.target.files));
        captureButton.addEventListener('click', () => this.captureAndSaveImages());
        sortOrder.addEventListener('change', () => this.handleSort());

        Object.values(this.UI).forEach(element => {
            if (element && ['INPUT', 'SELECT'].includes(element.tagName)) {
                element.addEventListener('change', () => this.updateLayout());
            }
        });
    }

    async handleFiles(files) {
        const { photoWall, sortOrder, progressContainer, progressText, captureButton, photoWallContainer } = this.UI;

        photoWall.innerHTML = '';
        photoWallContainer.style.display = 'none';
        progressContainer.style.display = 'block';

        let fileArray = Array.from(files);
        this.showProgress(progressContainer, progressText, '正在对文件排序...', true);

        fileArray = this.sortFiles(fileArray, sortOrder.value);

        this.showProgress(progressContainer, progressText, '正在导入图片...', true);

        for (let index = 0; index < fileArray.length; index++) {
            const file = fileArray[index];
            if (file.type.startsWith('image/')) {
                await this.loadImage(file, photoWall);
                this.updateProgress(progressText, (index + 1) / fileArray.length, '正在导入图片...');
            }
        }

        this.showProgress(progressContainer, progressText, '导入完成', false);
        this.updateLayout();

        if (photoWall.children.length > 0) {
            photoWallContainer.style.display = 'flex';
            captureButton.style.display = 'block';
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

            photoWall.appendChild(imgContainer);
        } catch (error) {
            console.error('加载图片时出错:', error);
            throw error;
        }
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
        const { fileInput, photoWall } = this.UI;
        const files = Array.from(fileInput.files);
        if (files.length > 0) {
            this.handleFiles(files);
        } else {
            const images = Array.from(photoWall.children);
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
            })), this.UI.sortOrder.value);
    
            photoWall.innerHTML = '';
            sortedImages.forEach(file => photoWall.appendChild(file.element));
            this.updateLayout();
        }
    }

    async captureAndSaveImages() {
        if (this.isGenerating) return;
        
        const { photoWall, rowsInput, columnsInput, fileThresholdInput, progressContainer, progressText, progressBar, captureButton, linksContainer, imageFormat, imageQuality } = this.UI;
        const photos = Array.from(photoWall.children);
        const imagesPerCapture = parseInt(rowsInput.value) * parseInt(columnsInput.value);
        const fileThreshold = parseInt(fileThresholdInput.value);
        const totalScreenshots = Math.ceil(photos.length / imagesPerCapture);
        const format = imageFormat.value;
        const quality = parseInt(imageQuality.value) / 100;
    
        try {
            this.isGenerating = true;
            captureButton.style.display = 'none';
            this.showProgress(progressContainer, progressText, '正在截图...', true);
        
            const formattedDate = Utils.formatDate(new Date());
            linksContainer.innerHTML = '';
        
            if (totalScreenshots <= fileThreshold) {
                await this.processImages(photos, imagesPerCapture, false, format, quality);
                this.showProgress(progressContainer, progressText, '截图完成', false);
            } else {
                const zip = new JSZip();
                await this.processImages(photos, imagesPerCapture, true, format, quality, zip);
                this.showProgress(progressContainer, progressText, '正在打包...\n此过程需要更多的时间，请耐心等待。', false);
                await zip.generateAsync({
                    type: 'blob',
                    compression: 'DEFLATE',
                    compressionOptions: { level: CONSTANTS.ZIP_COMPRESSION_LEVEL },
                    onUpdate: (metadata) => {
                        const percentage = Math.min(Math.round(metadata.percent), 100);
                        progressBar.style.width = `${percentage}%`;
                        progressText.innerText = `正在打包... ${percentage}%`;
                    }
                }).then(content => {
                    saveAs(content, `Screenshots_${formattedDate}.zip`);
                    this.showProgress(progressContainer, progressText, '完成', false);
                });
            }
        } catch (error) {
            console.error('生成截图时出错:', error);
            this.showProgress(progressContainer, progressText, '生成失败，请重试', false);
        } finally {
            this.isGenerating = false;
            this.resetUIState();
        }
    }
    
    async processImages(photos, imagesPerCapture, addToZip, format, quality) {
        await this.imageProcessor.processImages(photos, imagesPerCapture, addToZip, format, quality);
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
            return
        }1

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
        progressText.innerText = `文件夹包含${photoCount}个图片，预计生成${totalScreenshots}张截图`;
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

    resetUIState() {
        const { captureButton, progressContainer, progressBar } = this.UI;
        
        if (progressBar) {
            progressBar.style.width = '0%';
        }
        
        if (captureButton) {
            captureButton.style.display = 'block';
        }
        
        if (progressContainer) {
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 2000);
        }
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new UIManager();
});
