import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getSnapshotAtTime,
    getForecastData,
    formatTimestamp,
    interpolateSnapshots,
    buildSnapshotsFromHistoricalHourly,
    getSnapshotIndexForTimelineSlider,
    getTimelineSliderPercentForSnapshot,
    clipSnapshotsToRetentionWindow,
    finalizePlaybackSnapshots
} from '../js/features/timeFeatures.js';

describe('clipSnapshotsToRetentionWindow', () => {
    it('keeps only frames between now-retention and now', () => {
        const now = 1_000_000;
        const ret = 100_000;
        const snaps = [
            { timestamp: now - ret - 1, data: [] },
            { timestamp: now - ret + 1, data: [] },
            { timestamp: now, data: [] },
            { timestamp: now + 1, data: [] }
        ];
        const out = clipSnapshotsToRetentionWindow(snaps, ret, now);
        expect(out).toHaveLength(2);
        expect(out[0].timestamp).toBe(now - ret + 1);
        expect(out[1].timestamp).toBe(now);
    });
});

describe('finalizePlaybackSnapshots', () => {
    it('appends live now when last frame is older than min gap', () => {
        const now = 5_000_000;
        const ret = 200_000;
        const snaps = [{ timestamp: now - 200_000, data: [{ pointId: 'a', success: true, temperature: 1 }] }];
        const points = [
            {
                id: 'a',
                latitude: 1,
                longitude: 2,
                weatherData: { temperature: 99, humidity: 50, windSpeed: 1, pressure: 1000, error: false }
            }
        ];
        const out = finalizePlaybackSnapshots(snaps, points, ret, now);
        expect(out[out.length - 1].timestamp).toBe(now);
        expect(out[out.length - 1].data[0].temperature).toBe(99);
    });
});

describe('timeline slider (wall clock)', () => {
    const retention = 48 * 3600000;

    it('maps slider 0 to oldest frame in window and 100 to newest by timestamp', () => {
        const now = 10_000_000;
        const snaps = [
            { timestamp: now - retention + 3600000, data: [] },
            { timestamp: now - retention + 24 * 3600000, data: [] },
            { timestamp: now - 1000, data: [] }
        ];
        expect(getSnapshotIndexForTimelineSlider(snaps, 0, retention, now)).toBe(0);
        expect(getSnapshotIndexForTimelineSlider(snaps, 100, retention, now)).toBe(2);
        const mid = getSnapshotIndexForTimelineSlider(snaps, 50, retention, now);
        expect(mid).toBe(1);
    });

    it('maps snapshot timestamp to slider percent', () => {
        const now = 10_000_000;
        const snap = { timestamp: now - retention / 2 };
        expect(getTimelineSliderPercentForSnapshot(snap, retention, now)).toBeCloseTo(50, 5);
        expect(getTimelineSliderPercentForSnapshot({ timestamp: now }, retention, now)).toBe(100);
    });
});

describe('getSnapshotAtTime', () => {
    it('returns null for empty or invalid target', () => {
        expect(getSnapshotAtTime([], 1000)).toBeNull();
        expect(getSnapshotAtTime([{ timestamp: 100 }], NaN)).toBeNull();
    });

    it('picks closest valid snapshot by timestamp', () => {
        const a = { timestamp: 1000, data: [] };
        const b = { timestamp: 2000, data: [] };
        expect(getSnapshotAtTime([a, b], 1600)).toBe(b);
        expect(getSnapshotAtTime([a, b], 1100)).toBe(a);
    });

    it('skips snapshots with invalid timestamps', () => {
        const bad = { timestamp: 'x' };
        const good = { timestamp: 5000 };
        expect(getSnapshotAtTime([bad, good], 5000)).toBe(good);
    });
});

describe('getForecastData', () => {
    const base = 1_704_000_000_000;

    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(base);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null when no results', () => {
        expect(getForecastData(null, 3)).toBeNull();
        expect(getForecastData([], 3)).toBeNull();
    });

    it('selects forecast period closest to target time', () => {
        const threeHoursMs = 3 * 60 * 60 * 1000;
        const p1 = { timestamp: base + 1 * 3600 * 1000, temperature: 70 };
        const p2 = { timestamp: base + threeHoursMs, temperature: 72 };
        const out = getForecastData(
            [
                {
                    pointId: 'center',
                    forecasts: [p1, p2],
                    source: 'Test'
                }
            ],
            3
        );
        expect(out).toHaveLength(1);
        expect(out[0].temperature).toBe(72);
        expect(out[0].pointId).toBe('center');
    });

    it('returns error object when forecasts array is empty', () => {
        const out = getForecastData([{ pointId: 'a', forecasts: [], source: 'X' }], 1);
        expect(out[0].success).toBe(false);
        expect(out[0].error).toBe('no_forecast_periods');
    });
});

describe('formatTimestamp', () => {
    it('returns em dash for invalid input', () => {
        expect(formatTimestamp('bad')).toBe('—');
        expect(formatTimestamp(NaN)).toBe('—');
    });

    it('formats a known instant', () => {
        const s = formatTimestamp(Date.UTC(2024, 0, 15, 14, 30, 0));
        expect(s).toMatch(/Jan/);
        expect(s).toMatch(/15/);
    });
});

describe('buildSnapshotsFromHistoricalHourly', () => {
    it('returns empty when any station failed or hourly missing', () => {
        expect(
            buildSnapshotsFromHistoricalHourly(
                [
                    { pointId: 'a', success: true, hourly: [{ timestamp: 1 }] },
                    { pointId: 'b', success: false }
                ],
                48 * 3600000
            )
        ).toEqual([]);
    });

    it('builds aligned snapshots for common timestamps within retention', () => {
        const t0 = 1_000_000;
        const t1 = t0 + 3600000;
        const row = (ts) => ({
            timestamp: ts,
            temperature: 70,
            feelsLike: 70,
            humidity: 50,
            pressure: 1013,
            windSpeed: 5,
            windDirection: 180,
            windGust: 10,
            precipitation: 0,
            weather: 'clear',
            weatherDescription: 'Clear',
            source: 'Open-Meteo'
        });
        const batch = [
            {
                pointId: 'a',
                latitude: 1,
                longitude: 2,
                success: true,
                hourly: [row(t0), row(t1)]
            },
            {
                pointId: 'b',
                latitude: 3,
                longitude: 4,
                success: true,
                hourly: [row(t0), row(t1)]
            }
        ];
        const now = t1 + 1000;
        const snaps = buildSnapshotsFromHistoricalHourly(batch, 48 * 3600000, now);
        expect(snaps).toHaveLength(2);
        expect(snaps[0].timestamp).toBe(t0);
        expect(snaps[0].data).toHaveLength(2);
        expect(snaps[0].data[0].pointId).toBe('a');
        expect(snaps[0].data[1].pointId).toBe('b');
        expect(snaps[1].data[0].temperature).toBe(70);
    });
});

describe('interpolateSnapshots', () => {
    it('returns single snapshot when other is missing', () => {
        const a = { timestamp: 0, data: [{ x: 1 }] };
        expect(interpolateSnapshots(a, null)).toBe(a);
        expect(interpolateSnapshots(null, a)).toBe(a);
    });

    it('interpolates numeric fields at t=0.5', () => {
        const s1 = {
            timestamp: 0,
            data: [
                {
                    temperature: 60,
                    humidity: 40,
                    windSpeed: 10,
                    pressure: 1000,
                    error: false
                }
            ]
        };
        const s2 = {
            timestamp: 1000,
            data: [
                {
                    temperature: 80,
                    humidity: 60,
                    windSpeed: 20,
                    pressure: 1010,
                    error: false
                }
            ]
        };
        const mid = interpolateSnapshots(s1, s2, 0.5);
        expect(mid.data[0].temperature).toBe(70);
        expect(mid.data[0].humidity).toBe(50);
    });
});
