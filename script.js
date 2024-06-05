document.addEventListener('DOMContentLoaded', () => {

    const UIElements = {
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
        capturePaddingXInput: document.getElementById('capturePaddingX'),
        capturePaddingYInput: document.getElementById('capturePaddingY'),
        bgColorInput: document.getElementById('bgColor'),
        photoWall: document.getElementById('photoWall'),
        fileThresholdInput: document.getElementById('fileThreshold'),
        progressContainer: document.getElementById('progressContainer'),
        progressBar: document.getElementById('progressBar'),
        progressText: document.getElementById('progressText')
    };

    setupDragAndDropListeners(UIElements);
    setupUIChangeListeners(UIElements);
    UIElements.captureButton.addEventListener('click', () => captureAndSaveImages(UIElements));

    function setupDragAndDropListeners({ dropArea, fileInput }) {
        dropArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', event => handleFiles(event.target.files, UIElements));
    }

    function setupUIChangeListeners(elementsObj) {
        Object.values(elementsObj).forEach(element => {
            if (element && element instanceof HTMLElement) {
                if (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
                    element.addEventListener('change', () => updateLayout(elementsObj));
                }
            }
        });

    }

    function updateLayout(UIElements) {
        const { photoWall, columnsInput, rowsInput, rowGapInput, capturePaddingXInput, capturePaddingYInput, columnGapInput, maxWidthInput, paddingXInput, paddingYInput, bgColorInput } = UIElements;
        photoWall.style.padding = `${paddingYInput.value}px ${paddingXInput.value}px`;
        photoWall.style.gridTemplateColumns = `repeat(${columnsInput.value}, 1fr)`;
        photoWall.style.gridRowGap = `${rowGapInput.value}px`;
        photoWall.style.gridColumnGap = `${columnGapInput.value}px`;
        photoWall.style.maxWidth = `${maxWidthInput.value}px`;
        photoWall.style.backgroundColor = bgColorInput.value;
        
        document.querySelectorAll('.photo').forEach(photo => {
            photo.style.padding = `${capturePaddingYInput.value}px ${capturePaddingXInput.value}px`;
        });

        const photoCount = photoWall.children.length;
        const photosPerCapture = parseInt(rowsInput.value) * parseInt(columnsInput.value);
        const totalScreenshots = Math.ceil(photoCount/photosPerCapture);
        progressText.innerText = `文件夹包含${photoCount}个图片，预计生成${totalScreenshots}张截图`; 

    }

    async function handleFiles(files, UIElements) {
        const { photoWall, sortOrder, progressContainer, progressBar, progressText, captureButton } = UIElements
        photoWall.innerHTML = '';
        photoWallContainer.style.display = 'none';

        let fileArray = Array.from(files);
        
        progressContainer.style.display = 'block';
        progressText.innerText = "正在对文件排序...";
        
        fileArray = sortFiles(fileArray, sortOrder.value);
        
        progressBar.style.width = `1%`;
        progressText.innerText = `正在导入图片...`;
        
        updateLayout(UIElements);
        
        for (let index = 0; index < fileArray.length; index++) {
            const file = fileArray[index];
            if (file.type.startsWith('image/')) {
                await loadImage(file, photoWall);
                let loadedPercentage = ((index + 1) / fileArray.length) * 100;
                progressBar.style.width = `${loadedPercentage}%`;
                progressText.innerText = `正在导入图片... ${Math.round(loadedPercentage)}%`;
            }
        }

        progressText.innerText = "导入完成";
        updateLayout(UIElements);

        if (photoWall.children.length > 0) {
            photoWallContainer.style.display = 'flex';
            captureButton.style.display = 'block';
        }
    }

    function sortFiles(files, order) {
        return files.sort((a, b) => {
            switch (order) {
                case 'nameAsc':
                    return a.name.localeCompare(b.name);
                case 'nameDesc':
                    return b.name.localeCompare(a.name);
                case 'dateAsc':
                    return a.lastModified - b.lastModified;
                case 'dateDesc':
                    return b.lastModified - a.lastModified;
                case 'sizeAsc':
                    return a.size - b.size;
                case 'sizeDesc':
                    return b.size - a.size;
                case 'typeAsc':
                    return a.type.localeCompare(b.type);
                case 'typeDesc':
                    return b.type.localeCompare(a.type);
                default:
                    return 0;
            }
        });
    }

    function loadImage(file, photoWall) {
        return new Promise((resolve) => {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            img.setAttribute('alt', file.name);
            img.setAttribute('title', file.name);
            img.setAttribute('name', file.name);
            img.setAttribute('size', file.size);
            img.setAttribute('type', file.type);
            img.setAttribute('lastModified', new Date(file.lastModified).toLocaleString());
            img.onload = () => {
                img.className = 'photo';
                photoWall.appendChild(img);
                resolve();
            };
        });
    }

    async function captureAndSaveImages(UIElements) {
        const { photoWall, rowsInput, columnsInput, fileThresholdInput, progressBar, progressContainer, progressText } = UIElements;
        const photos = Array.from(photoWall.children);
        const rows = parseInt(rowsInput.value);
        const columns = parseInt(columnsInput.value);
        const imagesPerCapture = rows * columns;
        const fileThreshold = parseInt(fileThresholdInput.value);
    
        captureButton.style.display = 'none';
        progressContainer.style.display = 'block';
        progressText.innerText = "正在截图...";
    
        const now = new Date();
        const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    
        if (photos.length <= fileThreshold) {
            for (let i = 0; i < photos.length; i += imagesPerCapture) {
                const fileName = `${(i / imagesPerCapture + 1).toString().padStart(3, '0')}.png`
                await captureAndSaveImage(photos, i, imagesPerCapture, fileName, UIElements);
                let capturePercentage = ((i + imagesPerCapture) / photos.length) * 100;
                progressBar.style.width = `${capturePercentage}%`;
                progressText.innerText = `正在截图... ${Math.round(capturePercentage)}%`;
            }
            progressText.innerText = "截图完成";

        } else {
            const zip = new JSZip();
            for (let i = 0; i < photos.length; i += imagesPerCapture) {
                const fileName = `${(i / imagesPerCapture + 1).toString().padStart(3, '0')}.png`
                const imgData = await captureAndSaveImage(photos, i, imagesPerCapture, null, UIElements);
                zip.file(fileName, imgData, {base64: true});
                let zipPercentage = Math.min((i + imagesPerCapture) / photos.length, 1) * 100;
                progressBar.style.width = `${zipPercentage}%`;
                progressText.innerText = `正在打包... ${Math.round(zipPercentage)}%`;
            }
            progressText.innerText = "正在后台下载...\n此过程需要更多的时间，请耐心等待。";

            await zip.generateAsync({type: "blob"})
                .then(content => {
                    saveAs(content, `Screenshots_${formattedDate}.zip`);
                    progressText.innerText = "完成";
                    captureButton.style.display = 'block';
                    setTimeout(() => { progressText.innerText = `请查收 Screenshots_${formattedDate}.zip`; }, 1200);
                });
        }
   
        setTimeout(() => { progressContainer.style.display = 'none'; }, 20000);
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
        tempDiv.style.boxSizing = 'border-box';
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
            saveAs(dataUrl, filename);
        }
        return dataUrl.split(',')[1];
    }

});
