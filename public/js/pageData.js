// Small, bounded metadata cache for this tab only. Never stores photo bytes.
const entries=new Map();
const TTL=60000,MAX=8;
export function seedPageData(url,value){
 entries.delete(url);entries.set(url,{value,expires:Date.now()+TTL});
 while(entries.size>MAX)entries.delete(entries.keys().next().value);
}
export function pageData(url){
 const saved=entries.get(url);
 if(saved?.pending)return saved.pending;
 if(saved&&saved.expires>Date.now())return Promise.resolve(saved.value);
 const entry={};
 entry.pending=fetch(url).then(response=>{
  if(!response.ok)throw new Error('Unable to load '+url);
  return response.json();
 }).then(value=>{if(entries.get(url)===entry)seedPageData(url,value);return value;})
 .catch(error=>{if(entries.get(url)===entry)entries.delete(url);throw error;});
 entries.set(url,entry);
 while(entries.size>MAX)entries.delete(entries.keys().next().value);
 return entry.pending;
}
