'use strict';
require('dotenv').config();
const {createClient}=require('@supabase/supabase-js');
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const heroes=require('../lib/heroImages')(client.storage,process.env.SUPABASE_IMAGES_BUCKET||'portfolio-images',process.env.SUPABASE_THUMBS_BUCKET||'portfolio-thumbs');
(async()=>{
 const {data:links,error}=await client.from('section_hero_images').select('image_id');if(error)throw error;
 const ids=[...new Set(links.map(link=>link.image_id))];if(!ids.length)return;
 const {data:images,error:imagesError}=await client.from('portfolio_images').select('*').in('id',ids);if(imagesError)throw imagesError;
 for(const row of images){const result=await heroes.ensure(row);console.log(JSON.stringify({id:row.id,widths:result.map(item=>item.width)}))}
 console.log('Generated responsive variants for '+images.length+' selected hero images.');
})().catch(error=>{console.error(error.message);process.exitCode=1});
