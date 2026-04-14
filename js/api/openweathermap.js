import { CONFIG } from '../config.js';

/**
 * Fetch current weather data from OpenWeatherMap API
 */
export async function fetchCurrentWeather(latitude, longitude) {
    const url = `${CONFIG.OPENWEATHERMAP_CURRENT}?lat=${latitude}&lon=${longitude}&appid=${CONFIG.OPENWEATHERMAP_API_KEY}&units=imperial`;
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`OpenWeatherMap API error: ${response.status}`);
        }
        
        const data = await response.json();
        return parseOpenWeatherMapData(data);
    } catch (error) {
        console.error('OpenWeatherMap fetch error:', error);
        throw error;
    }
}

/**
 * Fetch forecast data from OpenWeatherMap API
 * Returns 5-day forecast with 3-hour intervals
 */
export async function fetchForecast(latitude, longitude) {
    const url = `${CONFIG.OPENWEATHERMAP_FORECAST}?lat=${latitude}&lon=${longitude}&appid=${CONFIG.OPENWEATHERMAP_API_KEY}&units=imperial`;
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`OpenWeatherMap Forecast API error: ${response.status}`);
        }
        
        const data = await response.json();
        return parseForecastData(data);
    } catch (error) {
        console.error('OpenWeatherMap forecast error:', error);
        throw error;
    }
}

/**
 * Parse OpenWeatherMap current weather response
 */
function parseOpenWeatherMapData(data) {
    return {
        temperature: data.main.temp,
        feelsLike: data.main.feels_like,
        humidity: data.main.humidity,
        pressure: data.main.pressure,
        windSpeed: data.wind.speed,
        windDirection: data.wind.deg,
        windGust: data.wind.gust || null,
        precipitation: data.rain ? (data.rain['1h'] || 0) : 0,
        cloudCover: data.clouds.all,
        visibility: data.visibility,
        weather: data.weather[0].main.toLowerCase(),
        weatherDescription: data.weather[0].description,
        timestamp: data.dt * 1000, // Convert to milliseconds
        sunrise: data.sys.sunrise * 1000,
        sunset: data.sys.sunset * 1000,
        source: 'OpenWeatherMap'
    };
}

/**
 * Parse OpenWeatherMap forecast response
 */
function parseForecastData(data) {
    return {
        city: data.city.name,
        forecasts: data.list.map(item => ({
            temperature: item.main.temp,
            feelsLike: item.main.feels_like,
            humidity: item.main.humidity,
            pressure: item.main.pressure,
            windSpeed: item.wind.speed,
            windDirection: item.wind.deg,
            precipitation: item.rain ? (item.rain['3h'] || 0) : 0,
            cloudCover: item.clouds.all,
            weather: item.weather[0].main.toLowerCase(),
            weatherDescription: item.weather[0].description,
            timestamp: item.dt * 1000,
            probabilityOfPrecipitation: item.pop * 100
        })),
        source: 'OpenWeatherMap'
    };
}

/**
 * Get forecast for specific time offset (3h or 24h)
 */
export function getForecastAtOffset(forecastData, hoursAhead) {
    if (!forecastData || !forecastData.forecasts) {
        return null;
    }
    
    const targetTime = Date.now() + (hoursAhead * 60 * 60 * 1000);
    
    // Find closest forecast
    let closest = forecastData.forecasts[0];
    let minDiff = Math.abs(closest.timestamp - targetTime);
    
    for (const forecast of forecastData.forecasts) {
        const diff = Math.abs(forecast.timestamp - targetTime);
        if (diff < minDiff) {
            minDiff = diff;
            closest = forecast;
        }
    }
    
    return closest;
}

/**
 * Batch fetch weather data for multiple points with rate limiting
 */
export async function fetchBatchWeather(samplingPoints) {
    const results = [];
    const delayBetweenRequests = 100; // ms to respect rate limits
    
    for (const point of samplingPoints) {
        try {
            const weatherData = await fetchCurrentWeather(point.latitude, point.longitude);
            results.push({
                pointId: point.id,
                ...weatherData
            });
            
            // Delay between requests
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        } catch (error) {
            console.error(`Failed to fetch weather for point ${point.id}:`, error);
            results.push({
                pointId: point.id,
                error: error.message
            });
        }
    }
    
    return results;
}

/**
 * Batch fetch forecast data for multiple points
 */
export async function fetchBatchForecast(samplingPoints) {
    const results = [];
    const delayBetweenRequests = 100;
    
    for (const point of samplingPoints) {
        try {
            const forecastData = await fetchForecast(point.latitude, point.longitude);
            results.push({
                pointId: point.id,
                ...forecastData
            });
            
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        } catch (error) {
            console.error(`Failed to fetch forecast for point ${point.id}:`, error);
            results.push({
                pointId: point.id,
                error: error.message
            });
        }
    }
    
    return results;
}
