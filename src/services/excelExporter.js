const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;

class ExcelExporter {
    constructor() {
        this.workbook = null;
        this.maxFiles = 3; // Keep only 3 most recent files
    }

    /**
     * Sanitize cell values to prevent CSV injection attacks
     * @param {*} value - The value to sanitize
     * @returns {string} - Sanitized value safe for Excel
     */
    sanitizeForExcel(value) {
        if (value === null || value === undefined) {
            return '';
        }
        
        // Convert to string
        const str = String(value);
        
        // Check for dangerous characters at start that could trigger formula execution
        const dangerous = ['=', '+', '-', '@', '\t', '\r', '\n'];
        
        if (dangerous.some(char => str.startsWith(char))) {
            // Prefix with single quote to prevent formula execution
            return `'${str}`;
        }
        
        return str;
    }

    async exportResults(results, filePath) {
        try {
            console.log('📤 Starting Excel export...');
            
            this.workbook = new ExcelJS.Workbook();
            
            // Set workbook properties
            this.workbook.creator = 'WFM Scanner App';
            this.workbook.lastModifiedBy = 'WFM Scanner App';
            this.workbook.created = new Date();
            this.workbook.modified = new Date();
            
            // Detect data type based on first result
            const isMerchandisingMode = results.length > 0 && results[0].mode === 'merchandising';
            
            if (isMerchandisingMode) {
                console.log('📊 Detected merchandising mode data, creating merchandising worksheets...');
                
                // Create merchandising-specific worksheets
                await this.createMerchandisingResultsWorksheet(results);
                await this.createMerchandisingSummaryWorksheet(results);
                await this.createShovelerDetailsWorksheet(results);
                
            } else {
                console.log('📊 Detected item mode data, creating item worksheets...');
                
                // Create item mode worksheets (existing functionality)
                await this.createResultsWorksheet(results);
                await this.createSummaryWorksheet(results);
                await this.createStoreBreakdownWorksheet(results);
            }
            
            // Save the workbook
            await this.workbook.xlsx.writeFile(filePath);
            
            // Clean up old files after successful export
            await this.cleanupOldFiles(filePath);
            
            console.log(`✅ Excel export completed: ${filePath}`);
            return filePath;
            
        } catch (error) {
            console.error('❌ Excel export failed:', error);
            throw error;
        }
    }

    async exportFromDatabase(db, sessionId, filePath) {
        try {
            console.log('📤 Starting streaming Excel export from database...');
            console.log(`📊 Session ID: ${sessionId}`);
            
            // Use streaming workbook writer for memory efficiency
            this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
                filename: filePath,
                useStyles: true,
                useSharedStrings: true
            });
            
            // Set workbook properties
            this.workbook.creator = 'WFM Scanner App';
            this.workbook.lastModifiedBy = 'WFM Scanner App';
            this.workbook.created = new Date();
            this.workbook.modified = new Date();
            
            // Get statistics to determine mode
            const stats = await db.getStatistics(sessionId);
            console.log(`📊 Total results: ${stats.total}`);
            
            // Get a sample result to detect mode
            const sampleResults = await db.getResultsRange(sessionId, 0, 1);
            const isMerchandisingMode = sampleResults.length > 0 && 
                                       sampleResults[0].merchandising_data !== null;
            
            if (isMerchandisingMode) {
                console.log('📊 Detected merchandising mode data');
                await this.streamMerchandisingResults(db, sessionId);
            } else {
                console.log('📊 Detected item mode data');
                await this.streamItemResults(db, sessionId);
            }
            
            // Commit the workbook (finalizes the file)
            await this.workbook.commit();
            
            // Clean up old files after successful export
            await this.cleanupOldFiles(filePath);
            
            console.log(`✅ Streaming Excel export completed: ${filePath}`);
            return filePath;
            
        } catch (error) {
            console.error('❌ Streaming Excel export failed:', error);
            throw error;
        }
    }

    async streamItemResults(db, sessionId) {
        const worksheet = this.workbook.addWorksheet('Scan Results');
        
        // Define columns
        worksheet.columns = [
            { header: 'Store Code', key: 'store', width: 12 },
            { header: 'ASIN', key: 'asin', width: 15 },
            { header: 'Extracted Name', key: 'extractedName', width: 40 },
            { header: 'Price', key: 'price', width: 12 },
            { header: 'Has Nutrition Facts', key: 'hasNutritionFacts', width: 18 },
            { header: 'Has Ingredients', key: 'hasIngredients', width: 16 },
            { header: 'Has Add to Cart', key: 'hasAddToCart', width: 16 },
            { header: 'Is Available', key: 'isAvailable', width: 14 },
            { header: 'Variations', key: 'variationCount', width: 12 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Load Time (ms)', key: 'loadTime', width: 15 },
            { header: 'Error Message', key: 'error', width: 50 },
            { header: 'Timestamp', key: 'timestamp', width: 20 },
            { header: 'Item URL', key: 'url', width: 60 }
        ];
        
        // Style the header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '366092' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.commit();
        
        // Stream results from database
        let rowCount = 0;
        await db.streamResults(sessionId, (result) => {
            const sanitizedRow = {
                store: this.sanitizeForExcel(result.store),
                asin: this.sanitizeForExcel(result.asin),
                extractedName: this.sanitizeForExcel(result.extracted_name || 'N/A'),
                price: this.sanitizeForExcel(result.price || 'N/A'),
                hasNutritionFacts: 'NO', // Will be parsed from extraction_details if needed
                hasIngredients: 'NO',
                hasAddToCart: 'NO',
                isAvailable: 'NO',
                variationCount: 0,
                status: result.success ? 'SUCCESS' : 'FAILED',
                loadTime: result.load_time || '',
                error: this.sanitizeForExcel(result.error_message || ''),
                timestamp: result.timestamp,
                url: `https://www.wholefoodsmarket.com/name/dp/${result.asin}?pd_rd_i=${result.asin}&fpw=alm&almBrandId=aNHVc2Akvg`
            };
            
            // Parse extraction details if available
            if (result.extraction_details) {
                try {
                    const details = JSON.parse(result.extraction_details);
                    // These fields would need to be stored in the database
                    // For now, we'll leave them as defaults
                } catch (e) {
                    console.warn('Failed to parse extraction details:', e.message);
                }
            }
            
            const row = worksheet.addRow(sanitizedRow);
            
            // Color code status
            if (result.success) {
                row.getCell('status').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'C6EFCE' }
                };
                row.getCell('status').font = { color: { argb: '006100' } };
            } else {
                row.getCell('status').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFC7CE' }
                };
                row.getCell('status').font = { color: { argb: '9C0006' } };
            }
            
            row.commit();
            rowCount++;
            
            if (rowCount % 1000 === 0) {
                console.log(`📝 Exported ${rowCount} rows...`);
            }
        });
        
        console.log(`✅ Streamed ${rowCount} item results to Excel`);
    }

    async streamMerchandisingResults(db, sessionId) {
        const worksheet = this.workbook.addWorksheet('Merchandising Results');
        
        // Define columns
        worksheet.columns = [
            { header: 'Store Code', key: 'store', width: 12 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Load Time (ms)', key: 'loadTime', width: 15 },
            { header: 'Shovelers Found', key: 'shovelerCount', width: 16 },
            { header: 'Total ASINs', key: 'totalASINs', width: 12 },
            { header: 'Error Message', key: 'error', width: 50 },
            { header: 'Timestamp', key: 'timestamp', width: 20 }
        ];
        
        // Style the header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '366092' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.commit();
        
        // Stream results from database
        let rowCount = 0;
        await db.streamResults(sessionId, (result) => {
            let shovelerCount = 0;
            let totalASINs = 0;
            
            // Parse merchandising data if available
            if (result.merchandising_data) {
                try {
                    const merchData = JSON.parse(result.merchandising_data);
                    shovelerCount = merchData.shovelers ? merchData.shovelers.length : 0;
                    totalASINs = merchData.totalASINs || 0;
                } catch (e) {
                    console.warn('Failed to parse merchandising data:', e.message);
                }
            }
            
            const sanitizedRow = {
                store: this.sanitizeForExcel(result.store),
                status: result.success ? 'SUCCESS' : 'FAILED',
                loadTime: result.load_time || '',
                shovelerCount: shovelerCount,
                totalASINs: totalASINs,
                error: this.sanitizeForExcel(result.error_message || ''),
                timestamp: result.timestamp
            };
            
            const row = worksheet.addRow(sanitizedRow);
            
            // Color code status
            if (result.success) {
                row.getCell('status').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'C6EFCE' }
                };
                row.getCell('status').font = { color: { argb: '006100' } };
            } else {
                row.getCell('status').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFC7CE' }
                };
                row.getCell('status').font = { color: { argb: '9C0006' } };
            }
            
            row.commit();
            rowCount++;
            
            if (rowCount % 100 === 0) {
                console.log(`📝 Exported ${rowCount} merchandising results...`);
            }
        });
        
        console.log(`✅ Streamed ${rowCount} merchandising results to Excel`);
    }

    async createResultsWorksheet(results) {
        const worksheet = this.workbook.addWorksheet('Scan Results');
        
        // Define columns with enhanced data fields including variations and bundle data
        worksheet.columns = [
            { header: 'Store Code', key: 'store', width: 12 },
            { header: 'ASIN', key: 'asin', width: 15 },
            { header: 'Item Name', key: 'name', width: 30 },
            { header: 'Extracted Name', key: 'extractedName', width: 40 },
            { header: 'Price', key: 'price', width: 12 },
            { header: 'Has Nutrition Facts', key: 'hasNutritionFacts', width: 18 },
            { header: 'Has Ingredients', key: 'hasIngredients', width: 16 },
            { header: 'Has Add to Cart', key: 'hasAddToCart', width: 16 },
            { header: 'Is Available', key: 'isAvailable', width: 14 },
            { header: 'Variations', key: 'variationCount', width: 12 },
            { header: 'Is Bundle', key: 'isBundle', width: 12 },
            { header: 'Bundle Parts', key: 'bundlePartsCount', width: 14 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Load Time (ms)', key: 'loadTime', width: 15 },
            { header: 'Error Message', key: 'error', width: 50 },
            { header: 'Timestamp', key: 'timestamp', width: 20 },
            { header: 'Item URL', key: 'url', width: 60 }
        ];
        
        // Style the header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '366092' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        
        // Add data rows with sanitization
        results.forEach((result, index) => {
            const row = worksheet.addRow({
                store: this.sanitizeForExcel(result.store),
                asin: this.sanitizeForExcel(result.asin),
                name: this.sanitizeForExcel(result.name),
                extractedName: this.sanitizeForExcel(result.extractedName || 'N/A'),
                price: this.sanitizeForExcel(result.price || 'N/A'),
                hasNutritionFacts: result.hasNutritionFacts ? 'YES' : 'NO',
                hasIngredients: result.hasIngredients ? 'YES' : 'NO',
                hasAddToCart: result.hasAddToCart ? 'YES' : 'NO',
                isAvailable: result.isAvailable ? 'YES' : 'NO',
                variationCount: result.variationCount || 0,
                isBundle: result.isBundle ? 'YES' : 'NO',
                bundlePartsCount: result.bundlePartsCount || 0,
                status: result.success ? 'SUCCESS' : 'FAILED',
                loadTime: result.loadTime || '',
                error: this.sanitizeForExcel(result.error || ''),
                timestamp: new Date(result.timestamp).toLocaleString(),
                url: `https://www.wholefoodsmarket.com/name/dp/${result.asin}?pd_rd_i=${result.asin}&fpw=alm&almBrandId=aNHVc2Akvg`
            });
            
            // Color code rows based on success/failure
            if (result.success) {
                row.getCell('status').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'C6EFCE' }
                };
                row.getCell('status').font = { color: { argb: '006100' } };
            } else {
                row.getCell('status').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFC7CE' }
                };
                row.getCell('status').font = { color: { argb: '9C0006' } };
            }
            
            // Color code availability status
            const availabilityCell = row.getCell('isAvailable');
            if (result.isAvailable) {
                availabilityCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'C6EFCE' }
                };
                availabilityCell.font = { color: { argb: '006100' } };
            } else {
                availabilityCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFC7CE' }
                };
                availabilityCell.font = { color: { argb: '9C0006' } };
            }
            
            // Color code boolean fields (YES/NO)
            ['hasNutritionFacts', 'hasIngredients', 'hasAddToCart', 'isBundle'].forEach(field => {
                const cell = row.getCell(field);
                if (cell.value === 'YES') {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'E2EFDA' }
                    };
                    cell.font = { color: { argb: '70AD47' } };
                } else {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FCE4D6' }
                    };
                    cell.font = { color: { argb: 'C65911' } };
                }
            });
            
            // Make URL clickable
            row.getCell('url').value = {
                text: `https://www.wholefoodsmarket.com/name/dp/${result.asin}?pd_rd_i=${result.asin}&fpw=alm&almBrandId=aNHVc2Akvg`,
                hyperlink: `https://www.wholefoodsmarket.com/name/dp/${result.asin}?pd_rd_i=${result.asin}&fpw=alm&almBrandId=aNHVc2Akvg`
            };
            row.getCell('url').font = { color: { argb: '0563C1' }, underline: true };
        });
        
        // Add borders to all cells
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });
        
        // Freeze the header row
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        
        console.log(`✅ Results worksheet created with ${results.length} rows`);
    }

    async createSummaryWorksheet(results) {
        const worksheet = this.workbook.addWorksheet('Summary');
        
        // Calculate summary statistics
        const totalItems = results.length;
        const successfulItems = results.filter(r => r.success).length;
        const failedItems = totalItems - successfulItems;
        const successRate = totalItems > 0 ? ((successfulItems / totalItems) * 100).toFixed(2) : 0;
        
        const avgLoadTime = results
            .filter(r => r.success && r.loadTime)
            .reduce((sum, r, _, arr) => sum + r.loadTime / arr.length, 0);
        
        const uniqueStores = new Set(results.map(r => r.store)).size;
        const scanDate = new Date().toLocaleString();
        
        // Calculate enhanced data statistics
        const successfulResults = results.filter(r => r.success);
        const itemsWithPrice = successfulResults.filter(r => r.price && r.price !== 'N/A').length;
        const itemsWithNutrition = successfulResults.filter(r => r.hasNutritionFacts).length;
        const itemsWithIngredients = successfulResults.filter(r => r.hasIngredients).length;
        const itemsWithAddToCart = successfulResults.filter(r => r.hasAddToCart).length;
        const availableItems = successfulResults.filter(r => r.isAvailable).length;
        const extractedNames = successfulResults.filter(r => r.extractedName && r.extractedName !== 'N/A').length;
        const itemsWithVariations = successfulResults.filter(r => r.variationCount && r.variationCount > 0).length;
        const totalVariations = successfulResults.reduce((sum, r) => sum + (r.variationCount || 0), 0);
        const avgVariationsPerItem = successfulResults.length > 0 ? (totalVariations / successfulResults.length).toFixed(1) : 0;
        const bundleItems = successfulResults.filter(r => r.isBundle).length;
        const totalBundleParts = successfulResults.reduce((sum, r) => sum + (r.bundlePartsCount || 0), 0);
        const avgBundlePartsPerItem = bundleItems > 0 ? (totalBundleParts / bundleItems).toFixed(1) : 0;
        
        // Create summary table
        const summaryData = [
            ['Scan Summary', ''],
            ['', ''],
            ['Scan Date', scanDate],
            ['Total Items Processed', totalItems],
            ['Successful Items', successfulItems],
            ['Failed Items', failedItems],
            ['Success Rate', `${successRate}%`],
            ['Average Load Time', avgLoadTime > 0 ? `${Math.round(avgLoadTime)}ms` : 'N/A'],
            ['Stores Processed', uniqueStores],
            ['', ''],
            ['Data Extraction Summary', ''],
            ['Items with Extracted Names', `${extractedNames} (${successfulItems > 0 ? ((extractedNames / successfulItems) * 100).toFixed(1) : 0}%)`],
            ['Items with Price Data', `${itemsWithPrice} (${successfulItems > 0 ? ((itemsWithPrice / successfulItems) * 100).toFixed(1) : 0}%)`],
            ['Items with Nutrition Facts', `${itemsWithNutrition} (${successfulItems > 0 ? ((itemsWithNutrition / successfulItems) * 100).toFixed(1) : 0}%)`],
            ['Items with Ingredients', `${itemsWithIngredients} (${successfulItems > 0 ? ((itemsWithIngredients / successfulItems) * 100).toFixed(1) : 0}%)`],
            ['Items with Add to Cart', `${itemsWithAddToCart} (${successfulItems > 0 ? ((itemsWithAddToCart / successfulItems) * 100).toFixed(1) : 0}%)`],
            ['Available Items', `${availableItems} (${successfulItems > 0 ? ((availableItems / successfulItems) * 100).toFixed(1) : 0}%)`],
            ['Items with Variations', `${itemsWithVariations} (${successfulItems > 0 ? ((itemsWithVariations / successfulItems) * 100).toFixed(1) : 0}%)`],
            ['Total Variations Found', totalVariations],
            ['Avg Variations per Item', avgVariationsPerItem],
            ['Bundle Items', `${bundleItems} (${successfulItems > 0 ? ((bundleItems / successfulItems) * 100).toFixed(1) : 0}%)`],
            ['Total Bundle Parts', totalBundleParts],
            ['Avg Bundle Parts per Bundle', avgBundlePartsPerItem],
            ['', ''],
            ['Status Breakdown', ''],
            ['✅ Success', successfulItems],
            ['❌ Failed', failedItems]
        ];
        
        // Add data to worksheet
        summaryData.forEach((row, index) => {
            const wsRow = worksheet.addRow(row);
            
            // Style the title row
            if (index === 0) {
                wsRow.font = { bold: true, size: 16, color: { argb: '366092' } };
                wsRow.getCell(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'E7E6E6' }
                };
            }
            
            // Style section headers
            if (row[0] === 'Status Breakdown' || row[0] === 'Data Extraction Summary') {
                wsRow.font = { bold: true, color: { argb: '366092' } };
            }
            
            // Style data rows
            if (index > 1 && row[0] && row[1] && row[0] !== 'Status Breakdown') {
                wsRow.getCell(1).font = { bold: true };
            }
        });
        
        // Set column widths
        worksheet.getColumn(1).width = 25;
        worksheet.getColumn(2).width = 20;
        
        // Add borders
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                if (cell.value) {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                }
            });
        });
        
        console.log('✅ Summary worksheet created');
    }

    async createStoreBreakdownWorksheet(results) {
        const worksheet = this.workbook.addWorksheet('Store Breakdown');
        
        // Group results by store
        const storeStats = new Map();
        
        results.forEach(result => {
            if (!storeStats.has(result.store)) {
                storeStats.set(result.store, {
                    store: result.store,
                    total: 0,
                    successful: 0,
                    failed: 0,
                    avgLoadTime: 0,
                    loadTimes: []
                });
            }
            
            const stats = storeStats.get(result.store);
            stats.total++;
            
            if (result.success) {
                stats.successful++;
                if (result.loadTime) {
                    stats.loadTimes.push(result.loadTime);
                }
            } else {
                stats.failed++;
            }
        });
        
        // Calculate average load times
        storeStats.forEach(stats => {
            if (stats.loadTimes.length > 0) {
                stats.avgLoadTime = Math.round(
                    stats.loadTimes.reduce((sum, time) => sum + time, 0) / stats.loadTimes.length
                );
            }
        });
        
        // Define columns
        worksheet.columns = [
            { header: 'Store Code', key: 'store', width: 15 },
            { header: 'Total Items', key: 'total', width: 12 },
            { header: 'Successful', key: 'successful', width: 12 },
            { header: 'Failed', key: 'failed', width: 12 },
            { header: 'Success Rate', key: 'successRate', width: 15 },
            { header: 'Avg Load Time (ms)', key: 'avgLoadTime', width: 18 }
        ];
        
        // Style header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '366092' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        
        // Add store data
        Array.from(storeStats.values())
            .sort((a, b) => a.store.localeCompare(b.store))
            .forEach(stats => {
                const successRate = stats.total > 0 ? 
                    ((stats.successful / stats.total) * 100).toFixed(1) : 0;
                
                const row = worksheet.addRow({
                    store: stats.store,
                    total: stats.total,
                    successful: stats.successful,
                    failed: stats.failed,
                    successRate: `${successRate}%`,
                    avgLoadTime: stats.avgLoadTime || 'N/A'
                });
                
                // Color code success rate
                const successRateCell = row.getCell('successRate');
                const rate = parseFloat(successRate);
                if (rate >= 90) {
                    successRateCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'C6EFCE' }
                    };
                } else if (rate >= 70) {
                    successRateCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFEB9C' }
                    };
                } else {
                    successRateCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFC7CE' }
                    };
                }
            });
        
        // Add borders
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });
        
        // Freeze header row
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        
        console.log(`✅ Store breakdown worksheet created with ${storeStats.size} stores`);
    }

    async cleanupOldFiles(currentFilePath) {
        try {
            const directory = path.dirname(currentFilePath);
            const currentFileName = path.basename(currentFilePath);
            
            // Read all files in the directory
            const files = await fs.readdir(directory);
            
            // Filter for WFM scan result files (Excel files with our naming pattern)
            const scanFiles = files.filter(file => {
                return file.startsWith('WFM_Scan_Results') &&
                       (file.endsWith('.xlsx') || file.endsWith('.xls')) &&
                       file !== currentFileName; // Exclude the current file
            });
            
            if (scanFiles.length >= this.maxFiles) {
                // Get file stats to sort by creation/modification time
                const fileStats = await Promise.all(
                    scanFiles.map(async (file) => {
                        const filePath = path.join(directory, file);
                        const stats = await fs.stat(filePath);
                        return {
                            name: file,
                            path: filePath,
                            mtime: stats.mtime
                        };
                    })
                );
                
                // Sort by modification time (newest first)
                fileStats.sort((a, b) => b.mtime - a.mtime);
                
                // Keep only the most recent (maxFiles - 1) files, since we just created a new one
                const filesToDelete = fileStats.slice(this.maxFiles - 1);
                
                // Delete old files
                for (const fileInfo of filesToDelete) {
                    try {
                        await fs.unlink(fileInfo.path);
                        console.log(`🗑️ Cleaned up old export file: ${fileInfo.name}`);
                    } catch (deleteError) {
                        console.warn(`⚠️ Failed to delete old file ${fileInfo.name}:`, deleteError.message);
                    }
                }
                
                if (filesToDelete.length > 0) {
                    console.log(`🧹 Cleaned up ${filesToDelete.length} old export file(s), keeping ${this.maxFiles} most recent files`);
                }
            } else {
                console.log(`📁 Found ${scanFiles.length} existing export files, no cleanup needed (max: ${this.maxFiles})`);
            }
        } catch (error) {
            console.warn('⚠️ Error during file cleanup:', error.message);
            // Don't throw error - cleanup failure shouldn't prevent export success
        }
    }

    async createMerchandisingResultsWorksheet(results) {
        const worksheet = this.workbook.addWorksheet('Merchandising Results');
        
        // Define columns for merchandising data
        worksheet.columns = [
            { header: 'Store Code', key: 'store', width: 12 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Load Time (ms)', key: 'loadTime', width: 15 },
            { header: 'Shovelers Found', key: 'shovelerCount', width: 16 },
            { header: 'Total ASINs', key: 'totalASINs', width: 12 },
            { header: 'Error Message', key: 'error', width: 50 },
            { header: 'Timestamp', key: 'timestamp', width: 20 }
        ];
        
        // Style the header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '366092' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        
        // Add data rows with sanitization
        results.forEach((result, index) => {
            const row = worksheet.addRow({
                store: this.sanitizeForExcel(result.store),
                status: result.success ? 'SUCCESS' : 'FAILED',
                loadTime: result.loadTime || '',
                shovelerCount: result.shovelers ? result.shovelers.length : 0,
                totalASINs: result.totalASINs || 0,
                error: this.sanitizeForExcel(result.error || ''),
                timestamp: new Date(result.timestamp).toLocaleString()
            });
            
            // Color code rows based on success/failure
            if (result.success) {
                row.getCell('status').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'C6EFCE' }
                };
                row.getCell('status').font = { color: { argb: '006100' } };
            } else {
                row.getCell('status').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFC7CE' }
                };
                row.getCell('status').font = { color: { argb: '9C0006' } };
            }
        });
        
        // Add borders to all cells
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });
        
        // Freeze the header row
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        
        console.log(`✅ Merchandising results worksheet created with ${results.length} stores`);
    }

    async createMerchandisingSummaryWorksheet(results) {
        const worksheet = this.workbook.addWorksheet('Merchandising Summary');
        
        // Calculate summary statistics
        const totalStores = results.length;
        const successfulStores = results.filter(r => r.success).length;
        const failedStores = totalStores - successfulStores;
        const successRate = totalStores > 0 ? ((successfulStores / totalStores) * 100).toFixed(2) : 0;
        
        const avgLoadTime = results
            .filter(r => r.success && r.loadTime)
            .reduce((sum, r, _, arr) => sum + r.loadTime / arr.length, 0);
        
        const scanDate = new Date().toLocaleString();
        
        // Calculate merchandising-specific statistics
        const successfulResults = results.filter(r => r.success);
        const totalShovelers = successfulResults.reduce((sum, r) => sum + (r.shovelers ? r.shovelers.length : 0), 0);
        const totalASINs = successfulResults.reduce((sum, r) => sum + (r.totalASINs || 0), 0);
        const avgShovelers = successfulResults.length > 0 ? (totalShovelers / successfulResults.length).toFixed(1) : 0;
        const avgASINsPerStore = successfulResults.length > 0 ? (totalASINs / successfulResults.length).toFixed(1) : 0;
        const avgASINsPerShoveler = totalShovelers > 0 ? (totalASINs / totalShovelers).toFixed(1) : 0;
        
        // Create summary table
        const summaryData = [
            ['Merchandising Scan Summary', ''],
            ['', ''],
            ['Scan Date', scanDate],
            ['Total Stores Processed', totalStores],
            ['Successful Stores', successfulStores],
            ['Failed Stores', failedStores],
            ['Success Rate', `${successRate}%`],
            ['Average Load Time', avgLoadTime > 0 ? `${Math.round(avgLoadTime)}ms` : 'N/A'],
            ['', ''],
            ['Shoveler Analysis', ''],
            ['Total Shovelers Found', totalShovelers],
            ['Average Shovelers per Store', avgShovelers],
            ['Total ASINs Extracted', totalASINs],
            ['Average ASINs per Store', avgASINsPerStore],
            ['Average ASINs per Shoveler', avgASINsPerShoveler],
            ['', ''],
            ['Status Breakdown', ''],
            ['✅ Success', successfulStores],
            ['❌ Failed', failedStores]
        ];
        
        // Add data to worksheet
        summaryData.forEach((row, index) => {
            const wsRow = worksheet.addRow(row);
            
            // Style the title row
            if (index === 0) {
                wsRow.font = { bold: true, size: 16, color: { argb: '366092' } };
                wsRow.getCell(1).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'E7E6E6' }
                };
            }
            
            // Style section headers
            if (row[0] === 'Status Breakdown' || row[0] === 'Shoveler Analysis') {
                wsRow.font = { bold: true, color: { argb: '366092' } };
            }
            
            // Style data rows
            if (index > 1 && row[0] && row[1] && row[0] !== 'Status Breakdown' && row[0] !== 'Shoveler Analysis') {
                wsRow.getCell(1).font = { bold: true };
            }
        });
        
        // Set column widths
        worksheet.getColumn(1).width = 25;
        worksheet.getColumn(2).width = 20;
        
        // Add borders
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                if (cell.value) {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                }
            });
        });
        
        console.log('✅ Merchandising summary worksheet created');
    }

    async createShovelerDetailsWorksheet(results) {
        const worksheet = this.workbook.addWorksheet('Shoveler Details');
        
        // Define columns for detailed shoveler data
        worksheet.columns = [
            { header: 'Store Code', key: 'store', width: 12 },
            { header: 'Shoveler Title', key: 'title', width: 40 },
            { header: 'Carousel ID', key: 'carouselId', width: 20 },
            { header: 'ASIN Count', key: 'asinCount', width: 12 },
            { header: 'ASINs', key: 'asins', width: 80 }
        ];
        
        // Style the header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '366092' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        
        // Add data rows - flatten shoveler data with sanitization
        results.forEach(result => {
            if (result.success && result.shovelers && result.shovelers.length > 0) {
                result.shovelers.forEach(shoveler => {
                    const row = worksheet.addRow({
                        store: this.sanitizeForExcel(result.store),
                        title: this.sanitizeForExcel(shoveler.title),
                        carouselId: this.sanitizeForExcel(shoveler.carouselId),
                        asinCount: shoveler.asinCount || shoveler.asins.length,
                        asins: this.sanitizeForExcel(shoveler.asins.join(', '))
                    });
                    
                    // Color code based on ASIN count
                    const asinCountCell = row.getCell('asinCount');
                    const count = shoveler.asinCount || shoveler.asins.length;
                    if (count >= 10) {
                        asinCountCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'C6EFCE' }
                        };
                    } else if (count >= 5) {
                        asinCountCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFEB9C' }
                        };
                    } else if (count > 0) {
                        asinCountCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFC7CE' }
                        };
                    }
                });
            }
        });
        
        // Add borders to all cells
        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });
        
        // Freeze the header row
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        
        // Calculate total rows added
        const totalShovelers = results.reduce((sum, r) => sum + (r.shovelers ? r.shovelers.length : 0), 0);
        console.log(`✅ Shoveler details worksheet created with ${totalShovelers} shoveler entries`);
    }
}

module.exports = { ExcelExporter };