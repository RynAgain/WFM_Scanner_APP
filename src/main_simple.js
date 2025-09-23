const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    console.log('Creating main window...');
    
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false, // Don't show until ready
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Load the HTML file
    const htmlPath = path.join(__dirname, '../renderer/index_simple.html');
    console.log('Loading HTML from:', htmlPath);
    
    mainWindow.loadFile(htmlPath).then(() => {
        console.log('HTML loaded successfully');
        mainWindow.show(); // Show window after loading
        mainWindow.webContents.openDevTools(); // Open dev tools to see any errors
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

// Set up basic IPC handlers for file selection
function setupIpcHandlers() {
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
            console.log('Store mapping file selected:', result.filePaths[0]);
            return result.filePaths[0];
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
            console.log('Item list file selected:', result.filePaths[0]);
            return result.filePaths[0];
        }
        return null;
    });

    // Handle start scan (simplified version)
    ipcMain.handle('start-scan', async (event, config) => {
        console.log('Scan start requested with config:', config);
        
        try {
            // For now, just simulate a successful scan
            console.log('Simulating scan process...');
            
            // Validate files exist
            const fs = require('fs');
            if (!fs.existsSync(config.storeMappingFile)) {
                throw new Error('Store mapping file not found');
            }
            if (!fs.existsSync(config.itemListFile)) {
                throw new Error('Item list file not found');
            }
            
            console.log('Files validated successfully');
            console.log('Store mapping file:', config.storeMappingFile);
            console.log('Item list file:', config.itemListFile);
            console.log('Settings:', config.settings);
            
            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            return {
                success: true,
                message: 'Scan completed successfully (simulated)',
                itemsProcessed: 10,
                successCount: 8,
                errorCount: 2
            };
            
        } catch (error) {
            console.error('Scan failed:', error);
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

console.log('Simple WFM Scanner App starting...');
console.log('Node version:', process.version);
console.log('Electron version:', process.versions.electron);
console.log('Current directory:', __dirname);