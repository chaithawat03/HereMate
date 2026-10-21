/** Strict static regression tests for M1.0 owner-only profile rules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rules=readFileSync(new URL('../firebase/firestore.rules',import.meta.url),'utf8');
test('M1.0 profiles are get/create/update owner-only; no cross-account list or GPS sharing',()=>{
 assert.match(rules,/rules_version\s*=\s*'2'/);
 assert.match(rules,/match \/users\/\{uid\}/);
 assert.match(rules,/request\.auth\.uid == uid/);
 assert.match(rules,/allow list: if false;/);
 assert.match(rules,/allow get: if owner\(uid\);/);
 assert.match(rules,/allow create: if owner\(uid\)/);
 assert.match(rules,/allow update: if owner\(uid\)/);
 assert.match(rules,/allow delete: if false;/);
 assert.match(rules,/data\.shareLocation == false/);
 assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['displayName', 'updatedAt'\]\)/);
 assert.match(rules,/match \/\{document=\*\*\}/);
 assert.match(rules,/allow read, write: if false;/);
 assert.doesNotMatch(rules,/allow (?:read|write|create|list|get|update|delete): if true/);
});
