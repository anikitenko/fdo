import {inlineMoveDependencies} from './moveDependencies';

const tags = new Set(['p','span','h1','h2','h3','h4','h5','h6','small','strong','em','blockquote','pre','code','button','hr','section','div','article','aside','header','footer','nav']);
const attributes = new Set(['class','className','style','role','aria-label','aria-description','aria-live','aria-hidden','title','type','disabled']);
const passiveRoles = new Set(['none','presentation','status','alert','note','region','heading','group','article','list','listitem','separator','paragraph','strong','emphasis','code','blockquote','caption','figure','generic','document']);

// Prove the entire copied expression, not just the selected root. Named markup,
// opaque HTML and helper output cannot hide identities or bindings in a card.
export function sdkDuplicateInspector(elements, calls, evaluated) {
    const byNode = new Map(elements.map(element => [calls.get(element.id)?.node, element]));
    return element => {
        const owner = calls.get(element.id);
        let budget = 2000, count = 0, reason = '';
        const reject = message => {reason ||= message; return false;};
        const visit = node => {
            if (!node) return true;
            if (--budget < 0) return reject('This composition exceeds the duplication budget. Use a smaller block.');
            if (node.type === 'BinaryExpression' && node.operator === '+') return visit(node.left) && visit(node.right);
            if (['StringLiteral','NumericLiteral','BooleanLiteral','NullLiteral','Identifier'].includes(node.type)) {
                const value = node.type === 'Identifier' ? owner.scopeValues.get(node.name) : node.value;
                return typeof value !== 'string' || !value.includes('<') || reject('Named or raw HTML content must be edited in the IDE before duplicating this container.');
            }
            const child = byNode.get(node), call = child && calls.get(child.id);
            if (!child || child.sdkComponent || !child.structure.unique || call.dom !== owner.dom || call.file !== owner.file
                || node.callee?.type !== 'MemberExpression' || node.callee.property.name !== 'createElement') {
                return reject('All descendants must be unique inline SDK elements using the same DOM. Shared fragments and component controllers stay in code.');
            }
            if (!tags.has(child.tag) || child.tag === 'button' && call.attributes.disabled !== true
                || String(call.attributes.role || '').toLowerCase().split(/\s+/).filter(Boolean).some(role => !passiveRoles.has(role))) {
                return reject('This block contains a control, overlay or unsupported element. Keep its behavior in code.');
            }
            if (Object.keys(call.attributes).some(name => !attributes.has(name))) {
                return reject('This block contains identity, reference or binding attributes. Update those relationships in the IDE.');
            }
            count++;
            return visit(node.arguments[2]);
        };
        if (!inlineMoveDependencies(owner.node, owner, evaluated)) return {reason:'Duplicate needs inline same-DOM SDK composition with safe inputs; computed/helper calls stay in code.'};
        return visit(owner.node) ? {count} : {reason};
    };
}
