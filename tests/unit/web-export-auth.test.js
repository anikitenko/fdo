/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {webServer} from '../../src/utils/plugins/exporting/webApplicationRuntime';

let directory, child, baseUrl;
const password = 'standalone-password-with-colon:and-unicode-é-🔐';
const basic = (user = 'engineer', secret = password) => 'Basic ' + Buffer.from(user + ':' + secret).toString('base64');
const request = authorization => fetch(baseUrl + '/', {headers: authorization ? {Authorization: authorization} : {}});

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'web-auth-'));
    fs.mkdirSync(path.join(directory, 'deployment'));
    fs.mkdirSync(path.join(directory, 'frontend'));
    fs.writeFileSync(path.join(directory, 'deployment/application.json'), '{}');
    fs.writeFileSync(path.join(directory, 'frontend/index.html'), '<p>Authenticated application</p>');
    fs.writeFileSync(path.join(directory, 'server.cjs'), '(' + webServer.toString() + ')();');
    fs.writeFileSync(path.join(directory, 'worker.cjs'), `
        require('node:fs').writeFileSync(require('node:path').join(__dirname,'worker-env.json'),JSON.stringify({hasPassword:Object.hasOwn(process.env,'WEB_APP_PASSWORD')}));
        process.on('message',({id,operation})=>process.send({id,result:true}));
        process.on('disconnect',()=>process.exit(0));
        process.send({ready:true});
    `);
    child = spawn(process.execPath, ['server.cjs'], {cwd: directory, env: {...process.env, NODE_PATH: path.resolve('node_modules'), PORT: '0', WEB_APP_USERNAME: 'engineer', WEB_APP_PASSWORD: password}, stdio: ['ignore', 'pipe', 'pipe']});
    await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('Auth server startup timed out: ' + output)), 10000);
        child.once('exit', code => {clearTimeout(timeout); reject(new Error('Auth server exited: ' + code + ' ' + output));});
        child.stderr.on('data', chunk => {output += chunk;});
        child.stdout.on('data', chunk => {
            output += chunk;
            const port = /Web application listening on port (\d+)/.exec(output)?.[1];
            if (port) {baseUrl = 'http://127.0.0.1:' + port; clearTimeout(timeout); resolve();}
        });
    });
}, 15000);

afterAll(async () => {
    if (child?.exitCode === null) await new Promise(resolve => {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 9000);
        child.once('exit', () => {clearTimeout(timeout); resolve();});
        child.kill('SIGTERM');
    });
    if (directory) fs.rmSync(directory, {recursive: true, force: true});
}, 12000);

test('valid credentials including colons and UTF-8 still authenticate', async () => {
    const response = await request(basic());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Authenticated application');
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'worker-env.json'), 'utf8'))).toEqual({hasPassword: false});
});

test.each([undefined, 'Bearer invalid', 'Basic !!!', basic('other-user'), basic('engineer', 'incorrect-password')])('rejects absent, malformed and incorrect credentials (%s)', async authorization => {
    const response = await request(authorization);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Basic realm=');
    expect(await response.text()).not.toContain('Authenticated application');
});

test('concurrent verification is bounded while health checks remain available', async () => {
    const attempts = Array.from({length: 16}, () => request(basic()));
    expect((await fetch(baseUrl + '/health/live')).status).toBe(200);
    const responses = await Promise.all(attempts);
    expect(responses.every(response => [200, 503].includes(response.status))).toBe(true);
    const overloaded = responses.filter(response => response.status === 503);
    expect(overloaded.length).toBeGreaterThan(0);
    expect(overloaded[0].headers.get('retry-after')).toBe('1');
    expect((await request(basic())).status).toBe(200);
});
