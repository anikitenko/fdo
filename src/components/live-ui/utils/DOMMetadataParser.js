export const DOMMetadataParser = (metadata) => ({
    getClasses: () => metadata.map(cls => cls.className),

    getConstructors: (className) => {
        const cls = metadata.find(cls => cls.className === className);
        return cls?.constructors || [];
    },

    getConstructorParams: (className) => {
        const ctors = DOMMetadataParser(metadata).getConstructors(className);
        return ctors.map(ctor => ctor.parameters || []);
    },

    getConstructorMeta: (className) => {
        const ctors = DOMMetadataParser(metadata).getConstructors(className);
        return ctors.map(ctor => {
            const { parameters, ...meta } = ctor;
            return meta;
        });
    },

    getMethods: (className) => {
        const cls = metadata.find(cls => cls.className === className);
        return cls?.methods || [];
    },

    getMethod: (className, methodName) => {
        const cls = metadata.find(cls => cls.className === className);
        return cls?.methods.find(method => method.name === methodName);
    }
});
