import {ZipArchive} from 'archiver';
import {PassThrough} from 'node:stream';

export function exportArchive(files) {
    return new Promise((resolve,reject)=>{
        const archive=new ZipArchive({zlib:{level:9}}),output=new PassThrough(),chunks=[];
        output.on('data',chunk=>chunks.push(chunk));
        output.once('end',()=>resolve(Buffer.concat(chunks)));
        output.once('error',reject);archive.once('error',reject);archive.pipe(output);
        for(const [name,content] of Object.entries(files))archive.append(content,{name});
        void archive.finalize().catch(reject);
    });
}
