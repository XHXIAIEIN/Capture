// worker.js - Web Worker for handling heavy operations
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

const NATURAL = { numeric: true };
function natCmp(a, b) {
    return String(a ?? '').localeCompare(String(b ?? ''), undefined, NATURAL);
}
function numCmp(a, b) {
    return (a || 0) - (b || 0);
}

class WorkerUtils {
    static formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`;
    }

    static deriveFilenameParts(filename) {
        const s = String(filename ?? '');
        const i = s.lastIndexOf('.');
        if (i <= 0) return { ext: '', basename: s };
        return { ext: s.slice(i + 1).toLowerCase(), basename: s.slice(0, i) };
    }

    static deriveOrientation(width, height) {
        if (width > height) return 1;
        if (width < height) return -1;
        return 0;
    }

    static sortFiles(files, criteria) {
        if (criteria && typeof criteria === 'object' && Array.isArray(criteria.steps)) {
            if (criteria.steps.some((s) => s.field === 'random')) {
                for (const item of files) item._rand = Math.random();
            }
            return files.sort((a, b) => {
                for (const { field, desc } of criteria.steps) {
                    let r;
                    if (field === 'random') {
                        r = numCmp(a._rand, b._rand);
                    } else {
                        const va = a[field];
                        const vb = b[field];
                        if (typeof va === 'string' || typeof vb === 'string') {
                            r = natCmp(va, vb);
                        } else {
                            r = numCmp(va, vb);
                        }
                    }
                    if (r !== 0) return desc ? -r : r;
                }
                return 0;
            });
        }
        return files.sort((a, b) => {
            switch (criteria) {
                case 'nameAsc': return natCmp(a.basename ?? a.name, b.basename ?? b.name);
                case 'nameDesc': return natCmp(b.basename ?? b.name, a.basename ?? a.name);
                case 'dateAsc': return numCmp(a.lastModified, b.lastModified);
                case 'dateDesc': return numCmp(b.lastModified, a.lastModified);
                case 'sizeAsc': return numCmp(a.size, b.size);
                case 'sizeDesc': return numCmp(b.size, a.size);
                case 'extAsc': return natCmp(a.ext, b.ext);
                case 'extDesc': return natCmp(b.ext, a.ext);
                case 'widthAsc': return numCmp(a.width, b.width);
                case 'widthDesc': return numCmp(b.width, a.width);
                case 'heightAsc': return numCmp(a.height, b.height);
                case 'heightDesc': return numCmp(b.height, a.height);
                case 'aspectRatioAsc': return numCmp(a.aspectRatio, b.aspectRatio);
                case 'aspectRatioDesc': return numCmp(b.aspectRatio, a.aspectRatio);
                case 'resolutionAsc': return numCmp(a.resolution, b.resolution);
                case 'resolutionDesc': return numCmp(b.resolution, a.resolution);
                default: return 0;
            }
        });
    }

    static async getImageDimensions(file) {
        // Workers don't have `Image`, but they do have `createImageBitmap`.
        // Apply EXIF orientation so width/height match the displayed dimensions
        // (iOS/Android photos are stored with raw landscape pixels + a rotate tag).
        let bitmap;
        try {
            bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch {
            bitmap = await createImageBitmap(file);
        }
        try {
            const width = bitmap.width;
            const height = bitmap.height;
            return {
                width,
                height,
                aspectRatio: parseFloat((width / height).toFixed(2)),
                resolution: width * height,
            };
        } finally {
            bitmap.close?.();
        }
    }
}

class WorkerImageProcessor {
    static async processFileMetadata(files, sortOrder, isAppend = false, appendMode = 'sort', existingFiles = []) {
        const processedFiles = [];
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            if (file.type.startsWith('image/')) {
                const { ext, basename } = WorkerUtils.deriveFilenameParts(file.name);
                try {
                    const dimensions = await WorkerUtils.getImageDimensions(file);
                    const orientation = WorkerUtils.deriveOrientation(dimensions.width, dimensions.height);

                    processedFiles.push({
                        name: file.name,
                        basename,
                        ext,
                        size: file.size,
                        type: file.type,
                        lastModified: file.lastModified,
                        width: dimensions.width,
                        height: dimensions.height,
                        aspectRatio: dimensions.aspectRatio,
                        resolution: dimensions.resolution,
                        orientation,
                        file: file
                    });
                } catch (error) {
                    console.error('Error processing file:', file.name, error);
                    processedFiles.push({
                        name: file.name,
                        basename,
                        ext,
                        size: file.size,
                        type: file.type,
                        lastModified: file.lastModified,
                        width: 0,
                        height: 0,
                        aspectRatio: 0,
                        resolution: 0,
                        orientation: 0,
                        file: file
                    });
                }
            }
            
            // Send progress update
            self.postMessage({
                type: 'progress',
                phase: 'metadata',
                current: i + 1,
                total: files.length,
                percentage: Math.round(((i + 1) / files.length) * 100)
            });
        }
        
        let finalFiles;
        
        // 根据添加模式处理文件
        if (isAppend && existingFiles.length > 0) {
            if (appendMode === 'append') {
                // 添加到末尾：先排序新文件，然后追加到现有文件后面
                const sortedNewFiles = WorkerUtils.sortFiles(processedFiles, sortOrder);
                finalFiles = [...existingFiles, ...sortedNewFiles];
            } else {
                // 按当前排序插入：合并所有文件后重新排序
                const allFiles = [...existingFiles, ...processedFiles];
                finalFiles = WorkerUtils.sortFiles(allFiles, sortOrder);
            }
        } else {
            // 首次导入，直接排序
            finalFiles = WorkerUtils.sortFiles(processedFiles, sortOrder);
        }
        
        return finalFiles;
    }

    static async createZipFile(imageDataArray, format) {
        const zip = new JSZip();
        const formattedDate = WorkerUtils.formatDate(new Date());
        
        // Add images to zip
        for (let i = 0; i < imageDataArray.length; i++) {
            const { data, fileName, index } = imageDataArray[i];
            const name = fileName ?? `${(index + 1).toString().padStart(3, '0')}.${format}`;
            zip.file(name, data, { base64: true });
            
            // Send progress update
            self.postMessage({
                type: 'progress',
                phase: 'zip_add',
                current: i + 1,
                total: imageDataArray.length,
                percentage: Math.round(((i + 1) / imageDataArray.length) * 100)
            });
        }
        
        // Generate zip file with progress callback
        const content = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 }
        }, (metadata) => {
            const percentage = Math.min(Math.round(metadata.percent), 100);
            self.postMessage({
                type: 'progress',
                phase: 'zip_generate',
                percentage: percentage
            });
        });
        
        return {
            content,
            fileName: `Screenshots_${formattedDate}.zip`
        };
    }
}

// Message handler
self.onmessage = async function(e) {
    const { type, data } = e.data;

    try {
        if (type === 'processFiles') {
            const { files, sortOrder, isAppend, appendMode, existingFiles } = data;
            const processedFiles = await WorkerImageProcessor.processFileMetadata(files, sortOrder, isAppend, appendMode, existingFiles);
            self.postMessage({ type: 'filesProcessed', data: processedFiles, isAppend });
        } else if (type === 'createZip') {
            const { imageDataArray, format } = data;
            const zipResult = await WorkerImageProcessor.createZipFile(imageDataArray, format);
            self.postMessage({ type: 'zipCreated', data: zipResult });
        } else if (type === 'sortFiles') {
            const { filesToSort, order } = data;
            const sortedFiles = WorkerUtils.sortFiles(filesToSort, order);
            self.postMessage({ type: 'filesSorted', data: sortedFiles });
        } else if (type === 'test') {
            self.postMessage({ type: 'test', data: { message: 'Worker 响应正常' } });
        } else {
            console.warn('Unknown message type:', type);
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message,
            phase: type
        });
    }
};
