import postcss from 'postcss';
import {planStyleAssignment} from './styleAssignments';
import {classNameError} from './classNames';

export function uniqueStyleName(files, base) {
    const occupied = name => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const token = new RegExp('(^|[^a-zA-Z0-9_-])' + escaped + '(?=$|[^a-zA-Z0-9_-])');
        return Object.values(files).some(source => token.test(source));
    };
    let name = base, suffix = 2;
    while (occupied(name)) name = base + '-' + suffix++;
    return name;
}

// Serialize the effective SDK style map, not just the local base rule. This
// retains imported declarations, states and conditional rules on the copy.
export function copiedStyleCss(style, name) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) throw new Error('The effective stylesheet could not be mapped. Use Show in code.');
    const root = postcss.root();
    const emit = (map, selector, parent) => {
        const rule = postcss.rule({selector});
        for (const [key, value] of Object.entries(map || {})) {
            if (typeof value === 'string') {
                if (!/^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/i.test(key)) throw new Error('Unsupported style declaration.');
                const important = /\s*!important\s*$/i.test(value);
                rule.append(postcss.decl({prop: key, value: important ? value.replace(/\s*!important\s*$/i, '') : value, important}));
            } else if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unsupported style value.');
        }
        parent.append(rule);
        for (const [key, value] of Object.entries(map || {})) if (value && typeof value === 'object') {
            const condition = /^@(media|supports|container)\s+(.+)$/i.exec(key);
            if (condition) {
                const block = postcss.atRule({name: condition[1], params: condition[2]});
                parent.append(block); emit(value, selector, block);
            } else if (key.startsWith('&') && !/[{},]/.test(key)) emit(value, selector + key.slice(1), parent);
            else if (/^\s+[^{}&,]+$/.test(key)) emit(value, selector + key, parent);
            else throw new Error('This class has selectors that need editing in the IDE.');
        }
    };
    emit(style, '.' + name, root);
    return root.toString();
}

export function isolationReason(element, style) {
    if (!element.styleAssignment || element.styles.length !== 1 || element.classNames.length !== 1 + (element.classNameAssignment?.base && element.classNameAssignment.value ? element.classNameAssignment.value.split(/\s+/).length : 0) ||
        !element.availableStyles?.some(item => item.file === style.file && item.key === style.key))
        return 'This element needs a single mapped class and static, unshared attributes. Use Show in code to separate its styles.';
    try {copiedStyleCss(style.copyStyle, 'live-ui-copy');} catch (error) {return error.message;}
    return '';
}

export function planStyleIsolation(files, elements, element, style) {
    const reason = isolationReason(element, style);
    if (reason) throw new Error(reason);
    // Name normalization is cosmetic; ownership is still tracked by the host
    // draft, never inferred from a user-controlled suffix or CSS comment.
    const base = style.key.replace(/(?:-local(?:-\d+)?)+$/, '') || style.key;
    const name = uniqueStyleName(files, base + '-local');
    const expression = planStyleAssignment(files, elements, element, {styleFile: style.file, styleKey: style.key});
    const replacement = expression.replacement.replace(JSON.stringify(style.key), JSON.stringify(name));
    const source = files[expression.file];
    const sourcePatch = {...expression, before: source, after: source.slice(0, expression.start) + replacement + source.slice(expression.end),
        replacement, removed: source.slice(expression.start, expression.end), added: replacement};
    const added = '\n\n/* Element style copied by Live UI. */\n' + copiedStyleCss(style.copyStyle, name) + '\n';
    return {name, patches: [sourcePatch, {file: style.file, start: files[style.file].length, end: files[style.file].length,
        before: files[style.file], after: files[style.file] + added, replacement: added, removed: '', added}]};
}

export function planNewStyle(files, element, request) {
    const target = element.styleAssignment;
    const sheet = element.styleSheets?.find(item => item.file === request.styleFile);
    if (!target || !sheet) throw new Error('Choose an imported stylesheet on an element with static, unshared attributes.');
    const error = classNameError(request.className);
    if (error) throw new Error('Invalid class name: ' + error);
    const name = uniqueStyleName(files, request.className);
    const base = `${target.receiver}.createClassFromStyle(${sheet.binding}[${JSON.stringify(name)}])`;
    const expression = element.classNameAssignment?.value ? `(${base}) + ${JSON.stringify(" "+element.classNameAssignment.value)}` : base;
    const replacement = target.insert ? `"class": ${expression}, ` : expression;
    const before = files[target.file];
    const added = `\n\n.${name} {\n}\n`;
    const description = `Create .${name} for this ${element.tag}`;
    const patches = [{...target, before, after: before.slice(0, target.start) + replacement + before.slice(target.end),
        replacement, removed: before.slice(target.start, target.end), added: replacement},
        {file: sheet.file, before: files[sheet.file], after: files[sheet.file] + added, start: files[sheet.file].length,
            end: files[sheet.file].length, removed: '', added, replacement: added}].map(patch => ({...patch, affected: 1, description}));
    return {...patches[0], patches, isolatedStyle: {file: sheet.file, key: name}};
}
