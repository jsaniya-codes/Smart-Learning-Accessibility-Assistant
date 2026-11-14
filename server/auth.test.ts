import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createJwtToken,
  deriveChatTitle,
  hashPassword,
  sanitizeEmail,
  verifyJwtToken,
  verifyPassword,
} from './auth';

test('hashPassword and verifyPassword validate matching and reject wrong passwords', () => {
  const hash = hashPassword('StudyPass123!');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyPassword('StudyPass123!', hash), true);
  assert.equal(verifyPassword('WrongPass123!', hash), false);
  assert.equal(verifyPassword('StudyPass123!', 'invalid-format'), false);
});

test('createJwtToken and verifyJwtToken handle valid, tampered, and expired tokens', () => {
  const secret = 'test-secret-key-with-plenty-of-entropy-12345';
  const token = createJwtToken({ sub: 'user-1', email: 'alice@study.edu' }, secret, 3600);
  const claims = verifyJwtToken(token, secret);
  assert.ok(claims);
  assert.equal(claims.sub, 'user-1');
  assert.equal(claims.email, 'alice@study.edu');

  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1]}.tamperedsig`;
  assert.equal(verifyJwtToken(tampered, secret), null);
  assert.equal(verifyJwtToken(token, 'different-secret-key'), null);

  const expired = createJwtToken({ sub: 'user-1', email: 'alice@study.edu' }, secret, -5);
  assert.equal(verifyJwtToken(expired, secret), null);
});

test('deriveChatTitle truncates long questions cleanly on word boundaries', () => {
  assert.equal(deriveChatTitle('   What is photosynthesis?   '), 'What is photosynthesis?');
  assert.equal(deriveChatTitle('   '), 'New Chat');
  const longTitle = deriveChatTitle(
    'Can you explain step by step how light-dependent reactions produce ATP and NADPH inside the thylakoid membrane?'
  );
  assert.ok(longTitle.length <= 54);
  assert.ok(longTitle.endsWith('...'));
});

test('sanitizeEmail trims and lowercases input', () => {
  assert.equal(sanitizeEmail('  Alice@Study.EDU '), 'alice@study.edu');
});
