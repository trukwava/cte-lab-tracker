import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dateAfter,validateDate} from '../src/domain.ts';

test('maintenance dates reject impossible calendar dates without rollover',()=>{
 for(const date of ['2026-02-29','2026-04-31','2026-13-01','2026-00-01']){
   assert.equal(validateDate(date),false,date);
   assert.throws(()=>dateAfter(date,30),/Invalid calendar date/);
 }
 assert.equal(validateDate('2028-02-29'),true);
 assert.equal(dateAfter('2028-02-29',1),'2028-03-01');
});
