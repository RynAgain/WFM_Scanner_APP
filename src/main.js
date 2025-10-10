const { app, BrowserWindow, ipcMain, dialog, screen, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const IPCValidator = require('./utils/ipc-validator');
const RateLimiter = require('./utils/rate-limiter');
const ResultsDatabase = require('./database/resultsDatabase');

// File to store last used files
const configPath = path.join(app.getPath('userData'), 'scanner-config.json');

let mainWindow;
let currentScanner = null; // Track the current scanner instance
let currentSessionId = null; // Track the current scan session ID
const rateLimiter = new RateLimiter(); // Initialize rate limiter

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
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../renderer/preload.js')
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
    ipcMain.handle('save-config', async (event, config) => {
        console.log('Saving configuration...');
        try {
            // Apply rate limiting
            rateLimiter.checkLimit('save-config');
            
            // Validate config
            IPCValidator.validate('save-config', { config });
            
            console.log('✅ Configuration validated');
            saveConfig(config);
            return { success: true };
        } catch (error) {
            console.error('❌ Validation/Rate limit error:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
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
            // Apply rate limiting
            rateLimiter.checkLimit('start-scan');
            
            // Validate input
            const validated = IPCValidator.validate('start-scan', config);
            
            console.log('✅ Scan configuration validated');
            
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
            
            // Create scanner configuration (use validated config)
            const scannerConfig = {
                ...validated,
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
            const scanResult = await scanner.startScan();
            currentScanner = null; // Clear reference when done
            currentSessionId = scanResult.sessionId; // Store session ID for export
            
            // Export results to Excel from database
            console.log('Exporting results to Excel from database...');
            const exporter = new ExcelExporter();
            
            // Generate export file path
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const exportPath = path.join(process.cwd(), `WFM_Scan_Results_${timestamp}.xlsx`);
            
            // Initialize database for export
            const db = new ResultsDatabase();
            await db.initialize();
            
            const finalExportPath = await exporter.exportFromDatabase(db, scanResult.sessionId, exportPath);
            
            await db.close();
            
            console.log('Scan completed successfully');
            return {
                success: true,
                message: 'Scan completed successfully',
                resultsCount: scanResult.stats.total,
                exportPath: finalExportPath,
                sessionId: scanResult.sessionId,
                stats: scanResult.stats
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
            // Apply rate limiting
            rateLimiter.checkLimit('stop-scan');
            
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
            // Apply rate limiting
            rateLimiter.checkLimit('export-results');
            
            // Validate export path
            IPCValidator.validate('export-results', { exportPath });
            
            console.log('✅ Export path validated');
            
            // Check if we have a current session ID
            if (!currentSessionId) {
                return {
                    success: false,
                    error: 'No scan session available to export'
                };
            }

            // Initialize database
            const db = new ResultsDatabase();
            await db.initialize();
            
            // Check if session has results
            const resultCount = await db.getResultCount(currentSessionId);
            if (resultCount === 0) {
                await db.close();
                return {
                    success: false,
                    error: 'No results to export'
                };
            }

            // Dynamically import the exporter
            const { ExcelExporter } = require('./services/excelExporter');
            const exporter = new ExcelExporter();
            
            const finalExportPath = await exporter.exportFromDatabase(db, currentSessionId, exportPath);
            
            await db.close();
            
            console.log('Export completed successfully');
            return {
                success: true,
                filePath: finalExportPath,
                resultsCount: resultCount
            };
            
        } catch (error) {
            console.error('Export failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    });

    // Handle manual update check
    ipcMain.handle('check-for-updates', async () => {
        console.log('Manual update check requested');
        try {
            const result = await autoUpdater.checkForUpdatesAndNotify();
            return { success: true, result };
        } catch (error) {
            console.error('Error checking for updates:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle restart and install update
    ipcMain.handle('restart-and-install', () => {
        console.log('Restart and install requested');
        autoUpdater.quitAndInstall();
    });

    // Handle get app version
    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });

    // Handle get database statistics
    ipcMain.handle('get-database-stats', async () => {
        try {
            const db = new ResultsDatabase();
            await db.initialize();
            const stats = await db.getDatabaseStats();
            await db.close();
            return { success: true, stats };
        } catch (error) {
            console.error('Error getting database stats:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle get all sessions
    ipcMain.handle('get-all-sessions', async () => {
        try {
            const db = new ResultsDatabase();
            await db.initialize();
            const sessions = await db.getAllSessions();
            await db.close();
            return { success: true, sessions };
        } catch (error) {
            console.error('Error getting sessions:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle delete session
    ipcMain.handle('delete-session', async (event, sessionId) => {
        try {
            const db = new ResultsDatabase();
            await db.initialize();
            const result = await db.deleteSession(sessionId);
            await db.vacuum(); // Reclaim space after deletion
            await db.close();
            return { success: true, ...result };
        } catch (error) {
            console.error('Error deleting session:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle cleanup old sessions
    ipcMain.handle('cleanup-old-sessions', async (event, daysToKeep = 3) => {
        try {
            const db = new ResultsDatabase();
            await db.initialize();
            const result = await db.cleanupOldSessions(daysToKeep);
            await db.vacuum(); // Reclaim space after cleanup
            await db.close();
            return { success: true, ...result };
        } catch (error) {
            console.error('Error cleaning up sessions:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle keep latest scans
    ipcMain.handle('keep-latest-scans', async (event, count = 10) => {
        try {
            const db = new ResultsDatabase();
            await db.initialize();
            const result = await db.keepLatestScans(count);
            await db.vacuum(); // Reclaim space after cleanup
            await db.close();
            return { success: true, ...result };
        } catch (error) {
            console.error('Error keeping latest scans:', error);
            return { success: false, error: error.message };
        }
    });

    console.log('IPC handlers set up');
}

// Auto-updater configuration
function setupAutoUpdater() {
    // Configure auto-updater
    autoUpdater.checkForUpdatesAndNotify();
    
    // Auto-updater events
    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for update...');
        if (mainWindow) {
            mainWindow.webContents.send('updater-message', 'Checking for updates...');
        }
    });
    
    autoUpdater.on('update-available', (info) => {
        console.log('Update available:', info);
        if (mainWindow) {
            mainWindow.webContents.send('updater-message', 'Update available. Downloading...');
        }
    });
    
    autoUpdater.on('update-not-available', (info) => {
        console.log('Update not available:', info);
        if (mainWindow) {
            mainWindow.webContents.send('updater-message', 'App is up to date.');
        }
    });
    
    autoUpdater.on('error', (err) => {
        console.error('Auto-updater error:', err);
        if (mainWindow) {
            mainWindow.webContents.send('updater-message', 'Error checking for updates.');
        }
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
        let log_message = "Download speed: " + progressObj.bytesPerSecond;
        log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
        log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
        console.log(log_message);
        if (mainWindow) {
            mainWindow.webContents.send('updater-progress', progressObj);
        }
    });
    
    autoUpdater.on('update-downloaded', (info) => {
        console.log('Update downloaded:', info);
        if (mainWindow) {
            mainWindow.webContents.send('updater-message', 'Update downloaded. Restart to apply.');
        }
        // Auto-restart after 5 seconds
        setTimeout(() => {
            autoUpdater.quitAndInstall();
        }, 5000);
    });
}

// App event handlers
app.whenReady().then(async () => {
    console.log('Electron app ready');
    
    // Set Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data:; " +
                    "font-src 'self'; " +
                    "connect-src 'self' https://www.wholefoodsmarket.com"
                ]
            }
        });
    });
    
    // Perform database cleanup on startup
    try {
        console.log('🧹 Performing database cleanup...');
        const db = new ResultsDatabase();
        await db.initialize();
        
        // Get database stats before cleanup
        const statsBefore = await db.getDatabaseStats();
        console.log(`📊 Database stats before cleanup:
  - Sessions: ${statsBefore.sessionCount}
  - Results: ${statsBefore.resultCount}
  - Size: ${statsBefore.fileSizeMB} MB
  - Oldest: ${statsBefore.oldestSession || 'N/A'}
  - Newest: ${statsBefore.newestSession || 'N/A'}`);
        
        // Clean up old sessions (keep last 3 days as per user preference)
        const cleanupResult = await db.cleanupOldSessions(3);
        
        // Vacuum database to reclaim space
        if (cleanupResult.deletedSessions > 0 || cleanupResult.deletedResults > 0) {
            await db.vacuum();
        }
        
        // Get database stats after cleanup
        const statsAfter = await db.getDatabaseStats();
        console.log(`📊 Database stats after cleanup:
  - Sessions: ${statsAfter.sessionCount}
  - Results: ${statsAfter.resultCount}
  - Size: ${statsAfter.fileSizeMB} MB
  - Space saved: ${(parseFloat(statsBefore.fileSizeMB) - parseFloat(statsAfter.fileSizeMB)).toFixed(2)} MB`);
        
        await db.close();
        console.log('✅ Database cleanup complete');
    } catch (error) {
        console.error('❌ Database cleanup failed:', error);
        // Don't prevent app startup if cleanup fails
    }
    
    createWindow();
    setupIpcHandlers();
    
    // Set up auto-updater after a short delay to ensure window is ready
    setTimeout(() => {
        setupAutoUpdater();
    }, 3000);
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