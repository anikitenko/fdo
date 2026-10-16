import {load, JSON_SCHEMA} from 'js-yaml';

export const MAX_CODEX_SKILLS = 50;
export const MAX_CODEX_SKILL_CHARACTERS = 16000;
const MAX_ASSIGNED_CHARACTERS = 64000;

export function parseCodexSkill(content) {
    if (typeof content !== 'string' || content.length > MAX_CODEX_SKILL_CHARACTERS || content.includes('\0')) {
        throw new Error('Import a SKILL.md file containing at most 16000 characters.');
    }
    const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n([\s\S]+)$/.exec(content);
    if (!match) throw new Error('SKILL.md needs YAML front matter with name and description, followed by instructions.');
    let metadata;
    try {metadata = load(match[1], {schema: JSON_SCHEMA});}
    catch {throw new Error('SKILL.md has invalid YAML front matter.');}
    if (!metadata || typeof metadata.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) || metadata.name.length > 64) {
        throw new Error('The skill name must use lowercase letters, numbers, and single hyphens (at most 64 characters).');
    }
    if (typeof metadata.description !== 'string' || !metadata.description.trim() || metadata.description.length > 1024 || !match[2].trim()) {
        throw new Error('Provide a description of at most 1024 characters and non-empty skill instructions.');
    }
    return {name: metadata.name, description: metadata.description.trim(), content: content.replace(/^\uFEFF/, '')};
}

export function codexAssistantChoices(assistants) {
    return (assistants || []).filter(assistant => assistant.provider === 'codex-cli' && assistant.id)
        .map(({id, name, model}) => ({id, name, model}));
}

export function validateCodexSkillAssignments(skills, assistants) {
    const allowed = new Set(codexAssistantChoices(assistants).map(assistant => assistant.id));
    const names = new Set();
    if (!Array.isArray(skills) || skills.length > MAX_CODEX_SKILLS) throw new Error('Import at most 50 Codex skills.');
    for (const skill of skills) {
        const parsed = parseCodexSkill(skill.content);
        if (parsed.name !== skill.name || names.has(skill.name)) throw new Error('Each imported skill must have a unique, matching name.');
        names.add(skill.name);
        if (typeof skill.enabled !== 'boolean' || !Array.isArray(skill.assistantIds)
            || skill.assistantIds.some(id => !allowed.has(id)) || new Set(skill.assistantIds).size !== skill.assistantIds.length) {
            throw new Error('Assign skills only to existing Codex coding assistants. Refresh the list if an assistant was removed.');
        }
    }
    for (const id of allowed) {
        if (skills.filter(skill => skill.enabled && skill.assistantIds.includes(id)).reduce((size, skill) => size + skill.content.length, 0) > MAX_ASSIGNED_CHARACTERS) {
            throw new Error('Assigned skill instructions exceed 64000 characters for one assistant. Disable or unassign some skills.');
        }
    }
}

export function selectedCodexSkills(skills, assistantId) {
    const selected = (skills || []).filter(skill => skill.enabled && skill.assistantIds?.includes(assistantId))
        .map(skill => ({...parseCodexSkill(skill.content)}));
    if (selected.length > MAX_CODEX_SKILLS || selected.reduce((size, skill) => size + skill.content.length, 0) > MAX_ASSIGNED_CHARACTERS) {
        throw new Error('Assigned Codex skills exceed the session instruction budget. Review AI Extensions.');
    }
    return selected;
}

export function codexSkillInvocation(names = []) {
    if (!names.length) return '';
    return `Use these assigned instruction-only skills: ${names.map(name => '$' + name).join(', ')}. Apply relevant guidance while preserving the user's requirements, plugin isolation, SDK contracts, and the exact output format of this step. Supporting skill files, scripts, and hooks are unavailable. Only separately configured MCP tools may be used.\n\n`;
}
