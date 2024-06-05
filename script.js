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

    function setupUIChangeListeners({ maxWidthInput, columnsInput, rowsInput, columnGapInput, rowGapInput, paddingXInput, paddingYInput, bgColorInput }) {
        [maxWidthInput, columnsInput, rowsInput, columnGapInput, rowGapInput, paddingXInput, paddingYInput, bgColorInput].forEach(input => {
            if (input) {
                input.addEventListener('change', () => updateLayout(UIElements));
            }
        });
    }

    function updateLayout({ photoWall, columnsInput, rowGapInput, columnGapInput, maxWidthInput, paddingXInput, paddingYInput, bgColorInput }) {
        photoWall.style.padding = `${paddingYInput.value}px ${paddingXInput.value}px`;
        photoWall.style.gridTemplateColumns = `repeat(${columnsInput.value}, 1fr)`;
        photoWall.style.gridRowGap = `${rowGapInput.value}px`;
        photoWall.style.gridColumnGap = `${columnGapInput.value}px`;
        photoWall.style.maxWidth = `${maxWidthInput.value}px`;
        photoWall.style.backgroundColor = bgColorInput.value;
    }

    async function handleFiles(files, { photoWall, sortOrder, progressContainer, progressBar, progressText, captureButton }) {
        photoWall.innerHTML = '';
        photoWallContainer.style.display = 'none';

        let fileArray = Array.from(files);
        
        progressContainer.style.display = 'block';
        progressText.innerText = "正在对文件排序...";
        
        fileArray = sortFiles(fileArray, sortOrder.value);
        
        progressBar.style.width = `1%`;
        progressText.innerText = `正在加载图片...`;
        
        updateLayout(UIElements);
        
        for (let index = 0; index < fileArray.length; index++) {
            const file = fileArray[index];
            if (file.type.startsWith('image/')) {
                await loadImage(file, photoWall);
                let loadedPercentage = ((index + 1) / fileArray.length) * 100;
                progressBar.style.width = `${loadedPercentage}%`;
                progressText.innerText = `正在加载图片... ${Math.round(loadedPercentage)}%`;
            }
        }

        progressText.innerText = "导入完成";

        setTimeout(() => { progressContainer.style.display = 'none'; }, 500);

        if (photoWall.children.length > 0) {
            photoWallContainer.style.display = 'flex';
            captureButton.style.display = 'block';
        }
    }

    function sortFiles(files, order) {
        return files.sort((a, b) => {
            switch (order) {
                case 'nameAsc':
                    return fileNameCompare(a.name, b.name);
                case 'nameDesc':
                    return fileNameCompare(b.name, a.name);
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

    function fileNameCompare(a, b) {
        if (a == null || b == null) return 0;
        let na = a.split(/[-_.—, (]/);
        let nb = b.split(/[-_.—, (]/);
        let maxLoop = Math.max(na.length, nb.length);
        for (let i = 0; i < maxLoop; i++) {
            if (!isNaN(Number(na[i])) && !isNaN(Number(nb[i]))) {
                let num = Number(na[i]) - Number(nb[i]);
                if (num !== 0) {
                    return num;
                }
            }
        }
        let ma = a.match(/[0-9]+/);
        let mb = b.match(/[0-9]+/);
        if (ma && mb && ma.length && mb.length) {
            let num = Number(ma[0]) - Number(mb[0]);
            if (num !== 0) {
                return num;
            }
        }
        return a.localeCompare(b);
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
    
        progressContainer.style.display = 'block';
        progressText.innerText = "正在截图...";
    
        const now = new Date();
        const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    
        if (photos.length <= fileThreshold) {
            for (let i = 0; i < photos.length; i += imagesPerCapture) {
                await captureAndSaveImage(photos, i, imagesPerCapture, `${(i / imagesPerCapture + 1).toString().padStart(3, '0')}.png`, UIElements);
                let capturePercentage = ((i + imagesPerCapture) / photos.length) * 100;
                progressBar.style.width = `${capturePercentage}%`;
                progressText.innerText = `正在截图... ${Math.round(capturePercentage)}%`;
            }
            progressText.innerText = "截图完成";
        } else {
            const zip = new JSZip();
            for (let i = 0; i < photos.length; i += imagesPerCapture) {
                const imgData = await captureAndSaveImage(photos, i, imagesPerCapture, null, UIElements);
                zip.file(`${(i / imagesPerCapture + 1).toString().padStart(3, '0')}.png`, imgData, {base64: true});
                let zipPercentage = Math.min((i + imagesPerCapture) / photos.length, 1) * 100;
                progressBar.style.width = `${zipPercentage}%`;
                progressText.innerText = `正在打包... ${Math.round(zipPercentage)}%`;
            }
            await zip.generateAsync({type: "blob"})
                .then(content => {
                    saveAs(content, `Screenshots_${formattedDate}.zip`);
                    progressText.innerText = "完成";
                });
        }
        setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);
    }
    
    async function captureAndSaveImage(photos, startIndex, count, filename, UIElements) {
        const { columnsInput, rowGapInput, columnGapInput, maxWidthInput, paddingXInput, paddingYInput, bgColorInput } = UIElements;
        const currentPhotos = photos.slice(startIndex, startIndex + count);
        const fragment = document.createDocumentFragment();
        currentPhotos.forEach(photo => {
            const clone = photo.cloneNode(true);
            clone.style.padding = `${paddingYInput.value}px ${paddingXInput.value}px`;
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
            saveAs(dataUrl, filename);
        }
        return dataUrl.split(',')[1];
    }

});
