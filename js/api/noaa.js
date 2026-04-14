import { CONFIG } from '../config.js';

/**
 * Fetch current weather from NOAA Weather.gov API
 */
export async function fetchCurrentWeather(latitude, longitude) {
    try {
        // Step 1: Get grid point metadata
        const pointsUrl = `${CONFIG.NOAA_POINTS}/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        const pointsResponse = await fetch(pointsUrl, {
            headers: {
                'User-Agent': 'CoralGablesWeatherGrid/1.0'
            }
        });
        
        if (!pointsResponse.ok) {
            throw new Error(`NOAA Points API error: ${pointsResponse.status}`);
        }
        
        const pointsData = await pointsResponse.json();
        
        // Step 2: Get observation stations
        const stationsUrl = pointsData.properties.observationStations;
        const stationsResponse = await fetch(stationsUrl, {
            headers: {
                'User-Agent': 'CoralGablesWeatherGrid/1.0'
            }
        });
        
        if (!stationsResponse.ok) {
            throw new Error(`NOAA Stations API error: ${stationsResponse.status}`);
        }
        
        const stationsData = await stationsResponse.json();
        
        // Step 3: Get latest observation from nearest station
        if (!stationsData.features || stationsData.features.length === 0) {
            throw new Error('No observation stations found');
        }
        
        const nearestStation = stationsData.features[0].id;
        const observationUrl = `${nearestStation}/observations/latest`;
        const observationResponse = await fetch(observationUrl, {
            headers: {
                'User-Agent': 'CoralGablesWeatherGrid/1.0'
            }
        });
        
        if (!observationResponse.ok) {
            throw new Error(`NOAA Observation API error: ${observationResponse.status}`);
        }
        
        const observationData = await observationResponse.json();
        return parseNOAAObservation(observationData);
    } catch (error) {
        console.error('NOAA fetch error:', error);
        throw error;
    }
}

/**
 * Fetch forecast data from NOAA
 */
export async function fetchForecast(latitude, longitude) {
    try {
        // Get grid point metadata
        const pointsUrl = `${CONFIG.NOAA_POINTS}/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        const pointsResponse = await fetch(pointsUrl, {
            headers: {
                'User-Agent': 'CoralGablesWeatherGrid/1.0'
            }
        });
        
        if (!pointsResponse.ok) {
            throw new Error(`NOAA Points API error: ${pointsResponse.status}`);
        }
        
        const pointsData = await pointsResponse.json();
        
        // Get hourly forecast
        const forecastUrl = pointsData.properties.forecastHourly;
        const forecastResponse = await fetch(forecastUrl, {
            headers: {
                'User-Agent': 'CoralGablesWeatherGrid/1.0'
            }
        });
        
        if (!forecastResponse.ok) {
            throw new Error(`NOAA Forecast API error: ${forecastResponse.status}`);
        }
        
        const forecastData = await forecastResponse.json();
        return parseNOAAForecast(forecastData);
    } catch (error) {
        console.error('NOAA forecast error:', error);
        throw error;
    }
}

/**
 * Fetch active weather alerts for location
 */
export async function fetchWeatherAlerts(latitude, longitude) {
    try {
        const url = `${CONFIG.NOAA_ALERTS}?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'CoralGablesWeatherGrid/1.0'
            }
        });
        
        if (!response.ok) {
            throw new Error(`NOAA Alerts API error: ${response.status}`);
        }
        
        const data = await response.json();
        return parseNOAAAlerts(data);
    } catch (error) {
        console.error('NOAA alerts fetch error:', error);
        return []; // Return empty array on error
    }
}

/**
 * Parse NOAA observation data
 */
function parseNOAAObservation(data) {
    const props = data.properties;
    
    // Convert Celsius to Fahrenheit
    const celsiusToFahrenheit = (c) => c ? (c * 9/5) + 32 : null;
    const metersPerSecondToMph = (ms) => ms ? ms * 2.237 : null;
    
    return {
        temperature: celsiusToFahrenheit(props.temperature.value),
        feelsLike: celsiusToFahrenheit(props.windChill.value) || celsiusToFahrenheit(props.heatIndex.value),
        humidity: props.relativeHumidity.value,
        pressure: props.barometricPressure.value ? props.barometricPressure.value / 100 : null, // Convert Pa to mb
        windSpeed: metersPerSecondToMph(props.windSpeed.value),
        windDirection: props.windDirection.value,
        windGust: metersPerSecondToMph(props.windGust.value),
        precipitation: 0, // NOAA doesn't provide current precipitation in observations
        cloudCover: props.cloudLayers && props.cloudLayers.length > 0 ? 
            Math.max(...props.cloudLayers.map(l => l.amount === 'OVC' ? 100 : l.amount === 'BKN' ? 75 : l.amount === 'SCT' ? 50 : 25)) : 0,
        visibility: props.visibility.value ? Math.round(props.visibility.value) : null, // Keep in meters, null if missing
        weather: props.textDescription ? props.textDescription.toLowerCase() : 'unknown',
        weatherDescription: props.textDescription || 'Unknown',
        timestamp: new Date(props.timestamp).getTime(),
        source: 'NOAA'
    };
}

/**
 * Parse NOAA forecast data
 */
function parseNOAAForecast(data) {
    const periods = data.properties.periods;
    
    return {
        forecasts: periods.map(period => ({
            temperature: period.temperature,
            feelsLike: period.temperature, // NOAA doesn't provide feels-like in forecast
            humidity: period.relativeHumidity?.value || null,
            windSpeed: parseWindSpeed(period.windSpeed),
            windDirection: parseWindDirection(period.windDirection),
            precipitation: period.probabilityOfPrecipitation?.value || 0,
            weather: period.shortForecast.toLowerCase(),
            weatherDescription: period.detailedForecast,
            timestamp: new Date(period.startTime).getTime(),
            probabilityOfPrecipitation: period.probabilityOfPrecipitation?.value || 0
        })),
        source: 'NOAA'
    };
}

/**
 * Parse NOAA weather alerts
 */
function parseNOAAAlerts(data) {
    if (!data.features || data.features.length === 0) {
        return [];
    }
    
    return data.features.map(feature => ({
        id: feature.properties.id,
        event: feature.properties.event,
        severity: feature.properties.severity,
        certainty: feature.properties.certainty,
        urgency: feature.properties.urgency,
        headline: feature.properties.headline,
        description: feature.properties.description,
        instruction: feature.properties.instruction,
        onset: new Date(feature.properties.onset).getTime(),
        expires: new Date(feature.properties.expires).getTime(),
        source: 'NOAA'
    }));
}

/**
 * Parse wind speed string (e.g., "10 to 15 mph")
 */
function parseWindSpeed(speedStr) {
    if (!speedStr) return 0;
    const match = speedStr.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

/**
 * Parse wind direction string to degrees
 */
function parseWindDirection(dirStr) {
    const directions = {
        'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
        'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
        'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
        'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
    };
    return directions[dirStr] || 0;
}

/**
 * Batch fetch current weather with rate limiting
 */
export async function fetchBatchWeather(samplingPoints) {
    const results = [];
    const delayBetweenRequests = 200; // NOAA doesn't specify rate limits, be conservative
    
    for (const point of samplingPoints) {
        try {
            const weatherData = await fetchCurrentWeather(point.latitude, point.longitude);
            results.push({
                pointId: point.id,
                ...weatherData
            });
            
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        } catch (error) {
            console.error(`Failed to fetch NOAA weather for point ${point.id}:`, error);
            results.push({
                pointId: point.id,
                error: error.message
            });
        }
    }
    
    return results;
}
