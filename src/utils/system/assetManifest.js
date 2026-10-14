/**
 * Asset Manifest - Documents critical vs lazy-loaded assets for startup optimization
 * 
 * Critical assets are loaded immediately at startup for the home screen.
 * Lazy assets are deferred until their corresponding routes or features are accessed.
 */

export const AssetManifest = {
    /**
     * Critical Assets - Required for initial home screen render
     * These MUST be in the initial bundle for <1s first paint
     */
    critical: {
        // Core application code
        bundles: [
            'runtime.js',           // Webpack runtime (1.7 KB)
            'react-vendor.js',      // React, ReactDOM, React Router (133 KB)
            'main_window.js',       // Application entry point (2.7 KB)
        ],
        
        // Essential CSS for layout and theme
        stylesheets: [
            'normalize.css',        // CSS reset/normalize
            '@blueprintjs/core/lib/css/blueprint.css',  // Blueprint UI components
            '@blueprintjs/icons/lib/css/blueprint-icons.css',  // Blueprint icons
        ],
        
        // Home screen components
        components: [
            'Home.jsx',
            'NavigationPluginsButton.jsx',
            'SearchBar.jsx',
        ],
        
        // Total critical size target: <600 KB (currently ~461 KB)
    },
    
    /**
     * Lazy Assets - Route-based code splitting
     * These load on-demand when user navigates to specific routes
     */
    lazy: {
        // Editor route (heaviest assets ~20 MB)
        '/editor': {
            components: ['EditorPage.jsx'],
            dependencies: [
                'monaco-editor',        // ~10 MB (workers, languages, themes)
                'monaco-editor-webpack-plugin',
                '@babel/standalone',    // 5.56 MB (used for plugin compilation)
                'ace-builds',           // ~3 MB (evaluate if still needed)
            ],
            estimatedSize: '20 MB',
            loadTrigger: 'route:editor',
        },
        
        // Live UI route (ReactFlow dependencies ~5 MB)
        '/live-ui': {
            components: ['LiveUI.jsx'],
            dependencies: [
                'reactflow',            // ~3.6 MB (graph visualization)
                'elkjs',                // Layout engine
            ],
            estimatedSize: '5 MB',
            loadTrigger: 'route:live-ui',
        },
        
        // Settings dialog (on-demand)
        'settings': {
            components: ['SettingsDialog.jsx'],
            dependencies: [],
            estimatedSize: '50 KB',
            loadTrigger: 'user-action:open-settings',
        },
        
        // Plugin management dialogs (on-demand)
        'plugin-dialogs': {
            components: [
                'CreatePluginDialog.jsx',
                'ManagePluginsDialog.jsx',
            ],
            dependencies: [],
            estimatedSize: '100 KB',
            loadTrigger: 'user-action:manage-plugins',
        },
    },
    
    /**
     * Evaluable Assets - May not be needed, consider removal
     */
    evaluable: {
        'ace-builds': {
            size: '~3 MB',
            reason: 'Monaco Editor already provides code editing',
            recommendation: 'Remove if not used outside editor',
            usedIn: ['To be determined'],
        },
        'font-awesome': {
            size: '~1.3 MB',
            reason: 'Blueprint icons may be sufficient',
            recommendation: 'Audit icon usage, remove if redundant',
            usedIn: ['To be determined'],
        },
    },
    
    /**
     * Asset Loading Strategy
     */
    strategy: {
        preload: [
            // Already implemented in index.html
            'runtime.js',
            'react-vendor.js',
            'main_window.js',
        ],
        
        prefetch: [
            // Hint browser to fetch in background after critical assets load
            // Implement if user commonly accesses editor after startup
            // 'monaco-editor', 
        ],
        
        onDemand: [
            // Load via React.lazy() when component mounts
            'EditorPage',
            'LiveUI',
            'SettingsDialog',
            'CreatePluginDialog',
            'ManagePluginsDialog',
        ],
    },
    
    /**
     * Performance Targets
     */
    targets: {
        criticalBundleSize: '<600 KB',       // Current: 461 KB ✅
        totalRendererSize: '<70 MB',         // Current: 73 MB (Target: <70 MB)
        lazyChunkLoadTime: '<500 ms',        // Route transitions feel instant
        memoryAtStartup: '<300 MB',          // Before plugins load
        cpuDuringStartup: '<60%',            // On dual-core system
    },
    
    /**
     * Optimization Opportunities (from baseline.md)
     */
    optimizations: {
        immediate: [
            'Verify Monaco workers only load with /editor route',
            'Lazy load @babel/standalone with editor',
            'Remove ACE editor if unused',
            'Remove Font Awesome if Blueprint icons sufficient',
        ],
        
        incremental: [
            'Run npm dedupe to flatten dependency tree',
            'Use depcheck to find unused dependencies',
            'Replace full lodash imports with specific modules',
            'Enable tree shaking for all libraries (sideEffects)',
        ],
        
        potential: [
            'Implement CDN for common libraries in dev mode',
            'Use dynamic imports for plugin-only dependencies',
            'Compress images and icons in assets/',
        ],
    },
};

/**
 * Helper function to get asset category
 * @param {string} assetPath - Path to asset
 * @returns {'critical'|'lazy'|'evaluable'|'unknown'}
 */
export function getAssetCategory(assetPath) {
    // Check critical bundles
    if (AssetManifest.critical.bundles.some(b => assetPath.includes(b))) {
        return 'critical';
    }
    
    // Check critical stylesheets
    if (AssetManifest.critical.stylesheets.some(s => assetPath.includes(s))) {
        return 'critical';
    }
    
    // Check lazy dependencies
    for (const route in AssetManifest.lazy) {
        const routeAssets = AssetManifest.lazy[route];
        if (routeAssets.dependencies && routeAssets.dependencies.some(d => assetPath.includes(d))) {
            return 'lazy';
        }
        if (routeAssets.components && routeAssets.components.some(c => assetPath.includes(c))) {
            return 'lazy';
        }
    }
    
    // Check evaluable assets
    if (Object.keys(AssetManifest.evaluable).some(k => assetPath.includes(k))) {
        return 'evaluable';
    }
    
    return 'unknown';
}

/**
 * Get total estimated critical size
 * @returns {string}
 */
export function getCriticalSize() {
    return '~461 KB';
}

/**
 * Get total estimated lazy size
 * @returns {string}
 */
export function getLazySize() {
    return '~25 MB';
}

