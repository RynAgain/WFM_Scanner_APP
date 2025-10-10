const sqlite3 = require('sqlite3').verbose();
const { app } = require('electron');
const path = require('path');
const fs = require('fs').promises;

class ResultsDatabase {
  constructor() {
    this.db = null;
    this.dbPath = path.join(app.getPath('userData'), 'scan-results.db');
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('❌ Database connection error:', err);
          reject(err);
        } else {
          console.log('✅ Database connected:', this.dbPath);
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const schema = `
      CREATE TABLE IF NOT EXISTS scan_sessions (
        id TEXT PRIMARY KEY,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        total_items INTEGER DEFAULT 0,
        processed_items INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running'
      );

      CREATE TABLE IF NOT EXISTS scan_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        store TEXT NOT NULL,
        asin TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        extracted_name TEXT,
        name TEXT,
        price TEXT,
        image_url TEXT,
        product_url TEXT,
        
        load_time INTEGER,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        
        variations TEXT,
        bundle_parts TEXT,
        extraction_details TEXT,
        merchandising_data TEXT,
        
        FOREIGN KEY (session_id) REFERENCES scan_sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_session ON scan_results(session_id);
      CREATE INDEX IF NOT EXISTS idx_store ON scan_results(store);
      CREATE INDEX IF NOT EXISTS idx_asin ON scan_results(asin);
      CREATE INDEX IF NOT EXISTS idx_success ON scan_results(success);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON scan_results(timestamp);

      CREATE TABLE IF NOT EXISTS scan_progress (
        session_id TEXT PRIMARY KEY,
        current_store TEXT,
        current_item INTEGER,
        total_items INTEGER,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES scan_sessions(id)
      );
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(schema, (err) => {
        if (err) {
          console.error('❌ Schema creation error:', err);
          reject(err);
        } else {
          console.log('✅ Database schema created');
          resolve();
        }
      });
    });
  }

  async createSession(sessionId, totalItems) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO scan_sessions (id, total_items) VALUES (?, ?)',
        [sessionId, totalItems],
        (err) => {
          if (err) reject(err);
          else resolve(sessionId);
        }
      );
    });
  }

  async insertResult(sessionId, result) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO scan_results (
          session_id, store, asin, success, extracted_name, name, price,
          image_url, product_url, load_time, error_message, retry_count,
          variations, bundle_parts, extraction_details, merchandising_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        sessionId,
        result.store,
        result.asin,
        result.success ? 1 : 0,
        result.extractedName,
        result.name,
        result.price,
        result.imageUrl,
        result.productUrl,
        result.loadTime,
        result.errorMessage,
        result.retryCount || 0,
        JSON.stringify(result.variations || []),
        JSON.stringify(result.bundleParts || []),
        JSON.stringify(result.extractionDetails || {}),
        JSON.stringify(result.merchandisingData || {})
      ];

      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async insertBatch(sessionId, results) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        let completed = 0;
        let errors = [];

        for (const result of results) {
          this.insertResult(sessionId, result)
            .then(() => {
              completed++;
              if (completed === results.length) {
                this.db.run('COMMIT', (err) => {
                  if (err) reject(err);
                  else resolve({ inserted: completed, errors });
                });
              }
            })
            .catch((err) => {
              errors.push(err);
              completed++;
              if (completed === results.length) {
                this.db.run('ROLLBACK', () => {
                  reject(new Error(`Batch insert failed: ${errors.length} errors`));
                });
              }
            });
        }
      });
    });
  }

  async getResultCount(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT COUNT(*) as count FROM scan_results WHERE session_id = ?',
        [sessionId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        }
      );
    });
  }

  async getResultsRange(sessionId, offset, limit) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM scan_results 
         WHERE session_id = ? 
         ORDER BY id DESC 
         LIMIT ? OFFSET ?`,
        [sessionId, limit, offset],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(this.deserializeResult));
        }
      );
    });
  }

  async streamResults(sessionId, callback) {
    return new Promise((resolve, reject) => {
      this.db.each(
        'SELECT * FROM scan_results WHERE session_id = ? ORDER BY id',
        [sessionId],
        (err, row) => {
          if (err) reject(err);
          else callback(this.deserializeResult(row));
        },
        (err, count) => {
          if (err) reject(err);
          else resolve(count);
        }
      );
    });
  }

  async getStatistics(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_count,
          AVG(load_time) as avg_load_time,
          MIN(timestamp) as started_at,
          MAX(timestamp) as last_updated
         FROM scan_results 
         WHERE session_id = ?`,
        [sessionId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async updateProgress(sessionId, progress) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO scan_progress 
         (session_id, current_store, current_item, total_items, last_updated)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [sessionId, progress.currentStore, progress.currentItem, progress.totalItems],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async completeSession(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE scan_sessions 
         SET completed_at = CURRENT_TIMESTAMP, status = 'completed'
         WHERE id = ?`,
        [sessionId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  deserializeResult(row) {
    return {
      ...row,
      success: Boolean(row.success),
      variations: row.variations ? JSON.parse(row.variations) : [],
      bundleParts: row.bundle_parts ? JSON.parse(row.bundle_parts) : [],
      extractionDetails: row.extraction_details ? JSON.parse(row.extraction_details) : {},
      merchandisingData: row.merchandising_data ? JSON.parse(row.merchandising_data) : {}
    };
  }
  // ==================== CLEANUP METHODS ====================

  /**
   * Clean up old scan sessions based on age
   * @param {number} daysToKeep - Number of days to retain (default: 30)
   * @returns {Promise<{deletedSessions: number, deletedResults: number}>}
   */
  async cleanupOldSessions(daysToKeep = 3) {
    return new Promise((resolve, reject) => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      const cutoffISO = cutoffDate.toISOString();

      console.log(`🧹 Cleaning up sessions older than ${daysToKeep} days (before ${cutoffISO})...`);

      const db = this.db; // Capture db reference
      db.serialize(() => {
        let deletedResults = 0;
        let deletedSessions = 0;

        // First, delete old results
        db.run(
          `DELETE FROM scan_results
           WHERE session_id IN (
             SELECT id FROM scan_sessions WHERE started_at < ?
           )`,
          [cutoffISO],
          function(err) {
            if (err) {
              console.error('❌ Error deleting old results:', err);
              return reject(err);
            }
            deletedResults = this.changes;
            console.log(`  ✓ Deleted ${deletedResults} old results`);

            // Then delete old progress entries
            db.run(
              `DELETE FROM scan_progress
               WHERE session_id IN (
                 SELECT id FROM scan_sessions WHERE started_at < ?
               )`,
              [cutoffISO],
              (err) => {
                if (err) {
                  console.error('❌ Error deleting old progress:', err);
                  return reject(err);
                }

                // Finally, delete old sessions
                db.run(
                  'DELETE FROM scan_sessions WHERE started_at < ?',
                  [cutoffISO],
                  function(err) {
                    if (err) {
                      console.error('❌ Error deleting old sessions:', err);
                      return reject(err);
                    }
                    deletedSessions = this.changes;
                    console.log(`  ✓ Deleted ${deletedSessions} old sessions`);
                    console.log(`✅ Cleanup complete: ${deletedSessions} sessions, ${deletedResults} results removed`);
                    resolve({ deletedSessions, deletedResults });
                  }
                );
              }
            );
          }
        );
      });
    });
  }

  /**
   * Keep only the N most recent scan sessions
   * @param {number} count - Number of sessions to keep (default: 10)
   * @returns {Promise<{deletedSessions: number, deletedResults: number}>}
   */
  async keepLatestScans(count = 10) {
    return new Promise((resolve, reject) => {
      console.log(`🧹 Keeping only the latest ${count} scan sessions...`);

      const db = this.db; // Capture db reference
      // First, get the cutoff session ID
      db.get(
        `SELECT id FROM scan_sessions
         ORDER BY started_at DESC
         LIMIT 1 OFFSET ?`,
        [count - 1],
        (err, row) => {
          if (err) {
            console.error('❌ Error finding cutoff session:', err);
            return reject(err);
          }

          if (!row) {
            console.log(`  ℹ️ Less than ${count} sessions exist, nothing to clean up`);
            return resolve({ deletedSessions: 0, deletedResults: 0 });
          }

          const cutoffId = row.id;
          console.log(`  ℹ️ Cutoff session ID: ${cutoffId}`);

          db.serialize(() => {
            let deletedResults = 0;
            let deletedSessions = 0;

            // Delete old results
            db.run(
              `DELETE FROM scan_results
               WHERE session_id IN (
                 SELECT id FROM scan_sessions
                 WHERE started_at < (SELECT started_at FROM scan_sessions WHERE id = ?)
               )`,
              [cutoffId],
              function(err) {
                if (err) {
                  console.error('❌ Error deleting old results:', err);
                  return reject(err);
                }
                deletedResults = this.changes;
                console.log(`  ✓ Deleted ${deletedResults} old results`);

                // Delete old progress entries
                db.run(
                  `DELETE FROM scan_progress
                   WHERE session_id IN (
                     SELECT id FROM scan_sessions
                     WHERE started_at < (SELECT started_at FROM scan_sessions WHERE id = ?)
                   )`,
                  [cutoffId],
                  (err) => {
                    if (err) {
                      console.error('❌ Error deleting old progress:', err);
                      return reject(err);
                    }

                    // Delete old sessions
                    db.run(
                      `DELETE FROM scan_sessions
                       WHERE started_at < (SELECT started_at FROM scan_sessions WHERE id = ?)`,
                      [cutoffId],
                      function(err) {
                        if (err) {
                          console.error('❌ Error deleting old sessions:', err);
                          return reject(err);
                        }
                        deletedSessions = this.changes;
                        console.log(`  ✓ Deleted ${deletedSessions} old sessions`);
                        console.log(`✅ Cleanup complete: kept latest ${count} sessions`);
                        resolve({ deletedSessions, deletedResults });
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    });
  }

  /**
   * Delete a specific scan session and all its results
   * @param {string} sessionId - Session ID to delete
   * @returns {Promise<{deletedResults: number}>}
   */
  async deleteSession(sessionId) {
    return new Promise((resolve, reject) => {
      console.log(`🗑️ Deleting session: ${sessionId}...`);

      const db = this.db; // Capture db reference
      db.serialize(() => {
        let deletedResults = 0;

        // Delete results
        db.run(
          'DELETE FROM scan_results WHERE session_id = ?',
          [sessionId],
          function(err) {
            if (err) {
              console.error('❌ Error deleting results:', err);
              return reject(err);
            }
            deletedResults = this.changes;
            console.log(`  ✓ Deleted ${deletedResults} results`);

            // Delete progress
            db.run(
              'DELETE FROM scan_progress WHERE session_id = ?',
              [sessionId],
              (err) => {
                if (err) {
                  console.error('❌ Error deleting progress:', err);
                  return reject(err);
                }

                // Delete session
                db.run(
                  'DELETE FROM scan_sessions WHERE id = ?',
                  [sessionId],
                  function(err) {
                    if (err) {
                      console.error('❌ Error deleting session:', err);
                      return reject(err);
                    }
                    if (this.changes === 0) {
                      console.log(`  ⚠️ Session ${sessionId} not found`);
                    } else {
                      console.log(`  ✓ Deleted session ${sessionId}`);
                    }
                    console.log(`✅ Session deletion complete`);
                    resolve({ deletedResults });
                  }
                );
              }
            );
          }
        );
      });
    });
  }

  /**
   * Get list of all scan sessions with metadata
   * @returns {Promise<Array>} Array of session objects
   */
  async getAllSessions() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
           s.*,
           COUNT(r.id) as result_count,
           SUM(CASE WHEN r.success = 1 THEN 1 ELSE 0 END) as success_count,
           SUM(CASE WHEN r.success = 0 THEN 1 ELSE 0 END) as failed_count
         FROM scan_sessions s
         LEFT JOIN scan_results r ON s.id = r.session_id
         GROUP BY s.id
         ORDER BY s.started_at DESC`,
        [],
        (err, rows) => {
          if (err) {
            console.error('❌ Error fetching sessions:', err);
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  /**
   * Vacuum the database to reclaim disk space after deletions
   * @returns {Promise<void>}
   */
  async vacuum() {
    return new Promise((resolve, reject) => {
      console.log('🧹 Vacuuming database to reclaim disk space...');
      
      this.db.run('VACUUM', (err) => {
        if (err) {
          console.error('❌ Vacuum error:', err);
          reject(err);
        } else {
          console.log('✅ Database vacuumed successfully');
          resolve();
        }
      });
    });
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Database statistics
   */
  async getDatabaseStats() {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const stats = {};

        // Get session count
        this.db.get('SELECT COUNT(*) as count FROM scan_sessions', [], (err, row) => {
          if (err) return reject(err);
          stats.sessionCount = row.count;

          // Get result count
          this.db.get('SELECT COUNT(*) as count FROM scan_results', [], (err, row) => {
            if (err) return reject(err);
            stats.resultCount = row.count;

            // Get database file size
            const fs = require('fs');
            try {
              const dbStats = fs.statSync(this.dbPath);
              stats.fileSizeBytes = dbStats.size;
              stats.fileSizeMB = (dbStats.size / (1024 * 1024)).toFixed(2);
            } catch (err) {
              stats.fileSizeBytes = 0;
              stats.fileSizeMB = '0.00';
            }

            // Get oldest and newest session dates
            this.db.get(
              'SELECT MIN(started_at) as oldest, MAX(started_at) as newest FROM scan_sessions',
              [],
              (err, row) => {
                if (err) return reject(err);
                stats.oldestSession = row.oldest;
                stats.newestSession = row.newest;

                resolve(stats);
              }
            );
          });
        });
      });
    });
  }


  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else {
            console.log('✅ Database closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = ResultsDatabase;