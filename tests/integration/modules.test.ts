import {test,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {openDb} from '../../src/server/db/client';
import {createModule,listModules} from '../../src/features/library/service';
test('modules survive reopening and duplicate codes conflict',()=>{
 const path=mkdtempSync(`${tmpdir()}/practice-`)+'/app.sqlite';
 const db=openDb(path); createModule(db,{code:'CS2100',title:'Computer Organisation'}); createModule(db,{code:'CS2103',title:'Software Engineering'});
 expect(()=>createModule(db,{code:'cs 2100',title:'Duplicate'})).toThrow(); db.close();
 const again=openDb(path); expect(listModules(again).map(x=>x.code).sort()).toEqual(['CS2100','CS2103']); again.close();
});
