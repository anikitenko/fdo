import {AppToaster} from "../../AppToaster";

export function shortenUrl(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split("/").filter(Boolean);

        if (parts.length <= 3) return url; // nothing to shorten

        // keep first and last path parts, replace the middle with "..."
        const shortPath = [parts[0], "...", parts[parts.length - 1]].join("/");

        return `${u.origin}/${shortPath}`;
    } catch (e) {
        AppToaster.show({message: `Invalid URL: ${url}`, intent: "warning"});
        return null;
    }
}