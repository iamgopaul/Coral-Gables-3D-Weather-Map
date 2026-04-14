export function normalizeApiSourceName(s) {
    const raw = String(s || '').trim();
    if (!raw) return '';
    const key = raw.toLowerCase();
    if (key === 'openweathermap' || key === 'open weather map' || key === 'openweather') return 'OpenWeather';
    if (key === 'open-meteo' || key === 'openmeteo' || key === 'open meteo') return 'Open Meteo';
    if (key === 'noaa' || key.includes('weather.gov') || key.includes('nws')) return 'NOAA';
    return raw;
}

export function collectActiveApiSourcesForFrame(weatherResults, canonicalCoralGables) {
    const set = new Set();
    const addFromMerged = (merged) => {
        if (!merged) return;
        const src = merged.sources || merged.source || '';
        String(src)
            .split(',')
            .map((x) => normalizeApiSourceName(x))
            .filter(Boolean)
            .forEach((x) => set.add(x));
    };
    for (const r of weatherResults || []) {
        if (r && r.success && r.source !== 'sample-data') {
            addFromMerged(r);
        }
    }
    addFromMerged(canonicalCoralGables);
    const order = ['OpenWeather', 'Open Meteo', 'NOAA'];
    const arr = [...set];
    arr.sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });
    return arr;
}

export function updateDataSourceDisplay({ state, debugLog, successful, failed, activeApiSources = [] }) {
    const total = state.samplingPoints.length;
    const sum = successful + failed;
    const isSampleData = state.samplingPoints.some((p) => p.weatherData?.source === 'sample-data');
    const hasPartial = !isSampleData && successful > 0 && failed > 0;

    let status = 'Live (APIs)';
    if (isSampleData) {
        status = 'Sample / demo (not live observations)';
    } else if (successful === 0 && failed > 0) {
        status = 'No live station data';
    } else if (hasPartial) {
        status = 'Live (partial — some stations failed)';
    }

    const srcEl = document.getElementById('sourceStatus');
    const apisEl = document.getElementById('apiSources');
    const okEl = document.getElementById('successCount');
    const badEl = document.getElementById('failedCount');
    const totEl = document.getElementById('stationTotal');
    if (srcEl) srcEl.textContent = status;
    if (apisEl) {
        apisEl.textContent = isSampleData || !activeApiSources?.length ? '' : activeApiSources.join(', ');
    }
    if (okEl) okEl.textContent = String(successful);
    if (badEl) badEl.textContent = String(failed);
    if (totEl) totEl.textContent = String(total);

    if (sum !== total && total > 0) {
        debugLog?.(`⚠ Station count mismatch: ok+fail=${sum} vs points=${total}`, true);
    }
    if (isSampleData) {
        debugLog?.('ℹ️ Using sample data — real APIs unavailable for stations');
    }
}
