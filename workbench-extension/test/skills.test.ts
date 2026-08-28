import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { compileSkillBundle, discoverSkills, resolveSkillInvocation } from '../src/services/skills.js';

test('discovers canonical skills without exposing hidden, malformed, or tombstoned entries', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-skills-test-'));
  context.after(async () => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'skills', 'audit', 'references'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills', 'lean-ctx'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills', 'Bad_Name'), { recursive: true });
  await fs.writeFile(path.join(root, 'skills', 'audit', 'SKILL.md'), '---\nname: audit\ndescription: Check the plan.\n---\n\n# Audit\nUse Read and AskUserQuestion.\n');
  await fs.writeFile(path.join(root, 'skills', 'audit', 'references', 'lens.md'), '# Lens\nKeep it bounded.\n');
  await fs.writeFile(path.join(root, 'skills', 'lean-ctx', 'SKILL.md'), '---\nname: lean-ctx\ndescription: Never load.\n---\n');
  await fs.writeFile(path.join(root, 'skills', 'Bad_Name', 'SKILL.md'), '# Invalid');

  const skills = await discoverSkills(root);
  assert.deepEqual(skills.map((skill) => skill.id), ['audit']);
  assert.equal(skills[0]?.name, 'audit');
  assert.equal(skills[0]?.fileCount, 2);
  assert.match(skills[0]?.description ?? '', /Check the plan/);
});

test('compiles a bounded provider-neutral bundle with companion files and secret redaction', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-skill-bundle-test-'));
  context.after(async () => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'skills', 'audit');
  await fs.mkdir(path.join(directory, 'references'), { recursive: true });
  await fs.writeFile(path.join(directory, 'SKILL.md'), '---\nname: audit\ndescription: Check the plan.\n---\n\nUse AskUserQuestion and Read. API_KEY=not-for-models\n');
  await fs.writeFile(path.join(directory, 'references', 'lens.md'), '# Lens\nAdversarially check it.\n');
  await fs.symlink(path.join(root, 'outside.md'), path.join(directory, 'references', 'outside.md'));
  await fs.writeFile(path.join(root, 'hard-linked-secret.md'), 'HARD_LINK_SECRET');
  await fs.link(path.join(root, 'hard-linked-secret.md'), path.join(directory, 'references', 'hard-linked-secret.md'));

  const bundle = await compileSkillBundle(root, 'audit');
  assert.match(bundle.prompt, /Cross-model compatibility contract/);
  assert.match(bundle.prompt, /AskUserQuestion means return the Workbench/);
  assert.match(bundle.prompt, /references\/lens\.md/);
  assert.doesNotMatch(bundle.prompt, /not-for-models/);
  assert.doesNotMatch(bundle.prompt, /outside\.md/);
  assert.doesNotMatch(bundle.prompt, /HARD_LINK_SECRET/);
  assert.doesNotMatch(bundle.prompt, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('caps the complete skill prompt, redacts metadata, and skips oversized files before reading', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-skill-total-cap-test-'));
  context.after(async () => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'skills', 'audit');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: API_KEY=metadata-name-secret\ndescription: AUTH_TOKEN=metadata-description-secret\n---\n\n${'bounded '.repeat(50_000)}`,
  );
  await fs.writeFile(path.join(directory, 'oversized.json'), 'x'.repeat(600_000));

  const skills = await discoverSkills(root);
  assert.doesNotMatch(skills[0]?.name ?? '', /metadata-name-secret/u);
  assert.doesNotMatch(skills[0]?.description ?? '', /metadata-description-secret/u);
  assert.equal(skills[0]?.fileCount, 1);
  const bundle = await compileSkillBundle(root, 'audit');
  assert.ok(bundle.prompt.length <= 260_000);
  assert.equal(bundle.characterCount, bundle.prompt.length);
  assert.doesNotMatch(bundle.prompt, /metadata-(?:name|description)-secret/u);
  assert.doesNotMatch(bundle.prompt, /oversized\.json/u);
});

test('resolves leading skill invocations and rejects unknown slash procedures', () => {
  const skills = [{ id: 'audit', name: 'audit', description: 'Check it.', fileCount: 1, characterCount: 10 }];
  assert.deepEqual(resolveSkillInvocation('/audit review this', skills), {
    skillId: 'audit',
    operatorText: '/audit review this',
    laneText: 'review this',
  });
  assert.equal(resolveSkillInvocation('/delegate ship this', skills).unknownSkillId, 'delegate');
  assert.equal(resolveSkillInvocation('Explain /audit in prose', skills).skillId, undefined);
});
