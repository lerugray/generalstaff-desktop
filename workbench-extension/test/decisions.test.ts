import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDecisionCards } from '../src/services/decisions.js';

test('extracts a bounded structured decision without trusting provider identifiers', () => {
  let sequence = 0;
  const source = `We can proceed after one choice.\n\n<gs-decision>{"title":"Choose the slice","question":"Which bounded slice should ship first?","options":[{"id":"provider-owned","label":"Playable loop","description":"Prioritize operator feel."},{"label":"Import path","description":"Prioritize existing data."}]}</gs-decision>`;
  const result = extractDecisionCards(source, 'assistant-one', 42, () => `local-${++sequence}`);
  assert.equal(result.text, 'We can proceed after one choice.');
  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0]?.id, 'local-1');
  assert.equal(result.decisions[0]?.options[0]?.id, 'local-2');
  assert.equal(result.decisions[0]?.options[0]?.label, 'Playable loop');
  assert.equal(result.decisions[0]?.messageId, 'assistant-one');
});

test('leaves malformed, duplicate, or oversized decision blocks visible as ordinary text', () => {
  const malformed = '<gs-decision>{not-json}</gs-decision>';
  assert.deepEqual(extractDecisionCards(malformed, 'one', 1, () => 'id'), { text: malformed, decisions: [] });

  const duplicate = '<gs-decision>{"title":"Choose","question":"Which?","options":[{"label":"Same"},{"label":"same"}]}</gs-decision>';
  assert.deepEqual(extractDecisionCards(duplicate, 'one', 1, () => 'id'), { text: duplicate, decisions: [] });

  const tooMany = '<gs-decision>{"title":"Choose","question":"Which?","options":[{"label":"1"},{"label":"2"},{"label":"3"},{"label":"4"},{"label":"5"}]}</gs-decision>';
  assert.deepEqual(extractDecisionCards(tooMany, 'one', 1, () => 'id'), { text: tooMany, decisions: [] });
});
