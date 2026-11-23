'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('./helpers');
const map = new Map();
let quota = false;
globalThis.localStorage = {
  getItem: key => map.get(key) || null,
  setItem: (key, value) => { if (quota) throw new Error('Synthetic quota failure'); map.set(key, String(value)); },
  key: index => [...map.keys()][index],
  get length() { return map.size; }
};
load();
require('../assets/js/storage/store.js');
require('../assets/js/ui/gos.js');
const S = globalThis.GOS.storage;
const batch = id => ({
  experiences: [{id:'exp:'+id, score:8}], signals:[{id:'sig:'+id}],
  evidence:[{id:'media:'+id}], games:[{id:'game:a',name:'new'}],
  library:[{id:'lib:a',status:'completed'}]
});
test('normal save commits every collection, preserves existing game/library, and rejects conflicts atomically', async () => {
  await S.init();
  await S.put('games',{id:'game:a',name:'Existing name'});
  await S.put('library',{id:'lib:a',status:'backlog'});
  await S.saveExperienceBatch(batch('one'));
  for(const name of ['experiences','signals','evidence']) assert.equal((await S.all(name)).length,1);
  assert.equal((await S.get('games','game:a')).name,'Existing name');
  assert.equal((await S.get('library','lib:a')).status,'backlog');
  const before=map.get('icyNaturalGameOS.db.v2');
  const conflict=batch('two');conflict.signals=[{id:'sig:one',changed:true}];
  await assert.rejects(S.saveExperienceBatch(conflict),/conflict/);
  assert.equal(map.get('icyNaturalGameOS.db.v2'),before);
  assert.equal(await S.get('experiences','exp:two'),null);
});
test('quota failure rejects normal save without changing persistent data or cached collections', async () => {
  const before=map.get('icyNaturalGameOS.db.v2');quota=true;
  try { await assert.rejects(S.saveExperienceBatch(batch('quota')),/quota/); }
  finally { quota=false; }
  assert.equal(map.get('icyNaturalGameOS.db.v2'),before);
  for(const [collection,id] of [['experiences','exp:quota'],['signals','sig:quota'],['evidence','media:quota']]) assert.equal(await S.get(collection,id),null);
});
test('invalid batch shapes reject before any write', async () => {
  for(const value of [null,{}, {experiences:[]}, {experiences:[{id:'a'}],unexpected:[]}, {experiences:[{}]}]) await assert.rejects(S.saveExperienceBatch(value));
});
test('new entry domain validation rejects missing/coerced/out-of-range ratings and null totals', async () => {
  const keys=GOS.signals.CORE_DIMENSIONS.map(d=>d.key);
  const valid=Object.fromEntries(keys.map(k=>[k,8]));Object.assign(valid,{gameName:'Synthetic',platform:'PC'});
  for(const value of [null,undefined,'', '8',NaN,Infinity,0,11]) {
    await assert.rejects(GOS.gos.saveExperience({...valid,[keys[0]]:value},8,'test'),/unanswered rating/);
  }
  for(const value of [null,undefined,'8',NaN,Infinity,0,11]) await assert.rejects(GOS.gos.saveExperience(valid,value,'test'),/complete scored/);
});