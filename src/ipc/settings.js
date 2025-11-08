import {ipcMain} from "electron";
import {SettingsChannels} from "./channels";
import {settings} from "../utils/store";
import {Certs} from "../utils/certs";
import LLM from "@themaximalist/llm.js"

export function registerSettingsHandlers() {
    ipcMain.handle(SettingsChannels.certificates.GET_ROOT, async () => {
        return settings.get('certificates.root') || [];
    });

    ipcMain.handle(SettingsChannels.certificates.CREATE, async () => {
        const randomName = (Math.random() + 1).toString(36).substring(2)
        Certs.generateRootCA(randomName);
    });

    ipcMain.handle(SettingsChannels.certificates.RENAME, async (event, oldName, newName) => {
        if (newName) {
            Certs.setLabel(oldName, newName);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.EXPORT, async (event, id) => {
        if (id) {
            const data = Certs.export(id);
            return data.cert
        }
    });

    ipcMain.handle(SettingsChannels.certificates.IMPORT, async (event, file) => {
        if (file) {
            return await Certs.import(file);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.DELETE, async (event, id) => {
        if (id) {
            const roots = settings.get('certificates.root') || [];
            const newRoots = roots.filter((root) => root.id !== id);
            settings.set('certificates.root', newRoots);
        }
    });

    ipcMain.handle(SettingsChannels.certificates.RENEW, async (event, label) => {
        Certs.generateRootCA(label, true);
    });

    ipcMain.handle(SettingsChannels.ai_assistants.GET, async () => {
        const chat   = settings.get('ai.chat',   []) || [];
        const coding = settings.get('ai.coding', []) || [];

        // If you need types, *don't* write back to settings here
        return [
            ...chat.map(a => ({...a, purpose: 'chat'})),
            ...coding.map(a => ({...a, purpose: 'coding'})),
        ].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    });

    ipcMain.handle(SettingsChannels.ai_assistants.ADD, async (_, data) => {
        const llm = new LLM({
            service: data.provider,        // LLM service provider
            apiKey: data.apiKey,          // apiKey
            model: data.model,          // Specific model
        });
        const isConnected = await llm.verifyConnection();
        if (!isConnected) {
            throw new Error(`API Key verification failed for ${data.provider} and model ${data.model}. Please check your API key and model.`);
        }
        // Upsert assistant WITHOUT touching `default`
// (unless it's a brand-new item, and you want the very first one to be default)
        const key = `ai.${data.purpose}`;
        const now = new Date().toISOString();
        const list = (settings.get(key, []) || []).slice();

        const norm = v => String(v ?? "").trim().toLowerCase();
        const target = norm(data.name);

        const i = list.findIndex(a => norm(a.name) === target);

        const {purpose, ...cleanData} = data;

        if (i >= 0) {
            list[i] = { ...list[i], ...cleanData, updatedAt: now };
        } else {
            list.push({
                id: crypto.randomUUID(),
                ...cleanData,
                // optional: first ever becomes default
                default: list.length === 0,
                createdAt: now,
                updatedAt: now,
            });
        }

        settings.set(key, list);
    });

    ipcMain.handle(SettingsChannels.ai_assistants.SET_DEFAULT, async (_, data) => {
        // Make exactly one assistant default by name (case-insensitive)
        const key = `ai.${data.purpose}`;
        const list = (settings.get(key, []) || []).map(a => ({
            ...a,
            default: false,
        }));

        const norm = v => String(v ?? "").trim().toLowerCase();
        const idx = list.findIndex(a => norm(a.name) === norm(data.name));
        if (idx >= 0) {
            list[idx] = { ...list[idx], default: true, updatedAt: new Date().toISOString() };
        }
        settings.set(key, list);
    });

    ipcMain.handle(SettingsChannels.ai_assistants.REMOVE, async (_, data) => {
        const key = `ai.${data.purpose}`;
        const raw = settings.get(key, []) || [];

        if (!['chat', 'coding'].includes(data.purpose)) {
            throw new Error(`[REMOVE] invalid purpose "${data.purpose}"`);
        }
        console.log('[REMOVE] key', key, 'payload', { purpose: data.purpose, id: data.id, name: data.name });

        // --- helpers ---
        const norm = v => String(v ?? '').trim().toLowerCase();
        const sameId = (a, id) => id && a.id === id;
        const sameName = (a, name) => name && norm(a.name) === norm(name);
        const toMillis = v => {
            const t = new Date(v || 0).getTime();
            return Number.isFinite(t) ? t : 0;
        };
        const coerceDefault = v => v === true || v === 'true'; // booleanize

        // Normalize booleans (in case something stored strings)
        const list = raw.map(a => ({ ...a, default: coerceDefault(a.default) }));

        // --- locate item to remove ---
        const idx = list.findIndex(a => sameId(a, data.id) || sameName(a, data.name));
        if (idx === -1) {
            return list;
        }

        const [removed] = list.splice(idx, 1);

        // If nothing left, just save empty
        if (list.length === 0) {
            settings.set(key, []);
            return [];
        }

        // Do we still have a default after removal?
        let hasDefaultLeft = list.some(a => a.default);

        // If we removed a default OR no default exists, choose the most-recent one
        if (coerceDefault(removed?.default) || !hasDefaultLeft) {
            // pick most-recent by updatedAt (fallback createdAt)
            let bestIdx = 0;
            let bestT = toMillis(list[0].updatedAt || list[0].createdAt);

            for (let i = 1; i < list.length; i++) {
                const t = toMillis(list[i].updatedAt || list[i].createdAt);
                if (t > bestT) {
                    bestT = t;
                    bestIdx = i;
                }
            }

            // Flip defaults so exactly one is true
            const now = new Date().toISOString();
            for (let i = 0; i < list.length; i++) {
                list[i] = {
                    ...list[i],
                    default: i === bestIdx,
                    // bump recency for the chosen default so ordering is consistent
                    updatedAt: i === bestIdx ? now : list[i].updatedAt,
                };
            }
        }

        // Final guard: ensure exactly one default (in case upstream data was weird)
        if (!list.some(a => a.default)) {
            // choose most-recent defensively
            let bestIdx = 0;
            let bestT = toMillis(list[0].updatedAt || list[0].createdAt);
            for (let i = 1; i < list.length; i++) {
                const t = toMillis(list[i].updatedAt || list[i].createdAt);
                if (t > bestT) { bestT = t; bestIdx = i; }
            }
            list[bestIdx] = { ...list[bestIdx], default: true, updatedAt: new Date().toISOString() };
        } else {
            // normalize: if multiple defaults slipped in somehow, keep the most-recent one
            const defaultIdxs = list
                .map((a, i) => ({ i, t: toMillis(a.updatedAt || a.createdAt), d: a.default }))
                .filter(x => x.d)
                .sort((x, y) => y.t - x.t) // most recent first
                .map(x => x.i);

            if (defaultIdxs.length > 1) {
                for (let k = 1; k < defaultIdxs.length; k++) {
                    const i = defaultIdxs[k];
                    list[i] = { ...list[i], default: false };
                }
            }
        }

        settings.set(key, list);
    });
}