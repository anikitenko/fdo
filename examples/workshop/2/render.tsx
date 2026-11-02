import {DOM} from '@anikitenko/fdo-sdk';
import styles from './styles.css';
import {escapeText} from './text';

export function Render(name: string): string {
    const dom = new DOM();
    const classFor = (key: string) => dom.createClassFromStyle(styles[key]);
    const title = dom.createElement('h1', {}, escapeText(name));
    const intro = dom.createElement('p', {class: classFor('muted')}, 'Live API · Public GitHub repositories · One request per check');
    const field = dom.createElement('label', {for: 'repository', class: classFor('label')}, 'Repository (owner/name)')
        + dom.createElement('input', {id: 'repository', 'data-role': 'repository', type: 'text', value: 'anikitenko/fdo', maxlength: '140', autocomplete: 'off', spellcheck: 'false', class: classFor('field')});
    const button = dom.createElement('button', {type: 'button', 'data-role': 'check', class: classFor('button')}, 'Check latest release');
    const help = dom.createElement('p', {class: classFor('muted')}, 'Requires approved Network access, HTTPS requests, and Secure Public Web Scope in Manage Plugins. No token is used.');
    const result = dom.createElement('pre', {'data-role': 'result', role: 'status', 'aria-live': 'polite', class: classFor('result')}, 'No checks yet. Enter a public repository and check its latest release.');
    const link = dom.createElement('a', {'data-role': 'release-link', hidden: true, target: '_blank', rel: 'noopener noreferrer', class: classFor('link')}, 'Open GitHub release');
    return dom.renderHTML(dom.createElement('main', {class: classFor('shell')}, title + intro + dom.createElement('section', {class: classFor('panel')}, field + button + help + result + link)));
}
