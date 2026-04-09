import {IconNames} from "@blueprintjs/icons";

const ICON_VALUES = Object.values(IconNames || {});
const BLUEPRINT_ICON_SET = new Set(
    ICON_VALUES.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
);

function looksLikeAssetPath(value) {
    return /[\\/]/.test(value) || /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(value);
}

export function resolveBlueprintIcon(icon, fallback = "cube") {
    const safeFallback = BLUEPRINT_ICON_SET.has(String(fallback || "").toLowerCase())
        ? String(fallback).toLowerCase()
        : "cube";
    if (typeof icon !== "string") {
        return {
            icon: safeFallback,
            usedFallback: true,
            reason: "icon_not_string",
            original: icon,
        };
    }
    const normalized = icon.trim().toLowerCase();
    if (!normalized || looksLikeAssetPath(normalized)) {
        return {
            icon: safeFallback,
            usedFallback: true,
            reason: "icon_invalid_format",
            original: icon,
        };
    }
    if (!BLUEPRINT_ICON_SET.has(normalized)) {
        return {
            icon: safeFallback,
            usedFallback: true,
            reason: "icon_unknown",
            original: icon,
        };
    }
    return {
        icon: normalized,
        usedFallback: false,
        reason: "",
        original: icon,
    };
}

export function sanitizeBlueprintIcon(icon, fallback = "cube") {
    return resolveBlueprintIcon(icon, fallback).icon;
}
