import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {parseCodexSkill} from './codexSkills';

export async function localCodexSkills() {
    const roots = new Set([path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills'),
        path.join(os.homedir(), '.agents', 'skills')]);
    const skills = [];
    for (const root of roots) {
        let entries;
        try {entries = await fs.readdir(root, {withFileTypes: true});}
        catch (error) {if (error.code === 'ENOENT') continue; throw error;}
        for (const entry of entries) {
            if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
            const file = path.join(root, entry.name, 'SKILL.md');
            let stat;
            try {stat = await fs.lstat(file);} catch (error) {if (['ENOENT','ENOTDIR','EACCES','ELOOP'].includes(error.code)) continue; throw error;}
            if (!stat.isFile() || stat.size > 64000) continue;
            const content = await fs.readFile(file, 'utf8');
            let skill;
            try {skill = parseCodexSkill(content);} catch {continue;}
            const key = createHash('sha256').update(file).update('\0').update(content).digest('hex');
            skills.push({...skill, file, key});
        }
    }
    return skills.sort((a,b) => a.name.localeCompare(b.name));
}
