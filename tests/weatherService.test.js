import { describe, it, expect } from 'vitest';
import {
    MERGE_PRIORITY_DEFAULT,
    MERGE_PRIORITY_NOAA_FIRST,
    mergeWeatherData,
    findClosestForecastPeriodByTime,
    enrichForecastPressureFromSources,
    enrichForecastWindGustFromSources
} from '../js/api/weatherService.js';

describe('mergeWeatherData', () => {
    it('prefers higher-priority source per field when priorities differ', () => {
        const a = {
            source: 'Open-Meteo',
            temperature: 72,
            pressure: 1015
        };
        const b = {
            source: 'OpenWeatherMap',
            temperature: 68,
            pressure: 1015
        };
        const merged = mergeWeatherData([a, b], MERGE_PRIORITY_DEFAULT);
        expect(merged.temperature).toBe(68);
        expect(merged.pressure).toBe(1015);
    });

    it('skips null, undefined, and placeholder weather strings', () => {
        const low = {
            source: 'Open-Meteo',
            temperature: 70,
            weatherDescription: 'unknown'
        };
        const high = {
            source: 'OpenWeatherMap',
            temperature: null,
            weatherDescription: 'Partly cloudy'
        };
        const merged = mergeWeatherData([low, high], MERGE_PRIORITY_DEFAULT);
        expect(merged.temperature).toBe(70);
        expect(merged.weatherDescription).toBe('Partly cloudy');
    });

    it('NOAA-first merge prefers NOAA fields when configured', () => {
        const noaa = {
            source: 'NOAA',
            temperature: 75,
            windSpeed: 6
        };
        const owm = {
            source: 'OpenWeatherMap',
            temperature: 68,
            windSpeed: 12
        };
        const merged = mergeWeatherData([owm, noaa], MERGE_PRIORITY_NOAA_FIRST);
        expect(merged.temperature).toBe(75);
        expect(merged.windSpeed).toBe(6);
    });
});

describe('findClosestForecastPeriodByTime', () => {
    const t0 = Date.parse('2026-01-15T12:00:00Z');
    const t1 = Date.parse('2026-01-15T15:00:00Z');
    const t2 = Date.parse('2026-01-15T18:00:00Z');

    const periods = [
        { timestamp: t0, pressure: 1000 },
        { timestamp: t1, pressure: 1013 },
        { timestamp: t2, pressure: 1020 }
    ];

    it('returns null for empty or invalid target', () => {
        expect(findClosestForecastPeriodByTime([], t1)).toBeNull();
        expect(findClosestForecastPeriodByTime(periods, NaN)).toBeNull();
        expect(findClosestForecastPeriodByTime(periods, Number('x'))).toBeNull();
    });

    it('returns the period with closest timestamp', () => {
        expect(findClosestForecastPeriodByTime(periods, t1 + 1)).toEqual(periods[1]);
        expect(findClosestForecastPeriodByTime(periods, t0 - 1)).toEqual(periods[0]);
    });

    it('skips periods with invalid timestamps', () => {
        const messy = [
            { timestamp: NaN, pressure: 1 },
            { timestamp: t1, pressure: 1013 }
        ];
        expect(findClosestForecastPeriodByTime(messy, t1)).toEqual(messy[1]);
    });
});

describe('enrichForecastPressureFromSources', () => {
    const t0 = Date.parse('2026-01-15T12:00:00Z');
    const t1 = Date.parse('2026-01-15T15:00:00Z');

    it('fills missing pressure from Open-Meteo then rounds', () => {
        const best = {
            forecasts: [
                { timestamp: t0, temperature: 80, pressure: null },
                { timestamp: t1, temperature: 72, pressure: null }
            ]
        };
        const sources = [
            {
                source: 'NOAA',
                forecasts: best.forecasts.map((p) => ({ ...p }))
            },
            {
                source: 'Open-Meteo',
                forecasts: [
                    { timestamp: t0, pressure: 1012.7 },
                    { timestamp: t1, pressure: 1014.2 }
                ]
            }
        ];
        enrichForecastPressureFromSources(best, sources);
        expect(best.forecasts[0].pressure).toBe(1013);
        expect(best.forecasts[1].pressure).toBe(1014);
    });

    it('does not overwrite existing finite pressure', () => {
        const best = {
            forecasts: [{ timestamp: t0, pressure: 1000 }]
        };
        const sources = [
            {
                source: 'Open-Meteo',
                forecasts: [{ timestamp: t0, pressure: 2000 }]
            }
        ];
        enrichForecastPressureFromSources(best, sources);
        expect(best.forecasts[0].pressure).toBe(1000);
    });

    it('falls back to OpenWeatherMap when Open-Meteo has no usable pressure', () => {
        const best = {
            forecasts: [{ timestamp: t0, pressure: null }]
        };
        const sources = [
            { source: 'NOAA', forecasts: [...best.forecasts] },
            {
                source: 'Open-Meteo',
                forecasts: [{ timestamp: t0, pressure: null }]
            },
            { source: 'OpenWeatherMap', forecasts: [{ timestamp: t0, pressure: 1005.4 }] }
        ];
        enrichForecastPressureFromSources(best, sources);
        expect(best.forecasts[0].pressure).toBe(1005);
    });

    it('no-ops when best or sources are empty', () => {
        enrichForecastPressureFromSources(null, []);
        enrichForecastPressureFromSources({ forecasts: [] }, [
            { source: 'Open-Meteo', forecasts: [{ timestamp: t0, pressure: 1013 }] }
        ]);
    });
});

describe('enrichForecastWindGustFromSources', () => {
    const t0 = Date.parse('2026-01-15T12:00:00Z');
    const t1 = Date.parse('2026-01-15T15:00:00Z');

    it('fills missing windGust from Open-Meteo (mph, one decimal)', () => {
        const best = {
            forecasts: [
                { timestamp: t0, windSpeed: 10, windGust: null },
                { timestamp: t1, windSpeed: 8, windGust: null }
            ]
        };
        const sources = [
            { source: 'NOAA', forecasts: best.forecasts.map((p) => ({ ...p })) },
            {
                source: 'Open-Meteo',
                forecasts: [
                    { timestamp: t0, windGust: 18.26 },
                    { timestamp: t1, windGust: 22.44 }
                ]
            }
        ];
        enrichForecastWindGustFromSources(best, sources);
        expect(best.forecasts[0].windGust).toBe(18.3);
        expect(best.forecasts[1].windGust).toBe(22.4);
    });

    it('does not overwrite existing finite windGust', () => {
        const best = {
            forecasts: [{ timestamp: t0, windGust: 15 }]
        };
        const sources = [
            {
                source: 'Open-Meteo',
                forecasts: [{ timestamp: t0, windGust: 99 }]
            }
        ];
        enrichForecastWindGustFromSources(best, sources);
        expect(best.forecasts[0].windGust).toBe(15);
    });

    it('falls back to OpenWeatherMap when Open-Meteo has no usable gust', () => {
        const best = {
            forecasts: [{ timestamp: t0, windGust: null }]
        };
        const sources = [
            { source: 'NOAA', forecasts: [...best.forecasts] },
            { source: 'Open-Meteo', forecasts: [{ timestamp: t0, windGust: null }] },
            { source: 'OpenWeatherMap', forecasts: [{ timestamp: t0, windGust: 17.81 }] }
        ];
        enrichForecastWindGustFromSources(best, sources);
        expect(best.forecasts[0].windGust).toBe(17.8);
    });
});
