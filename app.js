// ── CONFIGURATION & CONSTANTS ──
const Config = {
    SIGNATURE: "CRYPTEX",
    ENCODER: new TextEncoder(),
    DECODER: new TextDecoder(),
    GZIP_MAGIC: [0x1f, 0x8b]
};

// ── APPLICATION STATE ──
const State = {
    extractedImages: [],
    previewGallery:[],
    currentPreviewIndex: 0,
    touchStartX: 0,
    touchStartY: 0
};

// track object URLs to avoid memory leaks
State.currentDownloadUrl = null;
State.generatedPreviewUrls = [];

// ── UTILITIES ──
const Utils = {
    formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes =['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    // Memoized CRC32 Table
    crc32(bytes) {
        if (!this.crcTable) {
            this.crcTable = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) {
                    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
                }
                this.crcTable[n] = c;
            }
        }
        let crc = 0 ^ -1;
        for (let i = 0; i < bytes.length; i++) {
            crc = (crc >>> 8) ^ this.crcTable[(crc ^ bytes[i]) & 0xff];
        }
        return (crc ^ -1) >>> 0;
    },

    generateRandomString(length) {
        const letters = 'abcdefghijklmnopqrstuvwxyz';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        return result;
    },

    /**
     * Converts any image blob to a PNG blob using the Canvas API
    **/
    async convertToPng(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(img.src);
                canvas.toBlob(pngBlob => resolve(pngBlob), 'image/png');
            };
            img.onerror = () => reject(new Error('Failed to convert image to PNG.'));
            img.src = URL.createObjectURL(blob);
        });
    },

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

// ── STEGANOGRAPHY ENGINE ──
const StegoEngine = {
    createPngChunk(type, dataBuffer) {
        const typeBytes = Config.ENCODER.encode(type);
        const data = new Uint8Array(dataBuffer);
        const len = data.length;
        const buf = new Uint8Array(8 + len + 4);
        const view = new DataView(buf.buffer);
        
        view.setUint32(0, len);
        buf.set(typeBytes, 4);
        buf.set(data, 8);
        
        const crc = Utils.crc32(buf.subarray(4, 8 + len));
        view.setUint32(8 + len, crc);
        
        return buf;
    },

    async insertPngChunk(pngBlob, type, payloadBuffer) {
        const arr = new Uint8Array(await pngBlob.arrayBuffer());
        let offset = 8; // Skip PNG magic signature

        while (offset < arr.length) {
            const len = new DataView(arr.buffer, offset, 4).getUint32(0);
            const chunkType = String.fromCharCode(
                arr[offset + 4], arr[offset + 5], arr[offset + 6], arr[offset + 7]
            );
            if (chunkType === 'IEND') break;
            offset += 8 + len + 4;
        }

        const before = arr.slice(0, offset);
        const after = arr.slice(offset);
        const newChunk = this.createPngChunk(type, payloadBuffer);
        
        const combined = new Uint8Array(before.length + newChunk.length + after.length);
        combined.set(before, 0);
        combined.set(newChunk, before.length);
        combined.set(after, before.length + newChunk.length);
        
        return new Blob([combined], { type: 'image/png' });
    },

    async findPayloadChunk(pngBlob) {
        const arr = new Uint8Array(await pngBlob.arrayBuffer());
        let offset = 8;
        
        while (offset < arr.length) {
            const len = new DataView(arr.buffer, offset, 4).getUint32(0);
            const chunkType = String.fromCharCode(
                arr[offset + 4], arr[offset + 5], arr[offset + 6], arr[offset + 7]
            );
            // Prefer our custom chunk identifier first (stable detection)
            if (chunkType === 'crPx') {
                const dataStart = offset + 8;
                return arr.slice(dataStart, dataStart + len).buffer;
            }

            // Backward compatible: look for ancillary chunks with gzip magic
            if (chunkType[0] === chunkType[0].toLowerCase()) {
                const dataStart = offset + 8;
                if (len >= 2 && arr[dataStart] === Config.GZIP_MAGIC[0] && arr[dataStart + 1] === Config.GZIP_MAGIC[1]) {
                    return arr.slice(dataStart, dataStart + len).buffer;
                }
            }
            offset += 8 + len + 4;
        }
        return null;
    },

    async compressBuffer(buffer) {
        if (typeof CompressionStream === 'function') {
            const cs = new CompressionStream('gzip');
            const writer = cs.writable.getWriter();
            writer.write(buffer);
            writer.close();
            return await new Response(cs.readable).arrayBuffer();
        }
        return buffer; // Fallback if API missing
    },

    async decompressBuffer(buffer) {
        if (typeof DecompressionStream === 'function') {
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            writer.write(buffer);
            writer.close();
            return await new Response(ds.readable).arrayBuffer();
        }
        return buffer; // Fallback
    },

    async generateRandomDecoy() {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(size, size);
        const buf = new Uint32Array(imgData.data.buffer);
        
        for (let i = 0; i < buf.length; i++) {
            buf[i] = (Math.random() * 0xFFFFFFFF | 0) | 0xFF000000;
        }
        
        ctx.putImageData(imgData, 0, 0);
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }
};

/**
 * Read DataTransferItemList recursively and return an array of File instances
 * preserving relative paths by using the File name as the full path
 */
async function extractFilesFromDataTransferItems(items) {
    const files = [];

    function readEntry(entry, path) {
        return new Promise(resolve => {
            if (!entry) return resolve();
            if (entry.isFile) {
                entry.file(f => {
                    const fullPath = path + f.name;
                    const wrapped = new File([f], fullPath, { type: f.type });
                    files.push(wrapped);
                    resolve();
                }, () => resolve());
            } else if (entry.isDirectory) {
                const reader = entry.createReader();
                const readBatch = () => {
                    reader.readEntries(async (entries) => {
                        if (!entries || entries.length === 0) return resolve();
                        await Promise.all(entries.map(en => readEntry(en, path + entry.name + '/')));
                        // continue reading until empty
                        readBatch();
                    }, () => resolve());
                };
                readBatch();
            } else {
                resolve();
            }
        });
    }

    const promises = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = (item.webkitGetAsEntry && item.webkitGetAsEntry()) || (item.getAsEntry && item.getAsEntry()) || null;
        if (entry) promises.push(readEntry(entry, ''));
        else {
            const f = item.getAsFile();
            if (f) files.push(f);
        }
    }

    await Promise.all(promises);
    return files;
}

// ── UI MANAGER ──
const UI = {
    elements: {},

    init() {
        const ids =[
            'folderInput', 'multi-file-input', 'folder-zone-label', 'folder-zone',
            'decoyInput', 'decoy-zone-label', 'decoy-zone',
            'packedInput', 'packed-zone-label', 'packed-zone',
            'pack-status', 'progress-wrap', 'progress-fill', 'progress-text', 'progress-pct',
            'pack-stats', 'stat-count', 'stat-payload', 'stat-total', 'downloadPacked',
            'packBtn', 'unpackBtn', 'browser-ui', 'folder-container', 'extract-summary',
            'preview-modal', 'preview-img', 'modal-filename', 'modal-counter',
            'modal-prev-btn', 'modal-close-btn', 'modal-next-btn', 'downloadAllBtn', 'includeSubfolders'
        ];
        ids.forEach(id => {
            this.elements[id] = document.getElementById(id);
        });
    },

    switchTab(targetId, btnElement) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.tab-btn').forEach(el => {
            el.classList.remove('active');
            el.setAttribute('aria-selected', 'false');
        });
        
        document.getElementById(targetId).classList.remove('hidden');
        btnElement.classList.add('active');
        btnElement.setAttribute('aria-selected', 'true');
    },

    updateFileZoneStatus(zoneId, labelId, text, isSuccess = true) {
        const zone = this.elements[zoneId];
        const label = this.elements[labelId];
        label.textContent = text;
        zone.classList.toggle('has-file', isSuccess);
    },

    setButtonLoading(btnId, isLoading, defaultText = '') {
        const btn = this.elements[btnId];
        const textSpan = btn.querySelector('.btn-text');
        const icon = btn.querySelector('.btn-icon');
        const spinner = btn.querySelector('.spinner');

        btn.disabled = isLoading;
        if (isLoading) {
            btn.classList.add('is-loading');
            if (icon) icon.classList.add('hidden');
            spinner.classList.remove('hidden');
            if (defaultText) textSpan.textContent = defaultText;
        } else {
            btn.classList.remove('is-loading');
            if (icon) icon.classList.remove('hidden');
            spinner.classList.add('hidden');
            if (defaultText) textSpan.textContent = defaultText;
        }
    },

    showStatus(msg, isError = false) {
        const el = this.elements['pack-status'];
        el.innerHTML = msg;
        el.classList.remove('hidden');
        el.className = isError ? 'error' : '';
    },

    hideStatus() {
        this.elements['pack-status'].classList.add('hidden');
    },

    setProgress(pct, label = null) {
        this.elements['progress-wrap'].classList.remove('hidden');
        this.elements['progress-fill'].style.width = pct + '%';
        this.elements['progress-pct'].textContent = Math.round(pct) + '%';
        if (label) this.elements['progress-text'].textContent = label;
    },

    hideProgress() {
        this.elements['progress-wrap'].classList.add('hidden');
    },

    renderBrowserGrid(extractedFiles) {
        const container = this.elements['folder-container'];
        container.innerHTML = '';
        const dirs = {};

        // Group by directory
        extractedFiles.forEach((item, flatIdx) => {
            const parts = item.meta.path.split('/');
            const name = parts.pop();
            const dirKey = parts.join('/') || 'Root';
            if (!dirs[dirKey]) dirs[dirKey] = [];
            dirs[dirKey].push({ name, flatIdx, ...item });
        });

        // Build DOM
        Object.keys(dirs).sort().forEach(dir => {
            const items = dirs[dir];
            
            const group = document.createElement('div');
            group.className = 'folder-group';
            group.innerHTML = `
                <div class="folder-header">
                    <span class="folder-icon"><i class="fa-solid fa-folder"></i></span>
                    ${dir}
                    <span class="folder-count">${items.length}</span>
                </div>
            `;

            const grid = document.createElement('div');
            grid.className = 'image-grid';

            items.forEach(fileItem => {
                // Reuse preview URLs when available to avoid creating duplicate object URLs
                let url = null;
                if (State.previewGallery && State.previewGallery[fileItem.flatIdx]) {
                    url = State.previewGallery[fileItem.flatIdx].url;
                }

                if (!url) {
                    url = URL.createObjectURL(fileItem.blob);
                    State.generatedPreviewUrls.push(url);
                }

                const card = document.createElement('div');
                card.className = 'image-card';
                card.addEventListener('click', () => AppController.openModal(fileItem.flatIdx));

                const thumb = document.createElement('div');
                thumb.className = 'img-thumb';
                const img = document.createElement('img');
                img.src = url;
                img.loading = 'lazy';
                img.alt = fileItem.name;
                thumb.appendChild(img);

                const info = document.createElement('div');
                info.className = 'img-info';
                const name = document.createElement('div');
                name.className = 'img-name';
                name.title = fileItem.name;
                name.textContent = fileItem.name;

                const dlBtn = document.createElement('a');
                dlBtn.className = 'img-dl';
                dlBtn.href = url;
                dlBtn.download = fileItem.name;
                dlBtn.textContent = 'Download';
                dlBtn.addEventListener('click', (e) => e.stopPropagation());

                info.appendChild(name);
                info.appendChild(dlBtn);

                card.appendChild(thumb);
                card.appendChild(info);
                grid.appendChild(card);
            });

            group.appendChild(grid);
            container.appendChild(group);
        });
    },

    renderModal(animate = true) {
        const entry = State.previewGallery[State.currentPreviewIndex];
        if (!entry) return;

        const img = this.elements['preview-img'];
        if (animate) {
            img.classList.add('switching');
            setTimeout(() => {
                img.src = entry.url;
                img.classList.remove('switching');
            }, 120);
        } else {
            img.src = entry.url;
        }

        this.elements['modal-filename'].textContent = entry.name;
        this.elements['modal-counter'].textContent = `${State.currentPreviewIndex + 1} / ${State.previewGallery.length}`;
        this.elements['modal-prev-btn'].disabled = (State.currentPreviewIndex === 0);
        this.elements['modal-next-btn'].disabled = (State.currentPreviewIndex === State.previewGallery.length - 1);
    },

    toggleModal(forceState) {
        const modal = this.elements['preview-modal'];
        if (forceState) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        } else {
            modal.classList.remove('active');
            this.elements['preview-img'].src = '';
            document.body.style.overflow = '';
        }
    }
};

// ── APPLICATION CONTROLLER ──
const AppController = {
    init() {
        UI.init();
        this.bindEvents();
    },

    bindEvents() {
        // Tab Switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                UI.switchTab(e.currentTarget.getAttribute('data-target'), e.currentTarget);
            });
        });

        // Drag & Drop interactions
        document.querySelectorAll('.file-zone').forEach(zone => {
            const inputId = zone.getAttribute('data-input-target');
            const input = document.getElementById(inputId);

            zone.addEventListener('dragover', e => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });
            zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
            zone.addEventListener('drop', async e => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                try {
                    // Prefer DataTransferItemList traversal to read folder contents
                    const items = e.dataTransfer.items;
                    let files = [];
                    if (items && items.length > 0) {
                        files = await extractFilesFromDataTransferItems(items);
                    }

                    // Fallback: use files list directly
                    if ((!files || files.length === 0) && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        files = Array.from(e.dataTransfer.files);
                    }

                    if (files.length > 0) {
                        const dt = new DataTransfer();
                        for (const f of files) dt.items.add(f);
                        input.files = dt.files;
                        input.dispatchEvent(new Event('change'));
                    }
                } catch (err) {
                    console.error('Drop handling failed', err);
                }
            });
        });

        // Input Changes
        UI.elements['folderInput'].addEventListener('change', () => {
            const input = UI.elements['folderInput'];
            const count = Array.from(input.files).filter(f => f.type.startsWith('image/')).length;
            if (count > 0) {
                UI.updateFileZoneStatus('folder-zone', 'folder-zone-label', `${count} image${count !== 1 ? 's' : ''} ready`, true);
            } else {
                UI.updateFileZoneStatus('folder-zone', 'folder-zone-label', 'Click or drag a folder here', false);
            }
        });

        // Fallback multi-file input (mobile)
        if (UI.elements['multi-file-input']) {
            UI.elements['multi-file-input'].addEventListener('change', () => {
                const input = UI.elements['multi-file-input'];
                const count = Array.from(input.files).filter(f => f.type.startsWith('image/')).length;
                if (count > 0) {
                    UI.updateFileZoneStatus('folder-zone', 'folder-zone-label', `${count} image${count !== 1 ? 's' : ''} ready`, true);
                    // Mirror files into folderInput so rest of the flow can use the same element
                    try {
                        const dt = new DataTransfer();
                        for (const f of input.files) dt.items.add(f);
                        UI.elements['folderInput'].files = dt.files;
                        UI.elements['folderInput'].dispatchEvent(new Event('change'));
                    } catch (e) {
                    }
                }
            });
        }

        UI.elements['decoyInput'].addEventListener('change', () => {
            const input = UI.elements['decoyInput'];
            if (input.files && input.files[0]) {
                UI.updateFileZoneStatus('decoy-zone', 'decoy-zone-label', input.files[0].name, true);
            }
        });

        UI.elements['packedInput'].addEventListener('change', () => {
            const input = UI.elements['packedInput'];
            if (input.files && input.files[0]) {
                UI.updateFileZoneStatus('packed-zone', 'packed-zone-label', input.files[0].name, true);
            }
        });

        // Primary Actions
        UI.elements['packBtn'].addEventListener('click', () => this.generateContainerImage());
        UI.elements['unpackBtn'].addEventListener('click', () => this.extractImagesFromContainer());
        UI.elements['downloadAllBtn'].addEventListener('click', () => this.downloadAllExtracted());

        // Modal Controls
        UI.elements['preview-modal'].addEventListener('click', () => UI.toggleModal(false));
        UI.elements['preview-img'].addEventListener('click', e => e.stopPropagation());
        UI.elements['modal-close-btn'].addEventListener('click', e => { e.stopPropagation(); UI.toggleModal(false); });
        UI.elements['modal-prev-btn'].addEventListener('click', e => { e.stopPropagation(); this.navigateModal(-1); });
        UI.elements['modal-next-btn'].addEventListener('click', e => { e.stopPropagation(); this.navigateModal(1); });

        // Keyboard & Touch for Modal
        document.addEventListener('keydown', e => {
            if (!UI.elements['preview-modal'].classList.contains('active')) return;
            if (e.key === 'Escape') UI.toggleModal(false);
            if (e.key === 'ArrowLeft') this.navigateModal(-1);
            if (e.key === 'ArrowRight') this.navigateModal(1);
        });

        const modalEl = UI.elements['preview-modal'];
        modalEl.addEventListener('touchstart', e => {
            State.touchStartX = e.touches[0].clientX;
            State.touchStartY = e.touches[0].clientY;
        }, { passive: true });
        
        modalEl.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - State.touchStartX;
            const dy = e.changedTouches[0].clientY - State.touchStartY;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                this.navigateModal(dx < 0 ? 1 : -1);
            }
        }, { passive: true });
    },

    async generateContainerImage() {
        const folderInput = UI.elements['folderInput'];
        const decoyInput = UI.elements['decoyInput'];
        const includeSubfolders = UI.elements['includeSubfolders'].checked;

        if (!folderInput.files || folderInput.files.length === 0) {
            UI.showStatus('Please select a folder first.', true);
            return;
        }

        UI.setButtonLoading('packBtn', true, 'Processing...');
        UI.hideStatus();
        UI.elements['downloadPacked'].classList.add('hidden');
        UI.elements['pack-stats'].classList.add('hidden');
        UI.setProgress(5, 'Filtering images…');

        try {
            let filesToPack = Array.from(folderInput.files).filter(f => f.type.startsWith('image/'));

            if (!includeSubfolders) {
                // Accept single dragged files (length===1) or files directly in the selected folder (length===2)
                filesToPack = filesToPack.filter(f => {
                    const parts = (f.webkitRelativePath || f.name).split('/');
                    return parts.length === 1 || parts.length === 2;
                });
            }

            if (filesToPack.length === 0) throw new Error('No valid images found with the selected options.');

            UI.setProgress(15, 'Loading carrier image…');
            let decoyBlob = (decoyInput.files && decoyInput.files.length > 0) 
                ? decoyInput.files[0] 
                : await StegoEngine.generateRandomDecoy();

            UI.setProgress(30, 'Building payload…');
            const meta = filesToPack.map(f => ({
                path: f.webkitRelativePath || f.name,
                size: f.size,
                type: f.type
            }));

            const metaBytes = Config.ENCODER.encode(JSON.stringify(meta));
            const metaLenBuffer = new ArrayBuffer(4);
            new DataView(metaLenBuffer).setUint32(0, metaBytes.length, true);
            const sigBytes = Config.ENCODER.encode(Config.SIGNATURE);

            const rawPayload = new Blob([...filesToPack, metaBytes, metaLenBuffer, sigBytes]);
            const rawBuffer = await rawPayload.arrayBuffer();

            UI.setProgress(50, 'Compressing payload…');
            const payloadBuffer = await StegoEngine.compressBuffer(rawBuffer);

            UI.setProgress(70, 'Embedding payload…');
            // Use a compliant custom chunk name: c=ancillary, r=private, P=reserved(uppercase), x=safe-to-copy
            const chunkType = 'crPx';

            let containerBlob;
            if (decoyBlob.type === 'image/png') {
                containerBlob = await StegoEngine.insertPngChunk(decoyBlob, chunkType, payloadBuffer);
            } else {
                const pngDecoy = await Utils.convertToPng(decoyBlob);
                containerBlob = await StegoEngine.insertPngChunk(pngDecoy, chunkType, payloadBuffer);
            }

            UI.setProgress(90, 'Finalizing…');
            // Revoke any previous download URL to avoid leaking memory
            if (State.currentDownloadUrl) {
                try { URL.revokeObjectURL(State.currentDownloadUrl); } catch (e) {}
                State.currentDownloadUrl = null;
            }
            State.currentDownloadUrl = URL.createObjectURL(containerBlob);

            const dlLink = UI.elements['downloadPacked'];
            dlLink.href = State.currentDownloadUrl;
            dlLink.download = `cryptex_${Date.now()}.png`;
            dlLink.classList.remove('hidden');

            const payloadSize = filesToPack.reduce((a, f) => a + f.size, 0);
            UI.elements['stat-count'].textContent = filesToPack.length;
            UI.elements['stat-payload'].textContent = Utils.formatBytes(payloadSize);
            UI.elements['stat-total'].textContent = Utils.formatBytes(containerBlob.size);
            UI.elements['pack-stats'].classList.remove('hidden');

            UI.showStatus(`✓ Successfully packed <strong>${filesToPack.length}</strong> image(s).`);
            UI.setProgress(100, 'Done!');
            setTimeout(() => UI.hideProgress(), 1000);

        } catch (err) {
            console.error(err);
            UI.showStatus(err.message, true);
            UI.hideProgress();
        } finally {
            UI.setButtonLoading('packBtn', false, 'Generate Container Image');
        }
    },

    async extractImagesFromContainer() {
        const packedInput = UI.elements['packedInput'];
        
        if (!packedInput.files || packedInput.files.length === 0) {
            alert('Please select a container image first.');
            return;
        }

        const file = packedInput.files[0];
        UI.setButtonLoading('unpackBtn', true, 'Extracting...');
        UI.elements['browser-ui'].classList.add('hidden');
        State.extractedImages =[];

        try {
            let payloadBuffer = null;
            if (file.type === 'image/png') {
                payloadBuffer = await StegoEngine.findPayloadChunk(file);
                if (payloadBuffer) {
                    payloadBuffer = await StegoEngine.decompressBuffer(payloadBuffer);
                }
            }

            let extracted =[];

            if (payloadBuffer) {
                // Parse from ArrayBuffer (Modern PNG chunk method)
                const totalSize = payloadBuffer.byteLength;
                const sigText = Config.DECODER.decode(payloadBuffer.slice(totalSize - 7, totalSize));
                
                if (sigText !== Config.SIGNATURE) throw new Error('Internal signature mismatch.');

                const metaLen = new DataView(payloadBuffer, totalSize - 11, 4).getUint32(0, true);
                if (metaLen > totalSize - 11) throw new Error('Corrupted container metadata.');

                const metaJson = Config.DECODER.decode(payloadBuffer.slice(totalSize - 11 - metaLen, totalSize - 11));
                const metaData = JSON.parse(metaJson);

                let offset = 0;
                for (const m of metaData) {
                    const slice = payloadBuffer.slice(offset, offset + m.size);
                    extracted.push({ meta: m, blob: new Blob([slice], { type: m.type }) });
                    offset += m.size;
                }
            } else {
                // Fallback (Legacy appended-data method)
                const size = file.size;
                if (size < 10) throw new Error('File is too small to be a container.');

                const sigText = Config.DECODER.decode(await file.slice(size - 7, size).arrayBuffer());
                if (sigText !== Config.SIGNATURE) {
                    throw new Error('No Cryptex signature found. Not a valid container.');
                }

                const metaLen = new DataView(await file.slice(size - 11, size - 7).arrayBuffer()).getUint32(0, true);
                const metaJson = Config.DECODER.decode(await file.slice(size - 11 - metaLen, size - 11).arrayBuffer());
                const metaData = JSON.parse(metaJson);

                const totalFilesSize = metaData.reduce((acc, m) => acc + m.size, 0);
                let offset = size - 11 - metaLen - totalFilesSize;

                for (const m of metaData) {
                    extracted.push({ meta: m, blob: file.slice(offset, offset + m.size, m.type) });
                    offset += m.size;
                }
            }

            State.extractedImages = extracted;
            // Revoke any previously-generated preview URLs to avoid leaks
            if (State.previewGallery && State.previewGallery.length) {
                for (const p of State.previewGallery) {
                    try { URL.revokeObjectURL(p.url); } catch (e) {}
                }
            }
            if (State.generatedPreviewUrls && State.generatedPreviewUrls.length) {
                for (const u of State.generatedPreviewUrls) {
                    try { URL.revokeObjectURL(u); } catch (e) {}
                }
                State.generatedPreviewUrls = [];
            }

            State.previewGallery = extracted.map(item => ({
                url: URL.createObjectURL(item.blob),
                name: item.meta.path.split('/').pop()
            }));

            UI.renderBrowserGrid(extracted);

            const totalSize = extracted.reduce((a, e) => a + e.meta.size, 0);
            UI.elements['extract-summary'].textContent = `${extracted.length} file(s) · ${Utils.formatBytes(totalSize)}`;
            UI.elements['browser-ui'].classList.remove('hidden');

        } catch (err) {
            console.error(err);
            alert('Error: ' + err.message);
        } finally {
            UI.setButtonLoading('unpackBtn', false, 'Extract Images');
        }
    },

    async downloadAllExtracted() {
        if (State.extractedImages.length === 0) return;
        
        UI.setButtonLoading('downloadAllBtn', true, 'Preparing...');
        await Utils.delay(50); // Small delay to allow UI to update

        for (const item of State.extractedImages) {
            const url = URL.createObjectURL(item.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = item.meta.path.replace(/\//g, '_');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            await Utils.delay(80); // Stagger downloads slightly
        }

        UI.setButtonLoading('downloadAllBtn', false, 'Download All Images');
    },

    openModal(index) {
        State.currentPreviewIndex = index;
        UI.renderModal(false);
        UI.toggleModal(true);
    },

    navigateModal(direction) {
        const next = State.currentPreviewIndex + direction;
        if (next < 0 || next >= State.previewGallery.length) return;
        State.currentPreviewIndex = next;
        UI.renderModal();
    }
};

// ── BOOTSTRAP ──
document.addEventListener('DOMContentLoaded', () => AppController.init());