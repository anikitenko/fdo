// Mock for monaco-editor module
module.exports = {
    Uri: {
        file: jest.fn((path) => ({ 
            path, 
            toString: (skipEncoding) => skipEncoding ? path : `file://${path}`
        }))
    },
    editor: {
        createModel: jest.fn(),
        getModel: jest.fn(),
        setModelMarkers: jest.fn(),
        onDidCreateEditor: jest.fn()
    },
    languages: {
        typescript: {
            typescriptDefaults: {
                addExtraLib: jest.fn(),
                setCompilerOptions: jest.fn(),
                getCompilerOptions: jest.fn(() => ({}))
            }
        }
    }
};



