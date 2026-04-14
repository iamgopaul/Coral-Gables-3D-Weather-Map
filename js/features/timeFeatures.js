import { CONFIG } from '../config.js';
import * as DB from '../storage/db.js';

/**
 * Time-based features: Historical playback, forecast mode, split-screen
 */

/**
 * Get historical data for playback
 */
export async function getHistoricalSnapshots() {
    const endTime = Date.now();
    const startTime = endTime - CONFIG.HISTORICAL_DATA_RETENTION;
    
    try {
        const snapshots = await DB.getWeatherHistory(startTime, endTime);
        return snapshots.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
        console.error('Failed to get historical snapshots:', error);
        return [];
    }
}

/**
 * Get snapshot at specific timestamp
 */
export function getSnapshotAtTime(snapshots, targetTimestamp) {
    if (!snapshots || snapshots.length === 0) {
        return null;
    }
    
    // Find closest snapshot
    let closest = snapshots[0];
    let minDiff = Math.abs(closest.timestamp - targetTimestamp);
    
    for (const snapshot of snapshots) {
        const diff = Math.abs(snapshot.timestamp - targetTimestamp);
        if (diff < minDiff) {
            minDiff = diff;
            closest = snapshot;
        }
    }
    
    return closest;
}

/**
 * Calculate interpolated snapshot between two timestamps
 */
export function interpolateSnapshots(snapshot1, snapshot2, t) {
    if (!snapshot1 || !snapshot2) {
        return snapshot1 || snapshot2;
    }
    
    // t is between 0 and 1
    const interpolatedData = snapshot1.data.map((point1, index) => {
        const point2 = snapshot2.data[index];
        
        if (!point1 || !point2 || point1.error || point2.error) {
            return point1 || point2;
        }
        
        return {
            ...point1,
            temperature: point1.temperature + t * (point2.temperature - point1.temperature),
            humidity: point1.humidity + t * (point2.humidity - point1.humidity),
            windSpeed: point1.windSpeed + t * (point2.windSpeed - point1.windSpeed),
            pressure: point1.pressure + t * (point2.pressure - point1.pressure)
        };
    });
    
    return {
        timestamp: snapshot1.timestamp + t * (snapshot2.timestamp - snapshot1.timestamp),
        data: interpolatedData
    };
}

/**
 * Playback controller
 */
export class PlaybackController {
    constructor(snapshots, onUpdate) {
        this.snapshots = snapshots;
        this.onUpdate = onUpdate;
        this.currentIndex = snapshots.length - 1;
        this.isPlaying = false;
        this.speed = 2; // 2x speed default
        this.interval = null;
    }
    
    play() {
        if (this.isPlaying || !this.snapshots || this.snapshots.length === 0) {
            return;
        }
        
        this.isPlaying = true;
        const baseInterval = 1000; // 1 second per snapshot at 1x
        const interval = baseInterval / this.speed;
        
        this.interval = setInterval(() => {
            this.currentIndex++;
            
            if (this.currentIndex >= this.snapshots.length) {
                this.currentIndex = 0; // Loop back to beginning
            }
            
            const snapshot = this.snapshots[this.currentIndex];
if (this.onUpdate) {
                this.onUpdate(snapshot, this.currentIndex, this.snapshots.length);
            }
        }, interval);
    }
    
    pause() {
        this.isPlaying = false;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
    
    setSpeed(speed) {
        const wasPlaying = this.isPlaying;
        this.pause();
        this.speed = speed;
        if (wasPlaying) {
            this.play();
        }
    }
    
    seek(index) {
        this.currentIndex = Math.max(0, Math.min(index, this.snapshots.length - 1));
        const snapshot = this.snapshots[this.currentIndex];
        if (this.onUpdate) {
            this.onUpdate(snapshot, this.currentIndex, this.snapshots.length);
        }
    }
    
    seekToTime(timestamp) {
        const snapshot = getSnapshotAtTime(this.snapshots, timestamp);
        if (snapshot) {
            const index = this.snapshots.indexOf(snapshot);
            this.seek(index);
        }
    }
    
    getCurrentSnapshot() {
        return this.snapshots[this.currentIndex];
    }
    
    destroy() {
        this.pause();
    }
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Get time ago string
 */
export function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 60) {
        return `${minutes} min ago`;
    } else if (hours < 24) {
        return `${hours} hr ago`;
    } else {
        return `${days} day${days > 1 ? 's' : ''} ago`;
    }
}

/**
 * Get forecast data at specific offset
 */
export function getForecastData(forecastResults, hoursAhead) {
    if (!forecastResults || forecastResults.length === 0) {
        return null;
    }
    
    const targetTime = Date.now() + (hoursAhead * 60 * 60 * 1000);
    
    return forecastResults.map(pointForecast => {
        if (!pointForecast.forecasts || pointForecast.error) {
            return pointForecast;
        }
        
        // Find closest forecast
        let closest = pointForecast.forecasts[0];
        let minDiff = Math.abs(closest.timestamp - targetTime);
        
        for (const forecast of pointForecast.forecasts) {
            const diff = Math.abs(forecast.timestamp - targetTime);
            if (diff < minDiff) {
                minDiff = diff;
                closest = forecast;
            }
        }
        
        return {
            pointId: pointForecast.pointId,
            ...closest,
            source: pointForecast.source
        };
    });
}
