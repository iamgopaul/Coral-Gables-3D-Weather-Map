import { CONFIG } from '../config.js';
import * as DB from '../storage/db.js';

/**
 * @file Time-based features: historical snapshots from IndexedDB, forecast time selection,
 * `PlaybackController` for scrubbing, and helpers used by split-screen / forecast modes.
 */

/**
 * Load weather snapshots from IndexedDB within the configured retention window.
 * @returns {Promise<object[]>} Sorted by `timestamp` ascending; `[]` on failure (errors logged).
 */
export async function getHistoricalSnapshots() {
    const endTime = Date.now();
    const startTime = endTime - CONFIG.HISTORICAL_DATA_RETENTION;

    try {
        const snapshots = await DB.getWeatherHistory(startTime, endTime);
        return snapshots.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        console.error('[historical] Failed to get snapshots:', msg, error);
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

    const target = Number(targetTimestamp);
    if (!Number.isFinite(target)) {
        return null;
    }

    let closest = null;
    let minDiff = Infinity;

    for (const snapshot of snapshots) {
        const ts = Number(snapshot?.timestamp);
        if (!Number.isFinite(ts)) {
            continue;
        }
        const diff = Math.abs(ts - target);
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
    if (!Array.isArray(snapshot1.data) || !Array.isArray(snapshot2.data)) {
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
 * Steps through `snapshots` on an interval for historical playback UI.
 */
export class PlaybackController {
    constructor(snapshots, onUpdate) {
        this.snapshots = snapshots && snapshots.length ? snapshots : [];
        this.onUpdate = onUpdate;
        this.currentIndex = this.snapshots.length > 0 ? this.snapshots.length - 1 : 0;
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
            if (this.onUpdate && snapshot) {
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
        if (!this.snapshots || this.snapshots.length === 0) {
            return;
        }
        this.currentIndex = Math.max(0, Math.min(index, this.snapshots.length - 1));
        const snapshot = this.snapshots[this.currentIndex];
        if (this.onUpdate && snapshot) {
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

    /** Index of the frame currently shown (for preserving position after snapshot reload). */
    getCurrentIndex() {
        return this.currentIndex;
    }

    destroy() {
        this.pause();
    }
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp) {
    const ms = Number(timestamp);
    if (!Number.isFinite(ms)) {
        return '—';
    }
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
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
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
        return '';
    }
    const now = Date.now();
    const diff = now - ts;

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
 * For each station in `forecastResults`, pick the forecast period whose `timestamp` is **closest**
 * to `Date.now() + hoursAhead` (used for 3h / 24h modes).
 * @param {object[]|null} forecastResults — Batch rows from `fetchBatchForecast` (`forecasts` arrays per point)
 * @param {number} hoursAhead — e.g. `3` or `24`
 * @returns {object[]|null} Per-point merged period objects or `{ success: false, error }` rows
 */
export function getForecastData(forecastResults, hoursAhead) {
    if (!forecastResults || forecastResults.length === 0) {
        return null;
    }

    const targetTime = Date.now() + hoursAhead * 60 * 60 * 1000;

    return forecastResults.map((pointForecast) => {
        if (!pointForecast || pointForecast.error) {
            return pointForecast;
        }
        const periods = pointForecast.forecasts;
        if (!Array.isArray(periods) || periods.length === 0) {
            return {
                pointId: pointForecast.pointId,
                error: 'no_forecast_periods',
                success: false
            };
        }

        let closest = null;
        let minDiff = Infinity;

        for (const forecast of periods) {
            const ts = Number(forecast.timestamp);
            if (!Number.isFinite(ts)) {
                continue;
            }
            const diff = Math.abs(ts - targetTime);
            if (closest == null || diff < minDiff) {
                minDiff = diff;
                closest = forecast;
            }
        }

        if (closest == null) {
            return {
                pointId: pointForecast.pointId,
                error: 'no_valid_forecast_times',
                success: false
            };
        }

        return {
            pointId: pointForecast.pointId,
            ...closest,
            source: pointForecast.source
        };
    });
}
