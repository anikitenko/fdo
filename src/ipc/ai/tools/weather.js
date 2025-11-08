// tools/weather.js
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
            "rain", "sunny", "cloud", "storm", "cold", "hot"
        ];
        if (kws.some(k => q.includes(k))) return true;
        if (/in\s+[a-z\s,'-]+\b/.test(q)) return q.includes("weather") || q.includes("forecast");
        return false;
    },

    async handler(input) {
        try {
            const city = String(input?.city || "").trim();
            if (!city) return { name: "get_current_weather", error: "City is required" };

            const q = encodeURIComponent(city);
            const geores = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=en&format=json`);
            const geo = await geores.json();
            const first = geo?.results?.[0];
            if (!first) return { name: "get_current_weather", error: `City not found: ${city}` };

            const { latitude, longitude, name, country, timezone } = first;
            const wres = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&timezone=${encodeURIComponent(timezone || "auto")}`
            );
            const weather = await wres.json();
            const cw = weather?.current_weather;
            if (!cw) return { name: "get_current_weather", error: "Weather data unavailable" };

            // 🌦️ Create human-readable text
            const text = `🌤️ Current weather in ${name}, ${country}: ${cw.temperature}°C, `
                + `wind ${cw.windspeed} km/h from ${cw.winddirection}°, `
                + (cw.is_day ? "daytime" : "nighttime") + `.`;

            // ✅ Return both readable text and structured data
            return {
                name: "get_current_weather",
                text,
                data: {
                    location: { name, country, latitude, longitude, timezone },
                    current: {
                        temperature_c: cw.temperature,
                        windspeed_kmh: cw.windspeed,
                        winddirection_deg: cw.winddirection,
                        weathercode: cw.weathercode,
                        is_day: cw.is_day === 1,
                        time: cw.time,
                    },
                },
            };
        } catch (err) {
            return { name: "get_current_weather", error: String(err?.message || err) };
        }
    },
};
