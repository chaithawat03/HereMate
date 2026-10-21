import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rules=readFileSync(new URL('../firebase/firestore.rules',import.meta.url),'utf8');
const docs=readFileSync(new URL('../docs/M0_5_3_FIRESTORE_AUTH_ADAPTERS.md',import.meta.url),'utf8');
test('M0.5.3 client rules are blanket deny for guest/Google/phone sessions',()=>{
 assert.match(rules,/rules_version\s*=\s*'2'/);
 assert.match(rules,/service cloud\.firestore/);
 assert.match(rules,/match \/\{document=\*\*\}/);
 const active=[...rules.split('\n').map(line=>line.replace(/\/\/.*$/,'').trim()).filter(line=>line.startsWith('allow '))];
 assert.deepEqual(active,['allow read, write: if false;']);
 assert.doesNotMatch(rules,/allow (?:read|write|create|list|get|update|delete): if true/);
 assert.doesNotMatch(rules,/request\.auth\.uid|allow read: if request\.auth/);
});
test('documented deployment gates forbid claiming emulator pass or live data access',()=>{
 assert.match(docs,/NOT DEPLOYED/);
 assert.match(docs,/NOT EMULATOR TESTED/);
 assert.match(docs,/least privilege/i);
});
