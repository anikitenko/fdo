// Minimal Monaco mock sufficient for VirtualFS unit tests and React components
const models = new Map();

function UriFile(path) {
  return {
    toString: () => `file://${path}`,
    toString: (skipEncoding) => `file://${path}`,
    path,
  };
}

const monaco = {
  Uri: {
    file: (p) => ({ toString: () => `file://${p}`, toString: (x) => `file://${p}` }),
  },
  editor: {
    _models: models,
    getModel: (uri) => models.get(uri.toString()) || null,
    createModel: (value, _lang, uri) => {
      const model = {
        uri,
        _value: String(value || ''),
        getValue() { return this._value; },
        setValue(v) { this._value = String(v); },
        dispose() { models.delete(uri.toString()); },
      };
      models.set(uri.toString(), model);
      return model;
    },
    setModelMarkers: jest.fn(),
    onDidCreateEditor: (cb) => { setTimeout(cb, 0); return { dispose() {} }; },
    registerEditorOpener: jest.fn(),
  },
  languages: {
    typescript: {
      typescriptDefaults: {
        addExtraLib: jest.fn(),
        getCompilerOptions: () => ({}),
        setCompilerOptions: jest.fn(),
      },
    },
  },
};

module.exports = monaco;
