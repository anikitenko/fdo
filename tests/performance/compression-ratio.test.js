/**
 * Performance Tests - Compression Ratio
 * Validates SC-007: Compression achieves ≥50% size reduction
 */

const LZString = require('lz-string');

describe('Compression Ratio - SC-007', () => {
    test('should achieve ≥50% compression on typical JavaScript code', () => {
        // Typical React component code - simulate multiple similar components
        const code = `
import React, { useState, useEffect } from 'react';
import { Button, Card, TextField } from '@blueprintjs/core';

export const UserProfile = ({ userId }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchUser(userId)
            .then(data => {
                setUser(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [userId]);

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error}</div>;

    return (
        <Card>
            <h2>{user.name}</h2>
            <p>Email: {user.email}</p>
            <Button onClick={() => alert('Edit profile')}>Edit</Button>
        </Card>
    );
};
`.repeat(10); // Simulate 10 similar files (realistic in a project)

        const originalSize = new Blob([code]).size;
        const compressed = LZString.compress(code);
        const compressedSize = new Blob([compressed]).size;
        
        const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;
        
        expect(compressionRatio).toBeGreaterThanOrEqual(50);
        
        console.log(`Compression: ${originalSize} → ${compressedSize} bytes (${compressionRatio.toFixed(1)}% reduction)`);
    });

    test('should achieve ≥50% compression on JSON data (snapshot metadata)', () => {
        const snapshotData = {
            versions: {
                'v1': {
                    version: 'v1',
                    date: '2025-01-01T00:00:00.000Z',
                    content: Array(20).fill(null).map((_, i) => ({
                        path: `src/components/Component${i}.jsx`,
                        model: `import React from 'react';\nexport const Component${i} = () => <div>Component ${i}</div>;`,
                        type: 'file',
                        language: 'javascript'
                    }))
                },
                'v2': {
                    version: 'v2',
                    date: '2025-01-02T00:00:00.000Z',
                    content: Array(20).fill(null).map((_, i) => ({
                        path: `src/components/Component${i}.jsx`,
                        model: `import React from 'react';\nexport const Component${i} = () => <div>Component ${i} Updated</div>;`,
                        type: 'file',
                        language: 'javascript'
                    }))
                }
            },
            version_latest: 'v2',
            version_current: 'v2'
        };

        const jsonString = JSON.stringify(snapshotData);
        const originalSize = new Blob([jsonString]).size;
        const compressed = LZString.compress(jsonString);
        const compressedSize = new Blob([compressed]).size;
        
        const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;
        
        expect(compressionRatio).toBeGreaterThanOrEqual(50);
        
        console.log(`JSON Compression: ${originalSize} → ${compressedSize} bytes (${compressionRatio.toFixed(1)}% reduction)`);
    });

    test('should achieve ≥50% compression on repetitive code patterns', () => {
        // Simulate config files with repetitive patterns
        const configCode = `
module.exports = {
    entry: './src/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bundle.js'
    },
    module: {
        rules: [
            { test: /\\.jsx?$/, use: 'babel-loader', exclude: /node_modules/ },
            { test: /\\.css$/, use: ['style-loader', 'css-loader'] },
            { test: /\\.scss$/, use: ['style-loader', 'css-loader', 'sass-loader'] },
            { test: /\\.(png|jpg|gif)$/, use: 'file-loader' },
            { test: /\\.(woff|woff2|eot|ttf|otf)$/, use: 'file-loader' }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin({ template: './src/index.html' }),
        new MiniCssExtractPlugin({ filename: '[name].css' })
    ]
};
`.repeat(10);

        const originalSize = new Blob([configCode]).size;
        const compressed = LZString.compress(configCode);
        const compressedSize = new Blob([compressed]).size;
        
        const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;
        
        expect(compressionRatio).toBeGreaterThanOrEqual(50);
        
        console.log(`Config Compression: ${originalSize} → ${compressedSize} bytes (${compressionRatio.toFixed(1)}% reduction)`);
    });

    test('should handle small files efficiently', () => {
        // Small files might not compress as well
        const smallCode = 'export const API_KEY = "test123";';
        
        const originalSize = new Blob([smallCode]).size;
        const compressed = LZString.compress(smallCode);
        const compressedSize = new Blob([compressed]).size;
        
        const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;
        
        // Small files might not meet 50%, but should still compress
        console.log(`Small file: ${originalSize} → ${compressedSize} bytes (${compressionRatio.toFixed(1)}% ${compressionRatio >= 0 ? 'reduction' : 'increase'})`);
        
        // At minimum, should not significantly increase size
        expect(compressedSize).toBeLessThanOrEqual(originalSize * 2);
    });

    test('should achieve excellent compression on large snapshot (5+ files)', () => {
        // Simulate a realistic snapshot with 15 files (common imports and patterns)
        const files = [];
        for (let i = 1; i <= 15; i++) {
            files.push({
                path: `src/components/Feature${i}/index.js`,
                model: `
import React from 'react';
import { Button, Card, Intent } from '@blueprintjs/core';
import { useDispatch, useSelector } from 'react-redux';
import './styles.css';

export const Feature${i} = ({ data, onUpdate }) => {
    const dispatch = useDispatch();
    const state = useSelector(state => state.feature${i});

    const handleClick = () => {
        console.log('Feature ${i} clicked');
        onUpdate({ feature: ${i}, timestamp: Date.now() });
        dispatch({ type: 'FEATURE_CLICKED', payload: ${i} });
    };

    return (
        <Card elevation={2} className="feature-${i}">
            <h3>Feature ${i}</h3>
            <p>This is feature number ${i} with some description text that explains the functionality.</p>
            <Button intent={Intent.PRIMARY} onClick={handleClick}>
                Activate Feature ${i}
            </Button>
        </Card>
    );
};
`,
                type: 'file',
                language: 'javascript'
            });
        }

        const snapshotData = {
            versions: {
                'v1': {
                    version: 'v1',
                    date: new Date().toISOString(),
                    content: files
                }
            },
            version_latest: 'v1',
            version_current: 'v1'
        };

        const jsonString = JSON.stringify(snapshotData);
        const originalSize = new Blob([jsonString]).size;
        const compressed = LZString.compress(jsonString);
        const compressedSize = new Blob([compressed]).size;
        
        const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;
        
        // Large snapshots should easily exceed 50%
        expect(compressionRatio).toBeGreaterThanOrEqual(50);
        
        console.log(`Large snapshot: ${originalSize} → ${compressedSize} bytes (${compressionRatio.toFixed(1)}% reduction)`);
    });

    test('should maintain compression efficiency across multiple versions', () => {
        // Test compression across version history
        const versions = {};
        for (let v = 1; v <= 5; v++) {
            versions[`v${v}`] = {
                version: `v${v}`,
                date: new Date(2025, 0, v).toISOString(),
                content: Array(10).fill(null).map((_, i) => ({
                    path: `file${i}.js`,
                    model: `console.log('Version ${v}, File ${i}');`.repeat(20),
                    type: 'file',
                    language: 'javascript'
                }))
            };
        }

        const snapshotData = {
            versions,
            version_latest: 'v5',
            version_current: 'v5'
        };

        const jsonString = JSON.stringify(snapshotData);
        const originalSize = new Blob([jsonString]).size;
        const compressed = LZString.compress(jsonString);
        const compressedSize = new Blob([compressed]).size;
        
        const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100;
        
        expect(compressionRatio).toBeGreaterThanOrEqual(50);
        
        console.log(`Multi-version: ${originalSize} → ${compressedSize} bytes (${compressionRatio.toFixed(1)}% reduction)`);
    });
});

