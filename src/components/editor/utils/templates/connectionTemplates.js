import {sshConnectionTemplateFiles} from './sshConnectionTemplate';
import {gitConnectionTemplateFiles} from './gitConnectionTemplate';

export function connectionTemplateFiles(name, template) {
    return template === 'ssh' ? sshConnectionTemplateFiles(name) : gitConnectionTemplateFiles(name);
}
