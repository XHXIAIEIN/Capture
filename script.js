document.addEventListener('DOMContentLoaded', () => {
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');
    const photoWall = document.getElementById('photoWall');
    const photoWallContainer = document.getElementById('photoWallContainer');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const linksContainer = document.getElementById('linksContainer');

    const UIElements = {
        captureButton: document.getElementById('captureButton'),
        sortOrder: document.getElementById('sortOrder'),
        maxWidthInput: document.getElementById('maxWidth'),
        columnsInput: document.getElementById('columns'),
        rowsInput: document.getElementById('rows'),
        columnGapInput: document.getElementById('columnGap'),
        rowGapInput: document.getElementById('rowGap'),
        paddingXInput: document.getElementById('paddingX'),
        paddingYInput: document.getElementById('paddingY'),
        capturePaddingXInput: document.getElementById('capturePaddingX'),
        capturePaddingYInput: document.getElementById('capturePaddingY'),
        bgColorInput: document.getElementById('bgColor'),
        fileThresholdInput: document.getElementById('fileThreshold'),
    };

    let currentFiles = [];
    let imagesPerCapture = 1
    let totalScreenshots = 1

    setupListeners(UIElements);

    function setupListeners(UIElements) {
        UIElements.captureButton.addEventListener('click', () => captureAndSaveImages(UIElements));
        UIElements.sortOrder.addEventListener('change', () => handleSort(currentFiles, UIElements));
        dropArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', event => {
            currentFiles = Array.from(event.target.files);
            handleFiles(currentFiles, UIElements);
        });

        Object.values(UIElements).forEach(element => {
            if (element && ['INPUT', 'SELECT'].includes(element.tagName)) {
                element.addEventListener('change', () => updateLayout(UIElements));
            }
        });
    }

    function updateLayout(UIElements) {
        const { paddingXInput, paddingYInput, columnsInput, rowGapInput, columnGapInput, maxWidthInput, bgColorInput, capturePaddingYInput, capturePaddingXInput } = UIElements;
        photoWall.style.padding = `${paddingYInput.value}px ${paddingXInput.value}px`;
        photoWall.style.gridTemplateColumns = `repeat(${columnsInput.value}, 1fr)`;
        photoWall.style.gridGap = `${rowGapInput.value}px ${columnGapInput.value}px`;
        photoWall.style.maxWidth = `${maxWidthInput.value}px`;
        photoWall.style.backgroundColor = bgColorInput.value;
        const photoCount = photoWall.children.length;
        if (photoCount > 0) {
            document.querySelectorAll('.photo').forEach(photo => {
                photo.style.padding = `${capturePaddingYInput.value}px ${capturePaddingXInput.value}px`;
            });
            imagesPerCapture = parseInt(rowsInput.value) * parseInt(columnsInput.value);
            totalScreenshots = Math.ceil(photoCount / imagesPerCapture);
            progressText.innerText = `文件夹包含${photoCount}个图片，预计生成${totalScreenshots}张截图`;
        }

    }

    function handleFiles(files, UIElements) {
        if (files.length <= 0) return;
        photoWall.innerHTML = '';
        photoWallContainer.style.display = 'none';
        progressContainer.style.display = 'block';
        progressText.innerText = "正在对文件排序...";
        updateLayout(UIElements)
        handleSort(files, UIElements);
    }

    function handleSort(files, UIElements) {
        photoWall.innerHTML = '';
        const sortedFiles = sortFiles(files, UIElements.sortOrder.value);
        progressBar.style.width = `1%`;
        progressText.innerText = `正在导入图片...`;
        loadImages(sortedFiles, UIElements);
    }

    function sortFiles(files, order) {
        const pinyin = new Intl.Collator("zh", { collation: "pinyin", usage: "search", caseFirst: "upper", numeric: true, sensitivity: "base" });
        return files.sort((a, b) => {
            switch (order) {
                case 'nameAsc': return pinyin.compare(a.name, b.name);
                case 'nameDesc': return pinyin.compare(b.name, a.name);
                case 'dateAsc': return a.lastModified - b.lastModified;
                case 'dateDesc': return b.lastModified - a.lastModified;
                case 'sizeAsc': return a.size - b.size;
                case 'sizeDesc': return b.size - a.size;
                case 'typeAsc': return a.type.localeCompare(b.type);
                case 'typeDesc': return b.type.localeCompare(a.type);
                default: return 0;
            }
        });
    }

    async function loadImages(files, UIElements) {
        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            if (file.type.startsWith('image/')) {
                await loadImage(file, photoWall);
                let loadedPercentage = ((index + 1) / files.length) * 100;
                progressBar.style.width = `${loadedPercentage}%`;
                progressText.innerText = `正在导入图片... ${Math.round(loadedPercentage)}%`;
            }
        }
        progressText.innerText = "导入完成。";
        if (photoWall.children.length > 0) {
            photoWallContainer.style.display = 'flex';
            photoWallContainer.style.minHeight = photoWall.style.height;
            UIElements.captureButton.style.display = 'block';
        }
        updateLayout(UIElements)
    }

    function loadImage(file, photoWall) {
        return new Promise((resolve, reject) => {
            if (!(photoWall instanceof HTMLElement)) {
                reject(new Error('照片墙尚不存在'));
                return;
            }
            
            if (!file.type.startsWith('image/')) {
                reject(new Error('此文件不是有效的图像文件'));
                return;
            }
    
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.className = 'photo';
                    photoWall.appendChild(img);
                    resolve();
                } catch (error) {
                    reject(new Error('图片无法添加到照片墙'));
                }
            };
            reader.onerror = () => {
                reject(new Error('无法读取图片'));
            };
            reader.readAsDataURL(file);
        });
    }

    async function captureAndSaveImages(UIElements) {
        const { fileThresholdInput, captureButton} = UIElements;
        const fileThreshold = parseInt(fileThresholdInput.value);
        
        captureButton.style.display = 'none';
        progressContainer.style.display = 'block';
        progressText.innerText = "正在截图...";
        updateLayout(UIElements)
        
        const photos = Array.from(photoWall.children);
    
        const processBatch = async (batchStart) => {
            const batchEnd = Math.min(batchStart + imagesPerCapture, photos.length);
            const zip = new JSZip();
            for (let i = batchStart; i < batchEnd; i++) {
                const fileName = `Screenshot_${(Math.floor(i / imagesPerCapture) + 1).toString().padStart(3, '0')}.png`;
                try {
                    const imgData = await captureAndSaveImage(photos[i], UIElements, fileName);
                    if (totalScreenshots <= fileThreshold) {
                        addDownloadLink(linksContainer, imgData, fileName);
                    } else {
                        zip.file(fileName, imgData, {base64: true});
                    }
                } catch (error) {
                    console.error("Error capturing image:", error);
                }
            }
            updateProgressBar(progressBar, progressText, batchEnd, photos.length, 1);
            if (batchEnd < photos.length) {
                setTimeout(() => processBatch(batchEnd), 100);
            } else {
                if (totalScreenshots > fileThreshold) {
                    const content = await zip.generateAsync({type: "blob"});
                    saveAs(content, `Screenshots_${new Date().toISOString()}.zip`);
                    progressText.innerText = "截图已打包下载";
                } else {
                    progressText.innerText = "截图完成";
                }
                progressContainer.style.display = 'none';
                captureButton.style.display = 'block';
            }
        };
    
        processBatch(0);
    }

    function updateProgressBar(progressBar, progressText, index, total, batch) {
        let percentage = ((index + batch) / total) * 100;
        progressBar.style.width = `${percentage}%`;
        progressText.innerText = `正在截图... ${Math.round(percentage)}%`;
    }

    async function captureAndSaveImage(photos, startIndex, count, filename, UIElements) {
        const { columnsInput, rowGapInput, capturePaddingXInput, capturePaddingYInput, columnGapInput, maxWidthInput, paddingXInput, paddingYInput, bgColorInput } = UIElements;
        const currentPhotos = photos.slice(startIndex, startIndex + count);
        const fragment = document.createDocumentFragment();

        currentPhotos.forEach(photo => {
            const clone = photo.cloneNode(true);
            clone.style.padding = `${capturePaddingYInput.value}px ${capturePaddingXInput.value}px`;
            clone.style.justifyItems = 'center';
            clone.style.alignItems = 'center';
            fragment.appendChild(clone);
        });

        const tempDiv = document.createElement('div');
        tempDiv.className = 'tempDiv';
        tempDiv.style.backgroundColor = bgColorInput.value;
        tempDiv.style.display = 'grid';
        tempDiv.style.gridTemplateColumns = `repeat(${columnsInput.value}, 1fr)`;
        tempDiv.style.gap = `${rowGapInput.value}px ${columnGapInput.value}px`;
        tempDiv.style.padding = `${paddingYInput.value}px ${paddingXInput.value}px`;
        tempDiv.style.width = `${maxWidthInput.value}px`;
        tempDiv.appendChild(fragment);
        document.body.appendChild(tempDiv);

        const canvas = await html2canvas(tempDiv, {backgroundColor: null});
        document.body.removeChild(tempDiv);
        const dataUrl = canvas.toDataURL('image/png');
        if (filename) {
            const linkElement = document.createElement('a');
            linkElement.href = dataUrl;
            linkElement.download = filename;
            document.body.appendChild(linkElement);
            linkElement.click();
            document.body.removeChild(linkElement);
        }
        return dataUrl.split(',')[1];
    }

    function addDownloadLink(container, imgData, fileName) {
        const link = document.createElement('a');
        link.href = `data:image/png;base64,${imgData}`;
        link.download = fileName;
        link.innerText = `${fileName}`;
        link.style.display = 'block';
        container.appendChild(link);
    }

});