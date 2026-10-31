export function deploymentSetup() {
    const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
    const destination=path.join(__dirname,'.env');
    if(fs.existsSync(destination)){console.log('.env already exists; existing access and encryption keys were preserved.');return;}
    const password=crypto.randomBytes(32).toString('base64url'),key=crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(destination,`WEB_APP_USERNAME=engineer\nWEB_APP_PASSWORD=${password}\nWEB_APP_SECRET_KEY=${key}\nWEB_APP_ORIGIN=http://localhost:8080\n`,{flag:'wx',mode:0o600});
    const owner=fs.statSync(__dirname);if(process.getuid?.()===0)fs.chownSync(destination,owner.uid,owner.gid);
    console.log('Created .env with unique sign-in credentials and encryption key. Read it locally to sign in. Keep it private and backed up.');
}
