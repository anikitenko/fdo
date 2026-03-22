// tools/weather.js
const WEATHER_CODE_LABELS = {
    0: "clear sky",
    1: "mostly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    56: "light freezing drizzle",
    57: "dense freezing drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "heavy freezing rain",
    71: "slight snow",
    73: "moderate snow",
    75: "heavy snow",
    77: "snow grains",
    80: "slight rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    85: "slight snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with slight hail",
    99: "thunderstorm with heavy hail",
};

async function fetchJson(url, { timeoutMs = 8000, headers = {} } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            headers: {
                "accept": "application/json",
                ...headers,
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } catch (err) {
        if (err?.name === "AbortError") {
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

function describeWeatherCode(code) {
    return WEATHER_CODE_LABELS[code] || `weather code ${code}`;
}

function describeTemperatureFeel(apparentTemperature) {
    if (typeof apparentTemperature !== "number") return "temperature feel is unclear";
    if (apparentTemperature <= -10) return "feels extremely cold";
    if (apparentTemperature <= 0) return "feels very cold";
    if (apparentTemperature <= 8) return "feels cold";
    if (apparentTemperature <= 16) return "feels cool";
    if (apparentTemperature <= 24) return "feels mild";
    if (apparentTemperature <= 30) return "feels warm";
    if (apparentTemperature <= 36) return "feels hot";
    return "feels extremely hot";
}

function describeComfort({ apparentTemperature, windSpeed, humidity, precipitation, rain, showers, snowfall, cloudCover }) {
    const notes = [describeTemperatureFeel(apparentTemperature)];

    if (typeof windSpeed === "number" && windSpeed >= 35) notes.push("quite windy");
    else if (typeof windSpeed === "number" && windSpeed >= 20) notes.push("a bit windy");

    if (typeof humidity === "number" && humidity >= 85) notes.push("humid");
    else if (typeof humidity === "number" && humidity <= 35) notes.push("dry air");

    const wetAmount = [precipitation, rain, showers].filter((v) => typeof v === "number").reduce((a, b) => a + b, 0);
    if (wetAmount > 0 || (typeof snowfall === "number" && snowfall > 0)) {
        notes.push("wet conditions likely");
    }

    if (typeof cloudCover === "number" && cloudCover >= 80) notes.push("quite gloomy");
    else if (typeof cloudCover === "number" && cloudCover <= 20) notes.push("bright conditions");

    return notes.join(", ");
}

async function fetchOpenMeteoWeather(city) {
    const q = encodeURIComponent(city);
    const lang = /[а-яіїєґ]/i.test(city) ? "uk" : "en";
    const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=${lang}&format=json`);
    const first = geo?.results?.[0];
    if (!first) {
        throw new Error(`City not found: ${city}`);
    }

    const { latitude, longitude, name, country, timezone } = first;
    const weather = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max` +
        `&forecast_days=2&timezone=${encodeURIComponent(timezone || "auto")}`
    );
    const cw = weather?.current;
    const daily = weather?.daily;
    if (!cw) {
        throw new Error("Weather data unavailable");
    }

    const condition = describeWeatherCode(cw.weather_code);
    const comfort = describeComfort({
        apparentTemperature: cw.apparent_temperature,
        windSpeed: cw.wind_speed_10m,
        humidity: cw.relative_humidity_2m,
        precipitation: cw.precipitation,
        rain: cw.rain,
        showers: cw.showers,
        snowfall: cw.snowfall,
        cloudCover: cw.cloud_cover,
    });
    const precipitationBits = [];
    if ((cw.precipitation ?? 0) > 0) precipitationBits.push(`precipitation ${cw.precipitation} mm`);
    if ((cw.rain ?? 0) > 0) precipitationBits.push(`rain ${cw.rain} mm`);
    if ((cw.showers ?? 0) > 0) precipitationBits.push(`showers ${cw.showers} mm`);
    if ((cw.snowfall ?? 0) > 0) precipitationBits.push(`snowfall ${cw.snowfall} cm`);
    const precipitationText = precipitationBits.length > 0 ? `, ${precipitationBits.join(", ")}` : "";

    let tomorrowText = "";
    if (daily?.time?.length > 1) {
        const tomorrowCondition = describeWeatherCode(daily.weather_code?.[1]);
        const precipProb = daily.precipitation_probability_max?.[1];
        const precipSum = daily.precipitation_sum?.[1];
        tomorrowText =
            ` Tomorrow: ${tomorrowCondition}, ` +
            `${daily.temperature_2m_min?.[1]}°C to ${daily.temperature_2m_max?.[1]}°C` +
            (typeof precipProb === "number" ? `, precipitation chance up to ${precipProb}%` : "") +
            (typeof precipSum === "number" ? `, precipitation ${precipSum} mm` : "") +
            `.`;
    }

    const text =
        `Current weather in ${name}, ${country}: ${cw.temperature_2m}°C ` +
        `(feels like ${cw.apparent_temperature}°C), ${condition}, humidity ${cw.relative_humidity_2m}%, ` +
        `cloud cover ${cw.cloud_cover}%, wind ${cw.wind_speed_10m} km/h from ${cw.wind_direction_10m}°` +
        (typeof cw.wind_gusts_10m === "number" ? `, gusts up to ${cw.wind_gusts_10m} km/h` : "") +
        precipitationText +
        `. Overall, it ${comfort}.${tomorrowText}`;

    return {
        text,
        results: [{
            kind: "weather",
            city,
            text,
        }],
        sources: ["Open-Meteo"],
        data: {
            provider: "open-meteo",
            location: { name, country, latitude, longitude, timezone },
            current: {
                temperature_c: cw.temperature_2m,
                apparent_temperature_c: cw.apparent_temperature,
                relative_humidity_percent: cw.relative_humidity_2m,
                precipitation_mm: cw.precipitation,
                rain_mm: cw.rain,
                showers_mm: cw.showers,
                snowfall_cm: cw.snowfall,
                cloud_cover_percent: cw.cloud_cover,
                windspeed_kmh: cw.wind_speed_10m,
                winddirection_deg: cw.wind_direction_10m,
                wind_gusts_kmh: cw.wind_gusts_10m,
                weathercode: cw.weather_code,
                condition,
                comfort,
                time: cw.time,
            },
            daily: daily ? {
                time: daily.time,
                weather_code: daily.weather_code,
                temperature_2m_max: daily.temperature_2m_max,
                temperature_2m_min: daily.temperature_2m_min,
                precipitation_sum: daily.precipitation_sum,
                precipitation_probability_max: daily.precipitation_probability_max,
                wind_speed_10m_max: daily.wind_speed_10m_max,
                wind_gusts_10m_max: daily.wind_gusts_10m_max,
            } : null,
        },
    };
}

async function fetchWttrFallback(city) {
    const q = encodeURIComponent(city);
    const data = await fetchJson(`https://wttr.in/${q}?format=j1`, {
        headers: { "user-agent": "FDO/1.0 weather fallback" },
    });
    const current = data?.current_condition?.[0];
    if (!current) {
        throw new Error("Fallback weather data unavailable");
    }

    const area = data?.nearest_area?.[0];
    const name = area?.areaName?.[0]?.value || city;
    const country = area?.country?.[0]?.value || "";
    const condition = current?.weatherDesc?.[0]?.value || "current conditions available";
    const feelsLike = Number(current?.FeelsLikeC);
    const windSpeed = Number(current?.windspeedKmph);
    const humidity = Number(current?.humidity);
    const cloudCover = Number(current?.cloudcover);
    const comfort = describeComfort({
        apparentTemperature: feelsLike,
        windSpeed,
        humidity,
        precipitation: Number(current?.precipMM),
        rain: Number(current?.precipMM),
        showers: 0,
        snowfall: 0,
        cloudCover,
    });

    const text =
        `Current weather in ${name}${country ? `, ${country}` : ""}: ${current?.temp_C}°C ` +
        `(feels like ${current?.FeelsLikeC}°C), ${condition}, humidity ${current?.humidity}%, ` +
        `cloud cover ${current?.cloudcover}%, wind ${current?.windspeedKmph} km/h from ${current?.winddirDegree}°.` +
        ` Overall, it ${comfort}.`;

    return {
        text,
        results: [{
            kind: "weather",
            city,
            text,
        }],
        sources: ["wttr.in"],
        data: {
            provider: "wttr.in",
            location: { name, country },
            current: {
                temperature_c: Number(current?.temp_C),
                apparent_temperature_c: feelsLike,
                relative_humidity_percent: humidity,
                cloud_cover_percent: cloudCover,
                windspeed_kmh: windSpeed,
                winddirection_deg: Number(current?.winddirDegree),
                condition,
                comfort,
                time: current?.localObsDateTime,
            },
            daily: null,
        },
    };
}

export const getCurrentWeatherTool = {
    name: "get_current_weather",
    description: "Get the current weather for a city (uses Open-Meteo)",
    input_schema: {
        type: "object",
        properties: {
            city: { type: "string", description: "City name, optionally with country (e.g., 'Lutsk, Ukraine')" }
        },
        required: ["city"],
    },

    shouldActivate(prompt) {
        if (!prompt) return false;
        const q = String(prompt).toLowerCase();
        const kws = [
            "weather", "forecast", "temperature", "wind", "humidity", "snow",
            "rain", "sunny", "cloud", "storm", "cold", "hot",
            "погода", "дощ", "сонце", "вітер", "температура", "сніг", "гроза", "вітрянно", "парасолю", "парасоля"
        ];
        if (kws.some(k => q.includes(k))) return true;
        if (/in\s+[a-z\s,'-]+\b/.test(q) || /\bв\s+[а-яіїєґ\s,'-]+\b/i.test(q)) {
            return kws.some(k => q.includes(k));
        }
        return false;
    },

    async handler(input) {
        const city = String(input?.city || "").trim();
        if (!city) return { name: "get_current_weather", ok: false, results: [], sources: [], error: "City is required" };

        try {
            const primary = await fetchOpenMeteoWeather(city);
            return {
                name: "get_current_weather",
                ok: true,
                ...primary,
            };
        } catch (err) {
            console.warn("[WeatherTool] Open-Meteo failed, trying fallback", {
                city,
                error: String(err?.message || err),
            });
            try {
                const fallback = await fetchWttrFallback(city);
                return {
                    name: "get_current_weather",
                    ok: true,
                    ...fallback,
                };
            } catch (fallbackErr) {
                return {
                    name: "get_current_weather",
                    ok: false,
                    results: [],
                    sources: [],
                    error: `Weather lookup failed (${String(err?.message || err)}). Fallback also failed (${String(fallbackErr?.message || fallbackErr)}).`,
                };
            }
        }
    },
};
