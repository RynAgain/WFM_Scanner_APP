const { ipcRenderer } = require('electron');

console.log('Simple renderer script loaded');

// Simple UI controller
class SimpleWFMScannerUI {
    constructor() {
        this.storeMappingFile = null;
        this.itemListFile = null;
        
        console.log('Initializing simple UI...');
        this.initializeUI();
    }

    initializeUI() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.setupEventListeners();
            });
        } else {
            this.setupEventListeners();
        }
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');

        // Store mapping file selection
        const selectStoreMappingBtn = document.getElementById('selectStoreMappingBtn');
        const storeMappingFileSpan = document.getElementById('storeMappingFile');
        
        if (selectStoreMappingBtn) {
            selectStoreMappingBtn.addEventListener('click', async () => {
                console.log('Store mapping button clicked');
                try {
                    const filePath = await ipcRenderer.invoke('select-store-mapping-file');
                    if (filePath) {
                        this.storeMappingFile = filePath;
                        const fileName = filePath.split(/[\\/]/).pop();
                        storeMappingFileSpan.textContent = fileName;
                        storeMappingFileSpan.classList.add('selected');
                        console.log('Store mapping file selected:', fileName);
                        this.updateUI();
                    }
                } catch (error) {
                    console.error('Error selecting store mapping file:', error);
                }
            });
        }

        // Item list file selection
        const selectItemListBtn = document.getElementById('selectItemListBtn');
        const itemListFileSpan = document.getElementById('itemListFile');
        
        if (selectItemListBtn) {
            selectItemListBtn.addEventListener('click', async () => {
                console.log('Item list button clicked');
                try {
                    const filePath = await ipcRenderer.invoke('select-item-list-file');
                    if (filePath) {
                        this.itemListFile = filePath;
                        const fileName = filePath.split(/[\\/]/).pop();
                        itemListFileSpan.textContent = fileName;
                        itemListFileSpan.classList.add('selected');
                        console.log('Item list file selected:', fileName);
                        this.updateUI();
                    }
                } catch (error) {
                    console.error('Error selecting item list file:', error);
                }
            });
        }

        // Start scan button
        const startScanBtn = document.getElementById('startScanBtn');
        if (startScanBtn) {
            startScanBtn.addEventListener('click', async () => {
                console.log('Start scan button clicked');
                
                if (!this.storeMappingFile || !this.itemListFile) {
                    alert('Please select both store mapping and item list files first.');
                    return;
                }

                try {
                    const config = {
                        storeMappingFile: this.storeMappingFile,
                        itemListFile: this.itemListFile,
                        settings: this.getSettings()
                    };

                    console.log('Starting scan with config:', config);
                    const result = await ipcRenderer.invoke('start-scan', config);
                    
                    if (result.success) {
                        console.log('Scan completed successfully');
                        alert('Scan completed successfully!');
                    } else {
                        console.log('Scan failed:', result.error);
                        alert(`Scan failed: ${result.error}`);
                    }
                } catch (error) {
                    console.error('Error starting scan:', error);
                    alert(`Error starting scan: ${error.message}`);
                }
            });
        }

        console.log('Event listeners set up successfully');
        this.updateUI();
    }

    getSettings() {
        return {
            delayBetweenItems: parseInt(document.getElementById('delayBetweenItems')?.value || '2000'),
            delayBetweenStores: parseInt(document.getElementById('delayBetweenStores')?.value || '5000'),
            pageTimeout: parseInt(document.getElementById('pageTimeout')?.value || '30000'),
            maxRetries: parseInt(document.getElementById('maxRetries')?.value || '3'),
            headlessMode: document.getElementById('headlessMode')?.checked || false,
            captureScreenshots: document.getElementById('captureScreenshots')?.checked || false,
            skipExistingResults: document.getElementById('skipExistingResults')?.checked || false
        };
    }

    updateUI() {
        const hasFiles = this.storeMappingFile && this.itemListFile;
        const startScanBtn = document.getElementById('startScanBtn');
        
        if (startScanBtn) {
            startScanBtn.disabled = !hasFiles;
            if (hasFiles) {
                startScanBtn.textContent = '🚀 Start Scan';
            } else {
                startScanBtn.textContent = '🚀 Start Scan (Select files first)';
            }
        }

        console.log('UI updated. Has files:', hasFiles);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, initializing UI...');
        new SimpleWFMScannerUI();
    });
} else {
    console.log('DOM already loaded, initializing UI...');
    new SimpleWFMScannerUI();
}

console.log('Simple renderer script setup complete');