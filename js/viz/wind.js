import { CONFIG } from '../config.js';

/** Meteorological degrees (0–360, clockwise from N) → 16-point compass label for “wind from”. */
export function windDirectionToCompass16(degrees) {
    const dirs = [
        'N',
        'NNE',
        'NE',
        'ENE',
        'E',
        'ESE',
        'SE',
        'SSE',
        'S',
        'SSW',
        'SW',
        'WSW',
        'W',
        'WNW',
        'NW',
        'NNW'
    ];
    const d = ((Number(degrees) % 360) + 360) % 360;
    const idx = Math.round(d / 22.5) % 16;
    return dirs[idx];
}

/** Wind line rgba by speed bucket — matches `CONFIG.WIND_VECTOR_*` and temp legend palette */
function windVectorLineColor(mph) {
    const br = CONFIG.WIND_VECTOR_SPEED_BREAKS_MPH || [10, 20, 30];
    const cols = CONFIG.WIND_VECTOR_COLORS;
    if (!cols || cols.length < 4) {
        return [42, 188, 108, 225];
    }
    if (mph <= br[0]) {
        return [...cols[0]];
    }
    if (mph <= br[1]) {
        return [...cols[1]];
    }
    if (mph <= br[2]) {
        return [...cols[2]];
    }
    return [...cols[3]];
}

/**
 * Vector-mean wind over all sampling stations (meteorological “wind from” °, speed mph).
 * ū = mean(speed·sin θ), v̄ = mean(speed·cos θ) → resultant speed = √(ū²+v̄²), direction = atan2(ū,v̄).
 * Matches common “area mean wind” / resultant averaging (not a sum of speeds).
 *
 * @param {Array<any>} samplingPoints
 * @returns {{ speed: number, fromDeg: number } | null}
 */
function getMeanWindFromSamplingPoints(samplingPoints) {
    if (!samplingPoints?.length) {
        return null;
    }
    let sumSin = 0;
    let sumCos = 0;
    let n = 0;
    for (const p of samplingPoints) {
        const wd = p?.weatherData;
        if (!wd || wd.error) {
            continue;
        }
        const speed = Number(wd.windSpeed);
        const rawDir = wd.windDirection;
        if (!Number.isFinite(speed) || speed <= 0) {
            continue;
        }
        const deg = typeof rawDir === 'number' && Number.isFinite(rawDir) ? rawDir : Number(rawDir);
        if (!Number.isFinite(deg)) {
            continue;
        }
        const rad = (deg * Math.PI) / 180;
        sumSin += speed * Math.sin(rad);
        sumCos += speed * Math.cos(rad);
        n += 1;
    }
    if (n === 0) {
        return null;
    }
    const uBar = sumSin / n;
    const vBar = sumCos / n;
    const meanSpeed = Math.sqrt(uBar * uBar + vBar * vBar);
    if (!Number.isFinite(meanSpeed) || meanSpeed <= 0) {
        return null;
    }
    let fromDeg = (Math.atan2(uBar, vBar) * 180) / Math.PI;
    if (fromDeg < 0) {
        fromDeg += 360;
    }
    return { speed: meanSpeed, fromDeg };
}

/**
 * Render wind vectors based on sampling points (field arrows + Coral Gables indicator).
 * @param {object} args
 * @param {Array<any>} args.samplingPoints
 * @param {any} args.layersOverride
 * @param {any} args.state
 * @param {(msg:string,isErr?:boolean)=>void} args.debugLog
 */
export function renderWindVectors({ samplingPoints, layersOverride = null, state, debugLog }) {
    if (!samplingPoints || !Array.isArray(samplingPoints)) return;
    const layers = layersOverride || state?.layers;
    if (!layers || !layers.wind) return;

    const gridWindZ = 100;
    const maxGridLenDeg = 0.003;
    const gridRefSpeedMph = 40;

    // ArcGIS JS API is loaded globally from the js.arcgis.com script tag.
    require([
        'esri/Graphic',
        'esri/geometry/Polyline',
        'esri/symbols/LineSymbol3D',
        'esri/symbols/LineSymbol3DLayer',
        'esri/PopupTemplate'
    ], (Graphic, Polyline, LineSymbol3D, LineSymbol3DLayer, PopupTemplate) => {
        try {
            layers.wind.removeAll();
            let vectorsAdded = 0;

            samplingPoints.forEach((point) => {
                if (!point || !point.weatherData) return;
                const ws = point.weatherData.windSpeed;
                if (ws == null || ws === '' || Number(ws) <= 0) return;

                try {
                    const windSpeed = Number(ws);
                    const windFromDeg = Number(point.weatherData.windDirection) || 0;
                    // Downwind direction (where air is moving); “wind from” is meteorological convention.
                    const downDeg = (windFromDeg + 180) % 360;
                    const directionRad = (downDeg * Math.PI) / 180;

                    const arrowLength = Math.min(
                        maxGridLenDeg,
                        (windSpeed / gridRefSpeedMph) * maxGridLenDeg
                    );
                    const endLat = point.latitude + arrowLength * Math.cos(directionRad);
                    const endLon = point.longitude + arrowLength * Math.sin(directionRad);

                    const windColor = windVectorLineColor(windSpeed);
                    const lineWidthPx = Math.max(1.25, Math.min(6, windSpeed / 6.5));

                    const polyline = new Polyline({
                        paths: [
                            [
                                [point.longitude, point.latitude, gridWindZ],
                                [endLon, endLat, gridWindZ]
                            ]
                        ],
                        spatialReference: { wkid: 4326 }
                    });

                    const lineSymbol = new LineSymbol3D({
                        symbolLayers: [
                            new LineSymbol3DLayer({
                                material: { color: windColor },
                                size: lineWidthPx,
                                cap: 'round',
                                join: 'round',
                                marker: { type: 'style', style: 'arrow', placement: 'end' }
                            })
                        ]
                    });

                    const fromLabel = windDirectionToCompass16(windFromDeg);
                    const fromDegStr = String(Math.round(((windFromDeg % 360) + 360) % 360));

                    const graphic = new Graphic({
                        geometry: polyline,
                        symbol: lineSymbol,
                        attributes: {
                            pointId: point.id ?? '—',
                            windSpeedMph: windSpeed.toFixed(1),
                            windFromLabel: fromLabel,
                            windFromDegrees: fromDegStr
                        },
                        popupTemplate: new PopupTemplate({
                            title: 'Wind · {pointId}',
                            content:
                                '<div style="font-size:13px;line-height:1.45">' +
                                '<div><b>{windSpeedMph}</b> mph</div>' +
                                '<div>From <b>{windFromLabel}</b> ({windFromDegrees}°)</div>' +
                                '<div style="opacity:0.75;font-size:11px;margin-top:6px">Arrow points downwind (flow direction).</div>' +
                                '</div>'
                        })
                    });

                    layers.wind.add(graphic);
                    vectorsAdded++;
                } catch (err) {
                    console.error('Error adding wind vector:', err);
                }
            });

            /** City-scale indicator at {@link CONFIG.CORAL_GABLES_CENTER} — area mean, not the center station. */
            const cgWind = getMeanWindFromSamplingPoints(samplingPoints);
            if (cgWind && cgWind.speed > 0) {
                const { speed: cgSpeed, fromDeg: cgFrom } = cgWind;
                const downDeg = (cgFrom + 180) % 360;
                const rad = (downDeg * Math.PI) / 180;
                const z = CONFIG.CORAL_GABLES_WIND_ARROW_Z_METERS;
                const maxLen = CONFIG.CORAL_GABLES_WIND_ARROW_MAX_LEN_DEG;
                const len = Math.min(maxLen, (cgSpeed / gridRefSpeedMph) * maxLen);
                const lat0 = CONFIG.CORAL_GABLES_CENTER.latitude;
                const lon0 = CONFIG.CORAL_GABLES_CENTER.longitude;
                const endLat = lat0 + len * Math.cos(rad);
                const endLon = lon0 + len * Math.sin(rad);
                const cgColor = windVectorLineColor(cgSpeed);
                const cgWidth = Math.max(2, Math.min(10, cgSpeed / 4));

                const cgPoly = new Polyline({
                    paths: [
                        [
                            [lon0, lat0, z],
                            [endLon, endLat, z]
                        ]
                    ],
                    spatialReference: { wkid: 4326 }
                });
                const cgSymbol = new LineSymbol3D({
                    symbolLayers: [
                        new LineSymbol3DLayer({
                            material: { color: cgColor },
                            size: cgWidth,
                            cap: 'round',
                            join: 'round',
                            marker: { type: 'style', style: 'arrow', placement: 'end' }
                        })
                    ]
                });
                const compass = windDirectionToCompass16(cgFrom);
                const cgGraphic = new Graphic({
                    geometry: cgPoly,
                    symbol: cgSymbol,
                    attributes: {
                        kind: 'coral-gables-wind',
                        windSpeedMph: cgSpeed.toFixed(1),
                        windFromDegrees: String(Math.round(((cgFrom % 360) + 360) % 360)),
                        windFromLabel: compass
                    },
                    popupTemplate: new PopupTemplate({
                        title: 'Area wind (mean of stations)',
                        content:
                            '<div style="font-size:13px;line-height:1.45">' +
                            '<div><b>{windSpeedMph}</b> mph resultant</div>' +
                            '<div>From <b>{windFromLabel}</b> ({windFromDegrees}°)</div>' +
                            '<div style="opacity:0.75;font-size:11px;margin-top:6px">Vector average of all grid sampling points. Arrow shows downwind.</div>' +
                            '</div>'
                    })
                });
                layers.wind.add(cgGraphic);
            }

            if (vectorsAdded > 0 || (cgWind && cgWind.speed > 0)) {
                debugLog?.(
                    `💨 Wind vectors: ${vectorsAdded} field arrows` +
                        (cgWind && cgWind.speed > 0 ? ' + area-mean wind (city marker)' : '')
                );
            }
        } catch (windErr) {
            console.error('Wind rendering error:', windErr);
        }
    });
}
