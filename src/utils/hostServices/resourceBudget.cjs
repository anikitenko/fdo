// Conservative provider + socket reservations, independent of application queues.
let bytes=0,channels=0;
function reserve(size,channel=false){if(bytes+size>256*1024*1024||channel&&channels>=32)return null;bytes+=size;if(channel)channels++;let released=false;return ()=>{if(released)return;released=true;bytes-=size;if(channel)channels--;};}
module.exports={reserve};
