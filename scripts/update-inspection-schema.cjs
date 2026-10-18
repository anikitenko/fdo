// Refresh only the empty, ignored IDE schema fixture. Never open application data.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/utils/hostServices/database.cjs'),'utf8');
const schema=source.match(/`(PRAGMA[\s\S]*?)`/);
if(!schema)throw new Error('Host vault schema was not found. Update this fixture generator for the new schema layout.');
const filename=path.join(root,'.idea/fdo-inspections.sqlite');
if(!fs.existsSync(filename))throw new Error('The empty FDO inspection schema fixture must exist before refreshing host tables.');
const db=new DatabaseSync(filename);
try{
 // Copy schema definitions only; no credential provider or application database is used.
 for(const statement of schema[1].split(';').map(value=>value.trim()).filter(value=>value.startsWith('CREATE TABLE')))db.exec(statement);
 console.log('Updated the empty IDE schema with host service table definitions. Refresh the FDO development schema data source in WebStorm.');
}finally{db.close();}
