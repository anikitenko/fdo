// Minimal Monaco mock sufficient for VirtualFS unit tests and React components
const models = new Map();

function UriFile(path) {
  return {
    toString: () => `file://${path}`,
    toString: (skipEncoding) => `file://${path}`,
    path,
  };
}

const languageDefaults = {
  addExtraLib: jest.fn(),
  getCompilerOptions: () => ({}),
  setCompilerOptions: jest.fn(),
  setDiagnosticsOptions: jest.fn(),
  setEagerModelSync: jest.fn(),
};

const javascriptDefaults = {
  addExtraLib: jest.fn(),
  getCompilerOptions: () => ({}),
  setCompilerOptions: jest.fn(),
  setDiagnosticsOptions: jest.fn(),
  setEagerModelSync: jest.fn(),
};

const monaco = {
  Uri: {
    file: (p) => ({ path: p, toString: () => `file://${p}`, toString: (x) => `file://${p}` }),
  },
  editor: {
    _models: models,
    getModel: (uri) => models.get(uri.toString()) || null,
    createModel: (value, _lang, uri) => {
      const model = {
        uri,
        _value: String(value || ''),
        _disposed: false,
        getLanguageId() { return _lang || ''; },
        getValue() {
          if (this._disposed) {
            throw new Error('Model is disposed!');
          }
          return this._value;
        },
        setValue(v) {
          if (this._disposed) {
            throw new Error('Model is disposed!');
          }
          this._value = String(v);
        },
        isDisposed() { return this._disposed; },
        dispose() {
          this._disposed = true;
          models.delete(uri.toString());
        },
      };
      models.set(uri.toString(), model);
      return model;
    },
    setModelMarkers: jest.fn(),
    getModelMarkers: jest.fn(() => []),
    onDidCreateEditor: (cb) => { setTimeout(cb, 0); return { dispose() {} }; },
    registerEditorOpener: jest.fn(),
  },
  typescript: {
    typescriptDefaults: languageDefaults,
    javascriptDefaults,
  },
  languages: {
    registerCompletionItemProvider: jest.fn(() => ({ dispose() {} })),
    registerCodeActionProvider: jest.fn(() => ({ dispose() {} })),
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 4,
    },
    CompletionItemKind: {
      Function: 1,
      Method: 2,
      Keyword: 3,
      Module: 4,
      Property: 5,
      Snippet: 6,
      Text: 7,
      Variable: 8,
    },
    typescript: {
      typescriptDefaults: languageDefaults,
      javascriptDefaults,
    },
  },
};

module.exports = monaco;
