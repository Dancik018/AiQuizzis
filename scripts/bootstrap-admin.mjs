import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,ADMIN_INITIAL_PASSWORD}=process.env;
if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY||!ADMIN_INITIAL_PASSWORD)throw new Error('Set private bootstrap environment variables.');
if(ADMIN_INITIAL_PASSWORD.length<12)throw new Error('Use at least 12 characters.');
const db=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const existing=await db.from('profiles').select('id,is_admin').eq('email','ursud09@gmail.com').maybeSingle();
if(existing.error)throw new Error('Apply database migrations before bootstrapping.');
if(existing.data){if(!existing.data.is_admin)throw new Error('Existing non-administrator account: inspect manually.');console.log('Administrator already exists; password unchanged.');}
else {
 const created=await db.auth.admin.createUser({email:`aiquiz-bootstrap-${randomUUID()}@example.invalid`,password:ADMIN_INITIAL_PASSWORD,email_confirm:true,app_metadata:{admin_bootstrap:true}});
 if(created.error||!created.data.user)throw new Error('Could not create bootstrap identity.');
 const id=created.data.user.id;
 const updated=await db.auth.admin.updateUserById(id,{email:'ursud09@gmail.com',email_confirm:true,app_metadata:{admin_bootstrap:true}});
 if(updated.error)throw new Error('Bootstrap email update failed; inspect the temporary identity.');
 const finish=await db.rpc('bootstrap_administrator',{target:id});
 if(finish.error)throw new Error('Bootstrap role initialization failed; inspect database migration.');
 console.log('Administrator created; first login requires a new private password.');
}
