import {database,runFile} from './run-sql.mjs';
for(const baseline of [true,false]){
 const db=await database(baseline);
 try{
  await runFile(db,'supabase/test/samplo.sql',baseline);
  try{await runFile(db,'supabase/test/review-regressions.sql');}catch(e){if(!baseline)throw e;}
  await db.exec('reset role');console.log(JSON.stringify({baseline,checks:(await db.query('select * from review_results')).rows}));
 }finally{await db.close();}
}
