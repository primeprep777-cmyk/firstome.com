import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const runtime=process.env.REVIEW_MODULES || new URL('./node_modules', import.meta.url).pathname;
const baselineRef=process.env.BASELINE_REF || '825ae54ebaaa27bad95632c76304cee2d4c4787c';
const {PGlite}=await import(runtime+'/@electric-sql/pglite/dist/index.js');
const {pgcrypto}=await import(runtime+'/@electric-sql/pglite/dist/contrib/pgcrypto.js');
export async function database(baseline=false){
 const db=new PGlite({extensions:{pgcrypto}, parsers:{1184:v=>v,1114:v=>v,1082:v=>v}}); await db.waitReady;
 for(const p of ['supabase/test/supabase-stub.sql','supabase/schema.sql','supabase/billing.sql','supabase/samplo.sql']) {
  const sql=baseline?execFileSync('git',['show',baselineRef+':'+p],{encoding:'utf8'}):fs.readFileSync(p,'utf8');
  await db.exec(sql);
 }
 return db;
}
// psql's two directives used by these fixtures: ON_ERROR_STOP and \gset.
// Execute one statement at a time, retaining session role and JWT GUC.
export function statements(sql){
 sql=sql.replace(/^\\set ON_ERROR_STOP 1\s*$/mg,'').replace(/\\gset/g,';--GSET\n');
 let result=[],start=0,quote=null,dollar=null,line=false,block=false;
 for(let i=0;i<sql.length;i++){
  let c=sql[i],n=sql[i+1];
  if(line){if(c==='\n')line=false;continue;}
  if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
  if(dollar){if(sql.startsWith(dollar,i)){i+=dollar.length-1;dollar=null;}continue;}
  if(quote){if(c===quote){if(n===quote)i++;else quote=null;}continue;}
  if(c==='-'&&n==='-'){line=true;i++;continue;}if(c==='/'&&n==='*'){block=true;i++;continue;}
  if(c==="'"||c==='"'){quote=c;continue;}
  if(c==='$'){let m=sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);if(m){dollar=m[0];i+=dollar.length-1;continue;}}
  if(c===';'){let g=sql.slice(i+1).startsWith('--GSET');result.push({sql:sql.slice(start,i+1),g});start=i+1;}
 }
 if(sql.slice(start).trim()) result.push({sql:sql.slice(start),g:false});return result;
}
export async function runFile(db,path,baseline=false){
 let vars=db.reviewVars ||= {},count=0;
 let source=baseline?execFileSync('git',['show',baselineRef+':'+path],{encoding:'utf8'}):fs.readFileSync(path,'utf8');
 for(const x of statements(source)){
  let sql=x.sql.replace(/:'(\w+)'/g,(_,k)=>{if(!(k in vars))throw Error('unset '+k);return "'"+(vars[k] instanceof Date ? vars[k].toISOString() : String(vars[k])).replaceAll("'","''")+"'";});
  try {let res=await db.exec(sql);if(x.g)Object.assign(vars,res.at(-1).rows[0]);count++;}
  catch(e){console.error(path,'statement',count+1,sql.slice(-1200));throw e;}
 }
 return count;
}
if(process.argv[1]?.endsWith('run-sql.mjs')){
 for(const baseline of [true,false]) for(const name of ['flow','billing','samplo']){
  const db=await database(baseline);try{let n=await runFile(db,'supabase/test/'+name+'.sql',baseline);console.log(JSON.stringify({baseline,suite:name,statements:n,result:'PASS',version:(await db.query('select version()')).rows[0]}));}finally{await db.close();}
 }
}
