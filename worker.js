// worker.js - Web Worker for handling heavy operations
importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');

class WorkerUtils {
    static formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}-${String(date.getSeconds()).padStart(2, '0')}`;
    }

    static sortFiles(files, criteria) {
        if (criteria && typeof criteria === 'object' && Array.isArray(criteria.steps)) {
            return files.sort((a, b) => {
                for (const { field, desc } of criteria.steps) {
                    const va = a[field];
                    const vb = b[field];
                    let r;
                    if (typeof va === 'string' || typeof vb === 'string') {
                        r = String(va ?? '').localeCompare(String(vb ?? ''));
                    } else {
                        r = (va || 0) - (vb || 0);
                    }
                    if (r !== 0) return desc ? -r : r;
                }
                return 0;
            });
        }
        return files.sort((a, b) => {
            switch (criteria) {
                case 'nameAsc': return a.name.localeCompare(b.name);
                case 'nameDesc': return b.name.localeCompare(a.name);
                case 'dateAsc': return a.lastModified - b.lastModified;
                case 'dateDesc': return b.lastModified - a.lastModified;
                case 'sizeAsc': return a.size - b.size;
                case 'sizeDesc': return b.size - a.size;
                case 'typeAsc': return a.type.localeCompare(b.type);
                case 'typeDesc': return b.type.localeCompare(a.type);
                case 'widthAsc': return (a.width || 0) - (b.width || 0);
                case 'widthDesc': return (b.width || 0) - (a.width || 0);
                case 'heightAsc': return (a.height || 0) - (b.height || 0);
                case 'heightDesc': return (b.height || 0) - (a.height || 0);
                case 'aspectRatioAsc': return (a.aspectRatio || 0) - (b.aspectRatio || 0);
                case 'aspectRatioDesc': return (b.aspectRatio || 0) - (a.aspectRatio || 0);
                case 'resolutionAsc': return (a.resolution || 0) - (b.resolution || 0);
                case 'resolutionDesc': return (b.resolution || 0) - (a.resolution || 0);
                default: return 0;
            }
        });
    }

    static async getImageDimensions(file) {
        // Workers don't have `Image`, but they do have `createImageBitmap`.
        const bitmap = await createImageBitmap(file);
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
                try {
                    const dimensions = await WorkerUtils.getImageDimensions(file);
                    
                    const processedFile = {
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        lastModified: file.lastModified,
                        width: dimensions.width,
                        height: dimensions.height,
                        aspectRatio: dimensions.aspectRatio,
                        resolution: dimensions.resolution,
                        file: file // Keep reference to original file
                    };
                    
                    processedFiles.push(processedFile);
                } catch (error) {
                    console.error('Error processing file:', file.name, error);
                    // Still add file without dimensions
                    processedFiles.push({
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        lastModified: file.lastModified,
                        width: 0,
                        height: 0,
                        aspectRatio: 0,
                        resolution: 0,
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
            const { data, index } = imageDataArray[i];
            const fileName = `${(index + 1).toString().padStart(3, '0')}.${format}`;
            zip.file(fileName, data, { base64: true });
            
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
        switch (type) {
            case 'processFiles':
                const { files, sortOrder, isAppend, appendMode, existingFiles } = data;
                const processedFiles = await WorkerImageProcessor.processFileMetadata(files, sortOrder, isAppend, appendMode, existingFiles);
                self.postMessage({
                    type: 'filesProcessed',
                    data: processedFiles,
                    isAppend: isAppend
                });
                break;
                
            case 'createZip':
                const { imageDataArray, format } = data;
                const zipResult = await WorkerImageProcessor.createZipFile(imageDataArray, format);
                self.postMessage({
                    type: 'zipCreated',
                    data: zipResult
                });
                break;
                
            case 'sortFiles':
                const { filesToSort, order } = data;
                const sortedFiles = WorkerUtils.sortFiles(filesToSort, order);
                self.postMessage({
                    type: 'filesSorted',
                    data: sortedFiles
                });
                break;
                
            case 'test':
                self.postMessage({
                    type: 'test',
                    data: { message: 'Worker 响应正常' }
                });
                break;
                
            default:
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