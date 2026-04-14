import { CONFIG } from '../config.js';

/**
 * IndexedDB wrapper for storing weather data and alerts
 */

let db = null;

/**
 * Initialize IndexedDB
 */
export async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            // Create weather data store
            if (!database.objectStoreNames.contains(CONFIG.STORE_WEATHER_DATA)) {
                const weatherStore = database.createObjectStore(CONFIG.STORE_WEATHER_DATA, {
                    keyPath: 'id',
                    autoIncrement: true
                });
                weatherStore.createIndex('timestamp', 'timestamp', { unique: false });
                weatherStore.createIndex('pointId', 'pointId', { unique: false });
            }
            
            // Create alerts store
            if (!database.objectStoreNames.contains(CONFIG.STORE_ALERTS)) {
                const alertsStore = database.createObjectStore(CONFIG.STORE_ALERTS, {
                    keyPath: 'id'
                });
                alertsStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

/**
 * Store weather data snapshot
 */
export async function storeWeatherSnapshot(weatherData) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_WEATHER_DATA], 'readwrite');
        const store = transaction.objectStore(CONFIG.STORE_WEATHER_DATA);
        
        const snapshot = {
            timestamp: Date.now(),
            data: weatherData
        };
        
        const request = store.add(snapshot);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all weather snapshots within time range
 */
export async function getWeatherHistory(startTime, endTime) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_WEATHER_DATA], 'readonly');
        const store = transaction.objectStore(CONFIG.STORE_WEATHER_DATA);
        const index = store.index('timestamp');
        
        const range = IDBKeyRange.bound(startTime, endTime);
        const request = index.getAll(range);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get latest weather snapshot
 */
export async function getLatestSnapshot() {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_WEATHER_DATA], 'readonly');
        const store = transaction.objectStore(CONFIG.STORE_WEATHER_DATA);
        const index = store.index('timestamp');
        
        const request = index.openCursor(null, 'prev');
        
        request.onsuccess = () => {
            const cursor = request.result;
            resolve(cursor ? cursor.value : null);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Clean old weather data (outside retention period)
 */
export async function cleanOldData() {
    if (!db) await initDB();
    
    const cutoffTime = Date.now() - CONFIG.HISTORICAL_DATA_RETENTION;
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_WEATHER_DATA], 'readwrite');
        const store = transaction.objectStore(CONFIG.STORE_WEATHER_DATA);
        const index = store.index('timestamp');
        
        const range = IDBKeyRange.upperBound(cutoffTime);
        const request = index.openCursor(range);
        
        let deleteCount = 0;
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                cursor.delete();
                deleteCount++;
                cursor.continue();
            } else {
                console.log(`Cleaned ${deleteCount} old weather records`);
                resolve(deleteCount);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store alert
 */
export async function storeAlert(alert) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_ALERTS], 'readwrite');
        const store = transaction.objectStore(CONFIG.STORE_ALERTS);
        
        const alertWithTimestamp = {
            ...alert,
            storedAt: Date.now()
        };
        
        const request = store.put(alertWithTimestamp);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all active alerts
 */
export async function getActiveAlerts() {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_ALERTS], 'readonly');
        const store = transaction.objectStore(CONFIG.STORE_ALERTS);
        
        const request = store.getAll();
        
        request.onsuccess = () => {
            const now = Date.now();
            const activeAlerts = request.result.filter(alert => 
                alert.expires > now
            );
            resolve(activeAlerts);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Clear expired alerts
 */
export async function clearExpiredAlerts() {
    if (!db) await initDB();
    
    const now = Date.now();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([CONFIG.STORE_ALERTS], 'readwrite');
        const store = transaction.objectStore(CONFIG.STORE_ALERTS);
        
        const request = store.openCursor();
        let deleteCount = 0;
        
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                if (cursor.value.expires < now) {
                    cursor.delete();
                    deleteCount++;
                }
                cursor.continue();
            } else {
                console.log(`Cleared ${deleteCount} expired alerts`);
                resolve(deleteCount);
            }
        };
        request.onerror = () => reject(request.error);
    });
}
