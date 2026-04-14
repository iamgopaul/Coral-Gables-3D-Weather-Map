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
 * Build playback snapshots from per-station Open-Meteo hourly rows (UTC-aligned timestamps).
 * Requires every station to have succeeded and at least one common hour across all stations.
 * @param {object[]} batchResults — rows from `fetchBatchHistoricalHourly` (`weatherService.js`)
 * @param {number} retentionMs — wall-clock window ending at `nowMs` (e.g. {@link CONFIG.HISTORICAL_DATA_RETENTION})
 * @param {number} [nowMs=Date.now()]
 * @returns {object[]} `{ timestamp, data }[]` sorted by `timestamp` ascending
 */
export function buildSnapshotsFromHistoricalHourly(batchResults, retentionMs, nowMs = Date.now()) {
    if (!batchResults || batchResults.length === 0) {
        return [];
    }

    const successful = batchResults.filter(
        (r) => r && r.success && Array.isArray(r.hourly) && r.hourly.length > 0
    );
    if (successful.length !== batchResults.length) {
        return [];
    }

    const toHourMap = (hourly) => {
        const m = new Map();
        for (const row of hourly) {
            const ts = Number(row.timestamp);
            if (Number.isFinite(ts)) {
                m.set(ts, row);
            }
        }
        return m;
    };

    const maps = successful.map((r) => toHourMap(r.hourly));
    let common = new Set(maps[0].keys());
    for (let i = 1; i < maps.length; i++) {
        const next = new Set();
        for (const t of common) {
            if (maps[i].has(t)) {
                next.add(t);
            }
        }
        common = next;
    }

    const minT = nowMs - retentionMs;
    const times = Array.from(common)
        .filter((t) => t >= minT && t <= nowMs)
        .sort((a, b) => a - b);

    if (times.length === 0) {
        return [];
    }

    return times.map((t) => ({
        timestamp: t,
        data: successful.map((r, idx) => {
            const row = maps[idx].get(t);
            return {
                pointId: r.pointId,
                latitude: r.latitude,
                longitude: r.longitude,
                success: true,
                temperature: row.temperature,
                feelsLike: row.feelsLike,
                humidity: row.humidity,
                pressure: row.pressure,
                windSpeed: row.windSpeed,
                windDirection: row.windDirection,
                windGust: row.windGust,
                precipitation: row.precipitation,
                weather: row.weather,
                weatherDescription: row.weatherDescription,
                source: row.source
            };
        })
    }));
}

/**
 * Slider 0–100 maps linearly across wall time `[nowMs - retentionMs, nowMs]`, then picks the
 * snapshot whose `timestamp` is closest (same rule as {@link getSnapshotAtTime}).
 * @param {object[]} snapshots — sorted ascending by `timestamp` (typical playback list)
 * @param {number} sliderPercent — 0–100 from `<input type="range">`
 * @param {number} retentionMs
 * @param {number} [nowMs=Date.now()]
 * @returns {number} index into `snapshots`
 */
export function getSnapshotIndexForTimelineSlider(snapshots, sliderPercent, retentionMs, nowMs = Date.now()) {
    if (!snapshots || snapshots.length === 0) {
        return 0;
    }
    if (snapshots.length === 1) {
        return 0;
    }
    const p = Math.max(0, Math.min(100, Number(sliderPercent))) / 100;
    const ret = Number(retentionMs);
    if (!Number.isFinite(ret) || ret <= 0) {
        return Math.round(p * (snapshots.length - 1));
    }
    const minT = nowMs - ret;
    const targetT = minT + p * ret;
    const snap = getSnapshotAtTime(snapshots, targetT);
    if (!snap) {
        return snapshots.length - 1;
    }
    const idx = snapshots.indexOf(snap);
    return idx >= 0 ? idx : snapshots.length - 1;
}

/**
 * Where a snapshot sits on the 0–100 slider for a fixed `[now - retention, now]` window.
 * @param {{ timestamp?: number }} snapshot
 * @param {number} retentionMs
 * @param {number} [nowMs=Date.now()]
 * @returns {number} 0–100
 */
export function getTimelineSliderPercentForSnapshot(snapshot, retentionMs, nowMs = Date.now()) {
    const ts = Number(snapshot?.timestamp);
    const ret = Number(retentionMs);
    if (!Number.isFinite(ts) || !Number.isFinite(ret) || ret <= 0) {
        return 100;
    }
    const minT = nowMs - ret;
    const pct = ((ts - minT) / ret) * 100;
    return Math.max(0, Math.min(100, pct));
}

/**
 * Keep only frames with `timestamp` in `[nowMs - retentionMs, nowMs]` (48h window ending at **now**).
 * @param {object[]} snapshots
 * @param {number} retentionMs
 * @param {number} [nowMs=Date.now()]
 */
export function clipSnapshotsToRetentionWindow(snapshots, retentionMs, nowMs = Date.now()) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
        return [];
    }
    const ret = Number(retentionMs);
    const now = Number(nowMs);
    if (!Number.isFinite(ret) || ret <= 0 || !Number.isFinite(now)) {
        return snapshots.slice();
    }
    const minT = now - ret;
    return snapshots.filter((s) => {
        const t = Number(s?.timestamp);
        return Number.isFinite(t) && t >= minT && t <= now;
    });
}

/**
 * Append one frame at `nowMs` using live `samplingPoints` weather so the timeline ends at **current**,
 * when the last stored frame is older than `minGapMs` (e.g. hourly rows end at last full hour).
 * @param {object[]} snapshots — ascending by `timestamp`
 * @param {object[]} samplingPoints — `{ id, latitude, longitude, weatherData }`
 * @param {{ nowMs?: number, minGapMs?: number }} [opts]
 */
export function appendLiveNowSnapshotIfStale(snapshots, samplingPoints, opts = {}) {
    const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
    const minGapMs = opts.minGapMs != null ? Math.max(0, Number(opts.minGapMs)) : 120_000;
    const list = Array.isArray(snapshots) ? snapshots.slice() : [];
    if (list.length === 0 || !Array.isArray(samplingPoints) || samplingPoints.length === 0) {
        return list;
    }
    const last = list[list.length - 1];
    const lastTs = Number(last?.timestamp);
    if (Number.isFinite(lastTs) && nowMs - lastTs < minGapMs) {
        return list;
    }

    const data = [];
    for (const p of samplingPoints) {
        if (!p || !p.weatherData || p.weatherData.error) {
            continue;
        }
        const wd = p.weatherData;
        data.push({
            pointId: p.id,
            latitude: p.latitude,
            longitude: p.longitude,
            success: true,
            temperature: wd.temperature,
            feelsLike: wd.feelsLike,
            humidity: wd.humidity,
            pressure: wd.pressure,
            windSpeed: wd.windSpeed,
            windDirection: wd.windDirection,
            windGust: wd.windGust,
            precipitation: wd.precipitation,
            weather: wd.weather,
            weatherDescription: wd.weatherDescription,
            source: wd.source
        });
    }
    if (data.length === 0) {
        return list;
    }
    list.push({ timestamp: nowMs, data });
    return list;
}

/**
 * Clip to `[now - retention, now]`, append live **now** if needed, clip again, sort ascending.
 */
export function finalizePlaybackSnapshots(snapshots, samplingPoints, retentionMs, nowMs = Date.now()) {
    let s = clipSnapshotsToRetentionWindow(snapshots, retentionMs, nowMs);
    s = appendLiveNowSnapshotIfStale(s, samplingPoints, { nowMs, minGapMs: 120_000 });
    s = clipSnapshotsToRetentionWindow(s, retentionMs, nowMs);
    return s.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
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
