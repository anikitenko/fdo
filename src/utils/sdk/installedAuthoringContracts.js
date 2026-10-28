import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import Ajv2020 from 'ajv/dist/2020';
import {valid, major} from 'semver';
import {HOST_AUTHORING_CONTRACT_MAJORS} from './pluginHostContract';

const artifacts = {dom: 'dom-authoring-contract', components: 'ui-components', previews: 'ui-previews'};
const validators = new Map();
const validatorFor = source => {
    if (!validators.has(source)) {
        if (validators.size >= 8) validators.clear();
        validators.set(source, new Ajv2020({strict: false}).compile(JSON.parse(source)));
    }
    return validators.get(source);
};

// Read published JSON exports, never execute SDK/frontend or workspace code.
// Contract majors are independent of SDK/handshake/capability versions.
export function readInstalledAuthoringContracts(packagePath) {
    packagePath = fs.realpathSync(packagePath);
    const manifest = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
    const resolve = Module.createRequire(path.join(packagePath, 'package.json'));
    const files = [], contracts = {};
    for (const [kind, name] of Object.entries(artifacts)) {
        const specifier = `@anikitenko/fdo-sdk/${name}.json`;
        if (!manifest.exports?.[`./${name}.json`]) {contracts[kind] = {status: 'absent'}; continue;}
        // Validation failures intentionally share this boundary with operation failures.
        try {
            const read = suffix => {
                const filename = resolve.resolve(`@anikitenko/fdo-sdk/${name}${suffix}.json`);
                const relative = path.relative(packagePath, filename);
                if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Contract export resolves outside the installed SDK.');
                return {path: relative.split(path.sep).join('/'), content: fs.readFileSync(filename, 'utf8')};
            };
            const file = read(''), data = JSON.parse(file.content);
            if (!valid(data.contractVersion) || !HOST_AUTHORING_CONTRACT_MAJORS[kind]?.includes(major(data.contractVersion))) {
                contracts[kind] = {status: 'unsupported', version: data.contractVersion, message: `FDO supports ${kind} authoring contract major ${HOST_AUTHORING_CONTRACT_MAJORS[kind]?.join(', ')} only.`}; continue;
            }
            if (kind !== 'previews' && data.sdkVersion !== manifest.version) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('Contract SDK version differs from the installed package.');
            }
            const validate = validatorFor(read('.schema').content);
            if (!validate(data)) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('Published contract failed schema validation: ' + JSON.stringify(validate.errors).slice(0, 700));
            }
            if (kind === 'previews' && (contracts.components?.status !== 'supported' || data.componentContractVersion !== contracts.components.version
                || data.cases.some(item => !contracts.components.data.components.some(component => component.identity === item.identity && component.states.includes(item.state))))) {
                    //noinspection ExceptionCaughtLocallyJS
                    throw new Error('Preview cases do not match the installed component contract.');
                }
            contracts[kind] = {status: 'supported', version: data.contractVersion, data};
            files.push(file);
        } catch (error) {contracts[kind] = {status: 'invalid', message: `${specifier}: ${error.message}`};}
    }
    return {sdkVersion: manifest.version, contracts, files};
}

export function installedSdkKnowledgeIdentity(packagePath, distPath) {
    return [packagePath, distPath, ...['package.json', 'dist/fdo-sdk.bundle.js', 'dist/@types/types.d.ts',
        'docs/SECRETS_AND_SSH.md', 'docs/FDO_HOST_SECRETS_SSH_HANDOFF.md',
        'docs/FDO_HOST_REMOTE_COMMANDS_HANDOFF.md', 'docs/SSH_TERMINALS.md', 'docs/FDO_HOST_TERMINAL_X11_HANDOFF.md',
        ...Object.values(artifacts).flatMap(name => [`dist/${name}.json`, `dist/${name}.schema.json`])].map(file => {
        try {const stat = fs.statSync(path.join(packagePath, file)); return `${file}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;}
        catch {return file + ':absent';}
    })].join('|');
}
