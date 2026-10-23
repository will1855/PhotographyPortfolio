'use strict';
const path=require('path').posix;
const sharp=require('sharp');
// Only selected hero photographs get these derivatives. No database migration.
module.exports=function heroImages(storage,fullBucket,thumbBucket){
 const cache=new Map();
 const prefix=row=>path.basename(row.storage_path_thumb,'.webp')+'-hero-v1-';
 async function variants(row){
  const key=row.storage_path_thumb,saved=cache.get(key);
  if(saved&&saved.until>Date.now())return saved.promise;
  const promise=(async()=>{
   const dir=path.dirname(key),name=prefix(row);
   const {data,error}=await storage.from(thumbBucket).list(dir,{search:name,limit:10});
   if(error)return [];
   return (data||[]).filter(file=>file.name.startsWith(name)&&/\d+\.webp$/.test(file.name))
    .map(file=>({width:Number(file.name.slice(name.length).replace('.webp','')),url:storage.from(thumbBucket).getPublicUrl(dir+'/'+file.name).data.publicUrl}));
  })();
  cache.set(key,{until:Date.now()+60000,promise});
  while(cache.size>32)cache.delete(cache.keys().next().value);
  return promise;
 }
 async function ensure(row){
  const existing=await variants(row);
  const expected=[...new Set([2560,3840].map(w=>Math.min(w,Number(row.width)||w)))];
  if(expected.every(w=>existing.some(item=>item.width===w)))return existing;
  const {data,error}=await storage.from(fullBucket).download(row.storage_path_full);
  if(error)throw error;
  const source=Buffer.from(await data.arrayBuffer());
  const seen=new Set();
  for(const width of [2560,3840]){
   const {data:buffer,info}=await sharp(source).rotate().resize({width,withoutEnlargement:true}).webp({quality:86,effort:4}).toBuffer({resolveWithObject:true});
   if(seen.has(info.width))continue;seen.add(info.width);
   const target=path.dirname(row.storage_path_thumb)+'/'+prefix(row)+info.width+'.webp';
   const {error:uploadError}=await storage.from(thumbBucket).upload(target,buffer,{contentType:'image/webp',cacheControl:'31536000',upsert:false});
   if(uploadError&&!/already exists|duplicate/i.test(uploadError.message))throw uploadError;
  }
  cache.delete(row.storage_path_thumb);return variants(row);
 }
 async function sources(row){
  const full=storage.from(fullBucket).getPublicUrl(row.storage_path_full).data.publicUrl;
  const thumb=storage.from(thumbBucket).getPublicUrl(row.storage_path_thumb).data.publicUrl;
  const grid=storage.from(thumbBucket).getPublicUrl(row.storage_path_thumb.replace(/\.webp$/i,'-grid.webp')).data.publicUrl;
  const generated=await variants(row),width=Number(row.width)||3840,height=Number(row.height)||Math.round(width*2/3);
  const candidates=[{url:grid,width:Math.min(600,width)},{url:thumb,width:Math.min(1600,width)},...generated];
  // An older photo selected before derivatives exist can still display sharply.
  if(!generated.length&&width>1600)candidates.push({url:full,width});
  const unique=new Map();for(const c of candidates)unique.set(c.width,c.url);
  return {srcset:[...unique].sort((a,b)=>a[0]-b[0]).map(([w,url])=>url+' '+w+'w').join(', '),
   sizes:'(min-aspect-ratio: '+width+'/'+height+') 102vw, '+Math.ceil(102*width/height)+'vh'};
 }
 return {ensure,sources};
};
