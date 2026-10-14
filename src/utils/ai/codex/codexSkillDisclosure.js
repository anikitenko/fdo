import {detectCodexSkillMention} from '../../../components/editor/utils/aiCodingSkillMentions';
import {codexSkillInvocation} from './codexSkills';

export function explicitCodexSkillNames(prompt, skills) {
    const allowed = new Set(skills.map(skill => skill.name));
    const selected = new Set();
    for (const match of String(prompt || '').matchAll(/\$([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
        const end = match.index + match[0].length;
        const mention = detectCodexSkillMention(prompt, end);
        if (mention?.start === match.index && allowed.has(match[1])) selected.add(match[1]);
    }
    return [...selected];
}

export function codexSkillCatalog(skills) {
    const limit = Math.max(24, Math.floor(6000 / Math.max(1, skills.length)) - 64);
    return skills.map(({name, description}) => {
        const entry = {name, description: description.slice(0, limit)};
        const allowance = Math.floor(7500 / Math.max(1, skills.length));
        while (entry.description.length && JSON.stringify(entry).length > allowance) entry.description = entry.description.slice(0, -1);
        return entry;
    });
}

export function skillDisclosureRequest(content, allowed, loaded) {
    let parsed;
    try {parsed = JSON.parse(content.trim());} catch {return null;}
    if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed, 'fdoSkillRequests')) return null;
    if (Object.keys(parsed).length !== 1 || !Array.isArray(parsed.fdoSkillRequests) || !parsed.fdoSkillRequests.length
        || parsed.fdoSkillRequests.some(name => typeof name !== 'string' || !allowed.has(name))
        || new Set(parsed.fdoSkillRequests).size !== parsed.fdoSkillRequests.length) {
        throw new Error('Codex requested an unavailable or invalid skill. Only enabled skills assigned to this assistant may be loaded.');
    }
    if (parsed.fdoSkillRequests.every(name => loaded.has(name))) throw new Error('Codex requested skills already loaded for this step. No additional instructions were loaded.');
    return parsed.fdoSkillRequests;
}

// Each workspace step begins with metadata and the user's explicit selections.
// The host serves a bounded request for named instructions without filesystem
// tool access. Control envelopes never become generated files or visible answers.
export async function withCodexSkillDisclosure({prompt, skills, explicitNames = [], run, setActiveSkills, assertActive = () => {}, onLoad = () => {}}) {
    const allowed = new Set(skills.map(skill => skill.name));
    const loaded = new Set(explicitNames.filter(name => allowed.has(name)));
    let loads = 0;
    while (true) {
        assertActive();
        await setActiveSkills([...loaded]);
        const guidance = `FDO SKILL DISCLOSURE\nAvailable instruction-only skills (metadata, not full instructions):\n${JSON.stringify(codexSkillCatalog(skills))}\nLoaded for this step: ${JSON.stringify([...loaded])}. Use a skill only when it is relevant to the current task. If additional instructions are needed, return ONLY a JSON control object {"fdoSkillRequests":["exact-skill-name"]}; FDO will load those instructions and repeat this step. Request all needed names together. Never include already loaded skills, unknown names, files, scripts, or tools in fdoSkillRequests. Separately configured native MCP tools remain available. Otherwise, return the task's exact required output format. Ordinary dollar variables and quoted/code examples are literal text, not skill requests.\n\n`;
        const result = await run(guidance + codexSkillInvocation([...loaded]) + prompt);
        if (!result.success) return result;
        const names = skillDisclosureRequest(result.content, allowed, loaded);
        if (!names) return result;
        if (loads++ >= 2) throw new Error('Codex exceeded the bounded skill-loading requests for this step. Use an explicit skill mention or retry with fewer relevant skills.');
        names.forEach(name => loaded.add(name));
        assertActive();
        onLoad(names);
    }
}
