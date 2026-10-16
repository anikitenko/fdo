// Keep exact payloads for deduplication. Lengths/prefixes collide for ordinary
// changes such as a different same-length label, target ID or frontend action.
export function samePluginRenderContent(left,right) {
    return !!left && !!right && left.render===right.render && left.onLoad===right.onLoad;
}
