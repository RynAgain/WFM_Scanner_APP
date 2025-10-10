// Context isolation enabled - using window.electronAPI from preload script

class WFMScannerUI {
    constructor() {
        this.isScanning = false;
        this.scanStartTime = null;
        this.elapsedTimeInterval = null;
        this.storeMappingFile = null;
        this.itemListFile = null;
        this.scanResults = [];
        this.logMessages = [];
        this.screenDimensions = null;
        this.savedConfig = null;
        this.filteredResults = [];
        this.currentMode = 'item'; // 'item' or 'merchandising'
        this.observers = []; // Store MutationObservers for cleanup
        
        // Virtual scrolling properties
        this.maxInMemoryResults = 1000; // Limit in-memory results
        this.updateBatchSize = 10; // Update UI every N results
        this.resultUpdateCounter = 0; // Counter for batched updates
        this.virtualScrollRowHeight = 40; // Height of each row in pixels
        this.virtualScrollVisibleRows = 20; // Number of visible rows
        this.virtualScrollOffset = 0; // Current scroll offset
        
        this.initializeUI();
        this.setupEventListeners();
        this.setupIpcListeners();
        this.getScreenDimensions();
        this.loadSavedConfig();
        
        // Setup cleanup on window unload
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    async getScreenDimensions() {
        try {
            this.screenDimensions = await window.electronAPI.getScreenDimensions();
            console.log('📐 Screen dimensions received:', this.screenDimensions);
        } catch (error) {
            console.error('❌ Error getting screen dimensions:', error);
        }
    }

    async loadSavedConfig() {
        try {
            this.savedConfig = await window.electronAPI.loadConfig();
            console.log('📁 Loaded saved configuration:', this.savedConfig);
            
            // Apply saved files if they exist and are still valid
            if (this.savedConfig.lastStoreMappingFile) {
                this.storeMappingFile = this.savedConfig.lastStoreMappingFile;
                const fileName = this.savedConfig.lastStoreMappingFile.split(/[\\/]/).pop();
                this.elements.storeMappingFile.textContent = fileName;
                this.elements.storeMappingFile.classList.add('selected');
                this.log(`📁 Restored store mapping file: ${fileName}`, 'info');
            }
            
            if (this.savedConfig.lastItemListFile) {
                this.itemListFile = this.savedConfig.lastItemListFile;
                const fileName = this.savedConfig.lastItemListFile.split(/[\\/]/).pop();
                this.elements.itemListFile.textContent = fileName;
                this.elements.itemListFile.classList.add('selected');
                this.log(`📊 Restored item list file: ${fileName}`, 'info');
            }
            
            // Apply saved settings
            if (this.savedConfig.lastSettings) {
                const settings = this.savedConfig.lastSettings;
                this.elements.delayBetweenItems.value = settings.delayBetweenItems || 2000;
                this.elements.delayBetweenStores.value = settings.delayBetweenStores || 5000;
                this.elements.pageTimeout.value = settings.pageTimeout || 30000;
                this.elements.maxRetries.value = settings.maxRetries || 3;
                this.elements.headlessMode.checked = settings.headlessMode || false;
                this.elements.captureScreenshots.checked = settings.captureScreenshots || false;
                this.elements.skipExistingResults.checked = settings.skipExistingResults || false;
                this.elements.maxConcurrentAgents.value = settings.maxConcurrentAgents || 3;
                this.log('⚙️ Restored previous settings', 'info');
            }
            
            this.updateUI();
        } catch (error) {
            console.error('❌ Error loading saved configuration:', error);
            this.log('⚠️ Could not load previous configuration, using defaults', 'warning');
        }
    }

    initializeUI() {
        // Get DOM elements with new IDs
        this.elements = {
            // Version and update elements
            appVersion: document.getElementById('appVersion'),
            updateStatus: document.getElementById('updateStatus'),
            updateMessage: document.getElementById('updateMessage'),
            updateProgress: document.getElementById('updateProgress'),
            updateProgressFill: document.getElementById('updateProgressFill'),
            updateProgressText: document.getElementById('updateProgressText'),
            
            // Mode selector
            scanModeSelect: document.getElementById('scanModeSelect'),
            itemModeDesc: document.getElementById('itemModeDesc'),
            merchandisingModeDesc: document.getElementById('merchandisingModeDesc'),
            itemListGroup: document.getElementById('itemListGroup'),
            
            // File selection
            selectStoreMappingBtn: document.getElementById('selectStoreMappingBtn'),
            storeMappingFile: document.getElementById('storeMappingFile'),
            selectItemListBtn: document.getElementById('selectItemListBtn'),
            itemListFile: document.getElementById('itemListFile'),
            
            // Settings
            delayBetweenItems: document.getElementById('delayBetweenItems'),
            delayBetweenStores: document.getElementById('delayBetweenStores'),
            pageTimeout: document.getElementById('pageTimeout'),
            maxRetries: document.getElementById('maxRetries'),
            headlessMode: document.getElementById('headlessMode'),
            captureScreenshots: document.getElementById('captureScreenshots'),
            skipExistingResults: document.getElementById('skipExistingResults'),
            maxConcurrentAgents: document.getElementById('maxConcurrentAgents'),
            
            // Controls
            startScanBtn: document.getElementById('startScanBtn'),
            stopScanBtn: document.getElementById('stopScanBtn'),
            exportResultsBtn: document.getElementById('exportResultsBtn'),
            
            // Progress
            progressFill: document.getElementById('progressFill'),
            progressText: document.getElementById('progressText'),
            currentStore: document.getElementById('currentStore'),
            itemsProcessed: document.getElementById('itemsProcessed'),
            totalItems: document.getElementById('totalItems'),
            successRate: document.getElementById('successRate'),
            activeAgents: document.getElementById('activeAgents'),
            elapsedTime: document.getElementById('elapsedTime'),
            
            // Results
            resultsBody: document.getElementById('resultsBody'),
            searchFilter: document.getElementById('searchFilter'),
            statusFilter: document.getElementById('statusFilter'),
            
            // Log
            logOutput: document.getElementById('logOutput'),
            clearLogBtn: document.getElementById('clearLogBtn'),
            exportLogBtn: document.getElementById('exportLogBtn')
        };

        // Set headless mode to false by default for side-by-side viewing
        this.elements.headlessMode.checked = false;

        // Initialize mode toggle
        this.updateModeUI();

        // Initialize version display
        this.initializeVersion();

        this.log('🚀 WFM Scanner App initialized with new responsive UI', 'info');
        this.log('📐 Configured for side-by-side window display', 'info');
        this.log('🔧 Scanner Mode: Item Mode (default)', 'info');
        this.updateUI();
    }

    setupEventListeners() {
        // Mode selector
        this.elements.scanModeSelect.addEventListener('change', () => {
            this.handleModeChange();
        });

        // File selection
        this.elements.selectStoreMappingBtn.addEventListener('click', () => {
            this.selectStoreMappingFile();
        });

        this.elements.selectItemListBtn.addEventListener('click', () => {
            this.selectItemListFile();
        });

        // Control buttons
        this.elements.startScanBtn.addEventListener('click', () => {
            this.startScan();
        });

        this.elements.stopScanBtn.addEventListener('click', () => {
            this.stopScan();
        });

        this.elements.exportResultsBtn.addEventListener('click', () => {
            this.exportResults();
        });

        // Log controls
        this.elements.clearLogBtn.addEventListener('click', () => {
            this.clearLog();
        });

        this.elements.exportLogBtn.addEventListener('click', () => {
            this.exportLog();
        });

        // Search and filter
        this.elements.searchFilter.addEventListener('input', () => {
            this.filterResults();
        });

        this.elements.statusFilter.addEventListener('change', () => {
            this.filterResults();
        });

        // Settings change validation
        const settingsInputs = [
            this.elements.delayBetweenItems,
            this.elements.delayBetweenStores,
            this.elements.pageTimeout,
            this.elements.maxRetries,
            this.elements.maxConcurrentAgents
        ];

        settingsInputs.forEach(input => {
            input.addEventListener('change', () => {
                this.validateSettings();
                this.saveCurrentSettings();
                this.updateUI();
            });
        });
        
        // Save settings when checkboxes change
        [this.elements.headlessMode, this.elements.captureScreenshots, this.elements.skipExistingResults].forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.saveCurrentSettings();
            });
        });

        // Headless mode warning
        this.elements.headlessMode.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.log('⚠️ Headless mode enabled - Playwright window will not be visible', 'warning');
            } else {
                this.log('👁️ Headless mode disabled - Playwright window will appear side-by-side', 'info');
            }
        });

        // File selection change
        [this.elements.storeMappingFile, this.elements.itemListFile].forEach(element => {
            const observer = new MutationObserver(() => {
                this.updateUI();
            });
            observer.observe(element, { childList: true, subtree: true });
            this.observers.push(observer); // Store for cleanup
        });
    }

    cleanup() {
        // Remove all IPC listeners
        if (window.electronAPI && window.electronAPI.removeAllListeners) {
            window.electronAPI.removeAllListeners('scan-progress');
            window.electronAPI.removeAllListeners('scan-result');
            window.electronAPI.removeAllListeners('updater-message');
            window.electronAPI.removeAllListeners('updater-progress');
        }
        
        // Disconnect MutationObservers
        if (this.observers) {
            this.observers.forEach(observer => observer.disconnect());
        }
        
        console.log('🧹 Cleanup completed - all listeners removed');
    }

    setupIpcListeners() {
        // Scan progress updates
        window.electronAPI.onScanProgress((progress) => {
            this.updateProgress(progress);
        });

        // Scan result updates
        window.electronAPI.onScanResult((result) => {
            this.addResult(result);
        });

        // Auto-updater events
        window.electronAPI.onUpdaterMessage((message) => {
            this.showUpdateMessage(message);
        });

        window.electronAPI.onUpdaterProgress((progressObj) => {
            this.showUpdateProgress(progressObj);
        });
    }

    async selectStoreMappingFile() {
        try {
            const filePath = await window.electronAPI.selectStoreMappingFile();
            if (filePath) {
                this.storeMappingFile = filePath;
                const fileName = filePath.split(/[\\/]/).pop();
                this.elements.storeMappingFile.textContent = fileName;
                this.elements.storeMappingFile.classList.add('selected');
                this.log(`📁 Store mapping file selected: ${fileName}`, 'success');
                this.updateUI();
            }
        } catch (error) {
            this.log(`❌ Error selecting store mapping file: ${error.message}`, 'error');
        }
    }

    async selectItemListFile() {
        try {
            const filePath = await window.electronAPI.selectItemListFile();
            if (filePath) {
                this.itemListFile = filePath;
                const fileName = filePath.split(/[\\/]/).pop();
                this.elements.itemListFile.textContent = fileName;
                this.elements.itemListFile.classList.add('selected');
                this.log(`📊 Item list file selected: ${fileName}`, 'success');
                this.updateUI();
            }
        } catch (error) {
            this.log(`❌ Error selecting item list file: ${error.message}`, 'error');
        }
    }

    validateSettings() {
        const settings = this.getSettings();
        let isValid = true;
        const errors = [];

        if (settings.delayBetweenItems < 500) {
            errors.push('Delay between items must be at least 500ms');
            isValid = false;
        }

        if (settings.delayBetweenStores < 1000) {
            errors.push('Delay between stores must be at least 1000ms');
            isValid = false;
        }

        if (settings.pageTimeout < 5000) {
            errors.push('Page timeout must be at least 5000ms');
            isValid = false;
        }

        if (settings.maxRetries < 1) {
            errors.push('Max retries must be at least 1');
            isValid = false;
        }

        if (settings.maxConcurrentAgents < 1) {
            errors.push('Max concurrent agents must be at least 1');
            isValid = false;
        }

        if (!isValid) {
            errors.forEach(error => this.log(`⚠️ ${error}`, 'warning'));
        }

        return isValid;
    }

    async saveCurrentSettings() {
        try {
            if (!this.savedConfig) {
                this.savedConfig = await window.electronAPI.loadConfig();
            }
            
            this.savedConfig.lastSettings = this.getSettings();
            await window.electronAPI.saveConfig(this.savedConfig);
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    getSettings() {
        return {
            delayBetweenItems: parseInt(this.elements.delayBetweenItems.value),
            delayBetweenStores: parseInt(this.elements.delayBetweenStores.value),
            pageTimeout: parseInt(this.elements.pageTimeout.value),
            maxRetries: parseInt(this.elements.maxRetries.value),
            headlessMode: this.elements.headlessMode.checked,
            captureScreenshots: this.elements.captureScreenshots.checked,
            skipExistingResults: this.elements.skipExistingResults.checked,
            maxConcurrentAgents: parseInt(this.elements.maxConcurrentAgents.value)
        };
    }

    handleModeChange() {
        this.currentMode = this.elements.scanModeSelect.value;
        this.updateModeUI();
        const modeNames = {
            'item': 'Item Mode',
            'merchandising': 'Merchandising Mode',
            'competitive': 'Competitive Mode'
        };
        this.log(`🔧 Scanner Mode switched to: ${modeNames[this.currentMode] || this.currentMode}`, 'info');
        this.updateUI();
    }

    updateModeUI() {
        const isItemMode = this.currentMode === 'item';
        const isMerchandisingMode = this.currentMode === 'merchandising';
        const isCompetitiveMode = this.currentMode === 'competitive';

        // Update description visibility with null checks
        if (this.elements.itemModeDesc) {
            this.elements.itemModeDesc.classList.toggle('active', isItemMode);
        }
        if (this.elements.merchandisingModeDesc) {
            this.elements.merchandisingModeDesc.classList.toggle('active', isMerchandisingMode);
        }
        
        // Add competitive mode description if it exists
        const competitiveModeDesc = document.getElementById('competitiveModeDesc');
        if (competitiveModeDesc) {
            competitiveModeDesc.classList.toggle('active', isCompetitiveMode);
        }

        // Show/hide item list group based on mode with null check
        if (this.elements.itemListGroup) {
            this.elements.itemListGroup.classList.toggle('hidden', !isItemMode);
        }

        // Update selector value with null check
        if (this.elements.scanModeSelect) {
            this.elements.scanModeSelect.value = this.currentMode;
        }
    }

    async startScan() {
        try {
            // Validation based on mode
            if (!this.storeMappingFile) {
                this.log('❌ Please select store mapping file', 'error');
                return;
            }

            if (this.currentMode === 'item' && !this.itemListFile) {
                this.log('❌ Please select item list file for Item Mode', 'error');
                return;
            }

            if (!this.validateSettings()) {
                this.log('❌ Please fix settings validation errors', 'error');
                return;
            }

            const config = {
                storeMappingFile: this.storeMappingFile,
                itemListFile: this.currentMode === 'item' ? this.itemListFile : null,
                settings: this.getSettings(),
                mode: this.currentMode
            };

            // Log window positioning info
            if (!config.settings.headlessMode && this.screenDimensions) {
                this.log(`📐 Playwright window will appear at position (${this.screenDimensions.playwrightX}, ${this.screenDimensions.playwrightY})`, 'info');
                this.log(`📐 Playwright window size: ${this.screenDimensions.playwrightWidth}x${this.screenDimensions.playwrightHeight}`, 'info');
            }

            if (this.currentMode === 'item') {
                this.log('🚀 Starting Item Mode scan with multi-agent processing...', 'info');
                this.log(`🤖 Using ${config.settings.maxConcurrentAgents} concurrent agents for parallel processing`, 'info');
            } else {
                this.log('🚀 Starting Merchandising Mode scan...', 'info');
                this.log('🎠 Analyzing shoveler carousels on catering pages for each store', 'info');
            }
            
            // Add guidance for manual store selection if needed
            if (!config.settings.headlessMode) {
                this.log('💡 If no CSRF token is found, you may need to manually select a store in the browser window', 'info');
                this.log('👆 Watch for the browser window to appear and follow any prompts for manual store selection', 'info');
            }
            
            this.isScanning = true;
            this.scanStartTime = Date.now();
            this.startElapsedTimer();
            this.clearResults(); // Clear previous results
            this.updateUI();

            const result = await window.electronAPI.startScan(config);
            
            if (result.success) {
                this.log(`✅ Scan completed successfully! Processed ${result.totalResults} items`, 'success');
                this.log(`📊 Final statistics: ${this.scanResults.filter(r => r.success).length} successful, ${this.scanResults.filter(r => !r.success).length} failed`, 'info');
            } else {
                this.log(`❌ Scan failed: ${result.error}`, 'error');
            }

        } catch (error) {
            this.log(`❌ Error starting scan: ${error.message}`, 'error');
        } finally {
            this.isScanning = false;
            this.stopElapsedTimer();
            this.updateUI();
        }
    }

    async stopScan() {
        try {
            this.log('🛑 Stopping scan...', 'info');
            const result = await window.electronAPI.stopScan();
            
            if (result.success) {
                this.log('✅ Scan stopped successfully', 'success');
            } else {
                this.log(`❌ Error stopping scan: ${result.error}`, 'error');
            }

        } catch (error) {
            this.log(`❌ Error stopping scan: ${error.message}`, 'error');
        } finally {
            this.isScanning = false;
            this.stopElapsedTimer();
            this.updateUI();
        }
    }

    async exportResults() {
        try {
            if (this.scanResults.length === 0) {
                this.log('❌ No results to export', 'error');
                return;
            }

            const exportPath = await window.electronAPI.selectExportLocation();
            if (!exportPath) return;

            this.log('📤 Exporting results to Excel...', 'info');
            const result = await window.electronAPI.exportResults(exportPath);
            
            if (result.success) {
                this.log(`✅ Results exported to: ${result.filePath}`, 'success');
                this.log(`📊 Exported ${this.scanResults.length} results with comprehensive statistics`, 'info');
            } else {
                this.log(`❌ Export failed: ${result.error}`, 'error');
            }

        } catch (error) {
            this.log(`❌ Error exporting results: ${error.message}`, 'error');
        }
    }

    updateProgress(progress) {
        const { currentStore, itemsProcessed, totalItems, successCount, errorCount, activeAgents } = progress;
        
        // Update progress bar
        const percentage = totalItems > 0 ? Math.round((itemsProcessed / totalItems) * 100) : 0;
        this.elements.progressFill.style.width = `${percentage}%`;
        
        // Update progress text
        this.elements.progressText.textContent = `Processing ${currentStore || 'Unknown Store'}... (${percentage}%)`;
        
        // Update stats
        this.elements.currentStore.textContent = currentStore || '-';
        this.elements.itemsProcessed.textContent = itemsProcessed.toLocaleString();
        this.elements.totalItems.textContent = totalItems.toLocaleString();
        this.elements.activeAgents.textContent = activeAgents || 0;
        
        // Update success rate
        const successRate = itemsProcessed > 0 ? Math.round((successCount / itemsProcessed) * 100) : 0;
        this.elements.successRate.textContent = `${successRate}%`;
    }

    addResult(result) {
        // Limit in-memory results to prevent memory issues
        if (this.scanResults.length >= this.maxInMemoryResults) {
            this.scanResults.shift(); // Remove oldest result
        }
        
        this.scanResults.push(result);
        
        // Make scanResults available globally for export
        if (typeof window !== 'undefined') {
            window.scannerUI = this;
        }
        
        // Increment counter for batched updates
        this.resultUpdateCounter++;
        
        // Only update UI every N results to prevent lockups
        if (this.resultUpdateCounter >= this.updateBatchSize) {
            this.resultUpdateCounter = 0;
            this.filterResults();
        }
        
        // Enhanced logging with new data including bundle information
        const status = result.success ? '✅' : '❌';
        let message = `${status} ${result.store} - ${result.asin} ${result.success ? 'loaded' : 'failed'}`;
        
        if (result.success && result.extractedName && result.extractedName !== 'N/A') {
            message += ` | Name: "${result.extractedName}"`;
        }
        if (result.success && result.price && result.price !== 'N/A') {
            message += ` | Price: ${result.price}`;
        }
        if (result.success) {
            const features = [];
            if (result.hasNutritionFacts) features.push('Nutrition');
            if (result.hasIngredients) features.push('Ingredients');
            if (result.hasAddToCart) features.push('AddToCart');
            if (result.isBundle) features.push(`Bundle(${result.bundlePartsCount || 0} parts)`);
            if (result.variationCount > 0) features.push(`${result.variationCount} variations`);
            if (features.length > 0) {
                message += ` | Features: ${features.join(', ')}`;
            }
        }
        
        // Log with total count information
        this.log(`${message} | Total Results: ${this.scanResults.length}`, result.success ? 'success' : 'error');
        
        this.updateUI();
    }

    filterResults() {
        const searchTerm = this.elements.searchFilter.value.toLowerCase();
        const statusFilter = this.elements.statusFilter.value;
        
        this.filteredResults = this.scanResults.filter(result => {
            // Search filter
            const matchesSearch = !searchTerm || 
                result.store.toLowerCase().includes(searchTerm) ||
                result.asin.toLowerCase().includes(searchTerm) ||
                (result.name && result.name.toLowerCase().includes(searchTerm)) ||
                (result.extractedName && result.extractedName.toLowerCase().includes(searchTerm));
            
            // Status filter
            const matchesStatus = !statusFilter || 
                (statusFilter === 'success' && result.success) ||
                (statusFilter === 'error' && !result.success) ||
                (statusFilter === 'timeout' && result.error && result.error.includes('timeout'));
            
            return matchesSearch && matchesStatus;
        });
        
        this.renderResults();
    }

    renderResults() {
        const tbody = this.elements.resultsBody;
        
        if (this.filteredResults.length === 0) {
            tbody.innerHTML = `
                <div class="no-results">
                    <div class="no-results-icon">📊</div>
                    <div class="no-results-text">No scan results yet</div>
                    <div class="no-results-subtext">Configure your settings and start scanning to see results here</div>
                </div>
            `;
            return;
        }
        
        // Use virtual scrolling to render only visible rows
        this.renderVirtualScrollResults();
    }
    
    renderVirtualScrollResults() {
        const tbody = this.elements.resultsBody;
        
        // Clear existing results
        tbody.innerHTML = '';
        
        // Calculate which results to show (most recent first)
        const totalResults = this.filteredResults.length;
        const startIndex = Math.max(0, totalResults - this.virtualScrollVisibleRows);
        const endIndex = totalResults;
        
        // Get the slice of results to display (most recent)
        const resultsToShow = this.filteredResults.slice(startIndex, endIndex);
        
        // Render only visible rows (reversed to show newest first)
        resultsToShow.reverse().forEach((result, index) => {
            const row = this.createResultRow(result);
            tbody.appendChild(row);
        });
        
        // Add info about total results if we're limiting display
        if (totalResults > this.virtualScrollVisibleRows) {
            const infoRow = document.createElement('div');
            infoRow.className = 'table-row info-row';
            infoRow.style.backgroundColor = '#f0f0f0';
            infoRow.style.fontStyle = 'italic';
            infoRow.style.padding = '10px';
            infoRow.innerHTML = `
                <div class="table-cell" style="grid-column: 1 / -1; text-align: center;">
                    📊 Showing ${this.virtualScrollVisibleRows} most recent results out of ${totalResults} total
                    ${totalResults > this.maxInMemoryResults ? ` (keeping last ${this.maxInMemoryResults} in memory)` : ''}
                </div>
            `;
            tbody.appendChild(infoRow);
        }
    }

    createResultRow(result) {
        const row = document.createElement('div');
        row.className = `table-row ${result.success ? 'success' : 'error'}`;
        
        const extractedName = result.extractedName && result.extractedName !== 'N/A' ? result.extractedName : '-';
        const price = result.price && result.price !== 'N/A' ? result.price : '-';
        const nutrition = result.hasNutritionFacts ? '✅' : '❌';
        const ingredients = result.hasIngredients ? '✅' : '❌';
        const addToCart = result.hasAddToCart ? '✅' : '❌';
        const available = result.isAvailable ? '✅' : '❌';
        const variations = result.variationCount || 0;
        const isBundle = result.isBundle ? '✅' : '❌';
        const bundleParts = result.bundlePartsCount || 0;
        const status = result.success ? '✅ Success' : '❌ Error';
        const loadTime = result.loadTime ? `${result.loadTime}ms` : '-';
        const timestamp = new Date(result.timestamp).toLocaleTimeString();
        
        row.innerHTML = `
            <div class="table-cell col-store">${result.store}</div>
            <div class="table-cell col-asin">${result.asin}</div>
            <div class="table-cell col-name" title="${result.name || ''}">${result.name || '-'}</div>
            <div class="table-cell col-extracted" title="${extractedName}">${extractedName}</div>
            <div class="table-cell col-price">${price}</div>
            <div class="table-cell col-nutrition">${nutrition}</div>
            <div class="table-cell col-ingredients">${ingredients}</div>
            <div class="table-cell col-cart">${addToCart}</div>
            <div class="table-cell col-available">${available}</div>
            <div class="table-cell col-variations">${variations}</div>
            <div class="table-cell col-bundle">${isBundle}</div>
            <div class="table-cell col-bundle-parts">${bundleParts}</div>
            <div class="table-cell col-status status-${result.success ? 'success' : 'error'}">${status}</div>
            <div class="table-cell col-time">${loadTime}</div>
            <div class="table-cell col-timestamp">${timestamp}</div>
        `;
        
        return row;
    }

    clearResults() {
        this.scanResults = [];
        this.filteredResults = [];
        this.resultUpdateCounter = 0; // Reset counter
        this.renderResults();
    }

    startElapsedTimer() {
        this.elapsedTimeInterval = setInterval(() => {
            if (this.scanStartTime) {
                const elapsed = Date.now() - this.scanStartTime;
                const hours = Math.floor(elapsed / 3600000);
                const minutes = Math.floor((elapsed % 3600000) / 60000);
                const seconds = Math.floor((elapsed % 60000) / 1000);
                
                const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                this.elements.elapsedTime.textContent = timeString;
            }
        }, 1000);
    }

    stopElapsedTimer() {
        if (this.elapsedTimeInterval) {
            clearInterval(this.elapsedTimeInterval);
            this.elapsedTimeInterval = null;
        }
    }

    updateUI() {
        // Check required files based on mode
        const hasRequiredFiles = this.currentMode === 'item'
            ? (this.storeMappingFile && this.itemListFile)
            : this.storeMappingFile;
        const hasResults = this.scanResults.length > 0;
        
        // Enable/disable buttons based on state and mode
        this.elements.startScanBtn.disabled = this.isScanning || !hasRequiredFiles;
        this.elements.stopScanBtn.disabled = !this.isScanning;
        this.elements.exportResultsBtn.disabled = !hasResults || this.isScanning;
        
        // Update button text based on state and mode
        if (this.isScanning) {
            const modeText = this.currentMode === 'item' ? 'Item Scanning...' : 'Merchandising Scanning...';
            this.elements.startScanBtn.innerHTML = `<span class="btn-icon">🔄</span>${modeText}`;
        } else {
            const modeText = this.currentMode === 'item' ? 'Start Item Scan' : 'Start Merchandising Scan';
            this.elements.startScanBtn.innerHTML = `<span class="btn-icon">▶️</span>${modeText}`;
        }
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = {
            timestamp,
            message,
            type
        };
        
        this.logMessages.push(logEntry);
        
        // Create log element
        const logElement = document.createElement('div');
        logElement.className = `log-entry ${type}`;
        logElement.innerHTML = `
            <span class="log-time">[${timestamp}]</span>
            <span class="log-message">${message}</span>
        `;
        
        // Add to log output
        this.elements.logOutput.appendChild(logElement);
        
        // Auto-scroll to bottom
        this.elements.logOutput.scrollTop = this.elements.logOutput.scrollHeight;
        
        // Limit log entries to last 1000
        const logEntries = this.elements.logOutput.children;
        if (logEntries.length > 1000) {
            this.elements.logOutput.removeChild(logEntries[0]);
            this.logMessages.shift();
        }
        
        // Also log to console
        console.log(`[WFM Scanner] ${message}`);
    }

    clearLog() {
        this.elements.logOutput.innerHTML = '';
        this.logMessages = [];
        this.log('📝 Log cleared', 'info');
    }

    async exportLog() {
        try {
            const logContent = this.logMessages
                .map(entry => `[${entry.timestamp}] ${entry.message}`)
                .join('\n');
            
            const blob = new Blob([logContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `WFM_Scanner_Log_${new Date().toISOString().split('T')[0]}.txt`;
            a.click();
            
            URL.revokeObjectURL(url);
            this.log('📤 Log exported successfully', 'success');
            
        } catch (error) {
            this.log(`❌ Error exporting log: ${error.message}`, 'error');
        }
    }

    async initializeVersion() {
        try {
            // Get version from package.json via main process
            const version = await window.electronAPI.getAppVersion();
            if (this.elements.appVersion && version) {
                this.elements.appVersion.textContent = `v${version}`;
            }
        } catch (error) {
            console.error('Error getting app version:', error);
            if (this.elements.appVersion) {
                this.elements.appVersion.textContent = 'v1.0.0';
            }
        }
    }

    showUpdateMessage(message) {
        if (this.elements.updateStatus && this.elements.updateMessage) {
            this.elements.updateStatus.classList.remove('hidden');
            this.elements.updateMessage.textContent = message;
            
            // Log update messages
            this.log(`🔄 Update: ${message}`, 'info');
            
            // Hide progress bar for non-download messages
            if (!message.includes('Downloading') && !message.includes('Downloaded')) {
                if (this.elements.updateProgress) {
                    this.elements.updateProgress.classList.add('hidden');
                }
            }
        }
    }

    showUpdateProgress(progressObj) {
        if (this.elements.updateProgress && this.elements.updateProgressFill && this.elements.updateProgressText) {
            this.elements.updateProgress.classList.remove('hidden');
            
            const percent = Math.round(progressObj.percent);
            this.elements.updateProgressFill.style.width = `${percent}%`;
            this.elements.updateProgressText.textContent = `${percent}%`;
            
            // Log progress periodically (every 10%)
            if (percent % 10 === 0) {
                const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(1);
                this.log(`📥 Update download: ${percent}% (${speed} MB/s)`, 'info');
            }
        }
    }

    async checkForUpdates() {
        try {
            this.log('🔍 Checking for updates...', 'info');
            const result = await window.electronAPI.checkForUpdates();
            if (result.success) {
                this.log('✅ Update check completed', 'success');
            } else {
                this.log(`❌ Update check failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.log(`❌ Error checking for updates: ${error.message}`, 'error');
        }
    }

    async restartAndInstall() {
        try {
            this.log('🔄 Restarting to install update...', 'info');
            await window.electronAPI.restartAndInstall();
        } catch (error) {
            this.log(`❌ Error restarting for update: ${error.message}`, 'error');
        }
    }
}

// Initialize the UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new WFMScannerUI();
});