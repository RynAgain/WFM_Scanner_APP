const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// File to store last used files
const configPath = path.join(app.getPath('userData'), 'scanner-config.json');

let mainWindow;
let currentScanner = null; // Track the current scanner instance

// Helper functions for configuration persistence
function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(configData);
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
    return {
        lastStoreMappingFile: null,
        lastItemListFile: null,
        lastSettings: {
            delayBetweenItems: 2000,
            delayBetweenStores: 5000,
            pageTimeout: 30000,
            maxRetries: 3,
            headlessMode: false,
            captureScreenshots: false,
            skipExistingResults: false,
            maxConcurrentAgents: 3 // Multi-agent support
        }
    };
}

function saveConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('Configuration saved successfully');
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

function createWindow() {
    console.log('Creating main window...');
    
    // Get screen dimensions for positioning
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    
    // Calculate window dimensions (Electron takes left half)
    const windowWidth = Math.floor(screenWidth / 2);
    const windowHeight = screenHeight;
    
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x: 0, // Position at left edge
        y: 0,
        show: false, // Don't show until ready
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Load the HTML file
    const htmlPath = path.join(__dirname, '../renderer/index.html');
    console.log('Loading HTML from:', htmlPath);
    
    mainWindow.loadFile(htmlPath).then(() => {
        console.log('HTML loaded successfully');
        mainWindow.show(); // Show window after loading
        
        // Open dev tools in development
        if (process.argv.includes('--dev')) {
            mainWindow.webContents.openDevTools();
        }
    }).catch(err => {
        console.error('Failed to load HTML:', err);
    });

    // Handle window events
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.once('ready-to-show', () => {
        console.log('Window ready to show');
        mainWindow.show();
    });
}

// Set up IPC handlers
function setupIpcHandlers() {
    // Handle loading saved configuration
    ipcMain.handle('load-config', () => {
        console.log('Loading saved configuration...');
        return loadConfig();
    });

    // Handle saving configuration
    ipcMain.handle('save-config', (event, config) => {
        console.log('Saving configuration...');
        saveConfig(config);
        return true;
    });

    // Handle screen dimensions request
    ipcMain.handle('get-screen-dimensions', () => {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        
        // Calculate dimensions for side-by-side layout
        const electronWidth = Math.floor(screenWidth / 2);
        const playwrightWidth = screenWidth - electronWidth;
        
        return {
            screenWidth,
            screenHeight,
            electronX: 0,
            electronY: 0,
            electronWidth,
            electronHeight: screenHeight,
            playwrightX: electronWidth,
            playwrightY: 0,
            playwrightWidth,
            playwrightHeight: screenHeight
        };
    });

    // Handle store mapping file selection
    ipcMain.handle('select-store-mapping-file', async () => {
        console.log('Store mapping file selection requested');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Store Mapping CSV File',
            filters: [
                { name: 'CSV Files', extensions: ['csv'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            console.log('Store mapping file selected:', filePath);
            
            // Save to config
            const config = loadConfig();
            config.lastStoreMappingFile = filePath;
            saveConfig(config);
            
            return filePath;
        }
        return null;
    });

    // Handle item list file selection
    ipcMain.handle('select-item-list-file', async () => {
        console.log('Item list file selection requested');
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Item List File',
            filters: [
                { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
                { name: 'CSV Files', extensions: ['csv'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            console.log('Item list file selected:', filePath);
            
            // Save to config
            const config = loadConfig();
            config.lastItemListFile = filePath;
            saveConfig(config);
            
            return filePath;
        }
        return null;
    });

    // Handle scan start
    ipcMain.handle('start-scan', async (event, config) => {
        console.log('Scan start requested with config:', config);
        
        try {
            // Dynamically import the scanner service to avoid startup issues
            const { ScannerService } = require('./services/scannerService');
            const { ExcelExporter } = require('./services/excelExporter');
            
            // Get screen dimensions for Playwright positioning
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
            
            // Calculate dimensions for side-by-side layout
            const electronWidth = Math.floor(screenWidth / 2);
            const playwrightWidth = screenWidth - electronWidth;
            
            const screenDimensions = {
                screenWidth,
                screenHeight,
                electronX: 0,
                electronY: 0,
                electronWidth,
                electronHeight: screenHeight,
                playwrightX: electronWidth,
                playwrightY: 0,
                playwrightWidth,
                playwrightHeight: screenHeight
            };
            
            // Create scanner configuration
            const scannerConfig = {
                ...config,
                screenDimensions
            };
            
            console.log('Starting scanner service...');
            const scanner = new ScannerService(scannerConfig);
            currentScanner = scanner; // Store reference for stopping
            
            // Set up progress callback
            scanner.onProgress = (progress) => {
                mainWindow.webContents.send('scan-progress', progress);
            };
            
            // Set up result callback
            scanner.onResult = (result) => {
                mainWindow.webContents.send('scan-result', result);
            };
            
            // Start the scan
            const results = await scanner.startScan();
            currentScanner = null; // Clear reference when done
            
            // Export results to Excel
            console.log('Exporting results to Excel...');
            const exporter = new ExcelExporter();
            
            // Generate export file path
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const exportPath = path.join(process.cwd(), `WFM_Scan_Results_${timestamp}.xlsx`);
            
            const finalExportPath = await exporter.exportResults(results, exportPath);
            
            console.log('Scan completed successfully');
            return {
                success: true,
                message: 'Scan completed successfully',
                resultsCount: results.length,
                exportPath: finalExportPath,
                results: results
            };
            
        } catch (error) {
            console.error('Scan failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Handle scan stop
    ipcMain.handle('stop-scan', async () => {
        console.log('Scan stop requested');
        
        try {
            if (currentScanner) {
                console.log('Stopping current scanner...');
                await currentScanner.stopScan();
                currentScanner = null;
                return { success: true, message: 'Scan stopped successfully' };
            } else {
                console.log('No active scanner to stop');
                return { success: true, message: 'No active scan to stop' };
            }
        } catch (error) {
            console.error('Error stopping scan:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle export location selection
    ipcMain.handle('select-export-location', async () => {
        console.log('Export location selection requested');
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Save Scan Results',
            defaultPath: `WFM_Scan_Results_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`,
            filters: [
                { name: 'Excel Files', extensions: ['xlsx'] }
            ]
        });

        if (!result.canceled && result.filePath) {
            console.log('Export location selected:', result.filePath);
            return result.filePath;
        }
        return null;
    });

    // Handle results export
    ipcMain.handle('export-results', async (event, exportPath) => {
        console.log('Results export requested to:', exportPath);
        
        try {
            // Get the current results from the renderer
            const results = await mainWindow.webContents.executeJavaScript('window.scannerUI ? window.scannerUI.scanResults : []');
            
            if (!results || results.length === 0) {
                return {
                    success: false,
                    error: 'No results to export'
                };
            }

            // Dynamically import the exporter
            const { ExcelExporter } = require('./services/excelExporter');
            const exporter = new ExcelExporter();
            
            const finalExportPath = await exporter.exportResults(results, exportPath);
            
            console.log('Export completed successfully');
            return {
                success: true,
                filePath: finalExportPath,
                resultsCount: results.length
            };
            
        } catch (error) {
            console.error('Export failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    console.log('IPC handlers set up');
}

// App event handlers
app.whenReady().then(() => {
    console.log('Electron app ready');
    createWindow();
    setupIpcHandlers();
});

app.on('window-all-closed', () => {
    console.log('All windows closed');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    console.log('App activated');
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

console.log('WFM Scanner App starting...');
console.log('Node version:', process.version);
console.log('Electron version:', process.versions.electron);
console.log('Current directory:', __dirname);