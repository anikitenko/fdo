function generatePluginName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-+)|(-+$)/g, '');
}

export default generatePluginName