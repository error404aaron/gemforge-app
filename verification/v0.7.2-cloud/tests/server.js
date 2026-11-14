const http=require('http'),fs=require('fs'),path=require('path');
const B=path.join(__dirname,'builds');let cur=process.argv[2]||'0.7.2';let offline=false;
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
http.createServer((q,r)=>{const u=new URL(q.url,'http://x');
 if(u.pathname==='/__ctl'){if(u.searchParams.get('v'))cur=u.searchParams.get('v');if(u.searchParams.has('offline'))offline=u.searchParams.get('offline')==='1';r.end(JSON.stringify({cur,offline}));return}
 if(offline){q.socket.destroy();return}
 if(!u.pathname.startsWith('/gemforge-app/')){r.writeHead(404);r.end();return}
 let p=u.pathname.slice('/gemforge-app/'.length)||'index.html';const f=path.join(B,cur,p);
 if(!f.startsWith(path.join(B,cur))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('nf');return}
 r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream','Cache-Control':'max-age=600'});fs.createReadStream(f).pipe(r);
}).listen(8765,()=>console.log('up',cur));
