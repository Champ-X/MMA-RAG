import test from 'node:test';
import assert from 'node:assert/strict';
import { modelResultLine, modelTestHint } from '../src/model-results.js';

test('onboarding distinguishes Pi failures and offers source upgrade recovery for missing models', () => {
  const pi = { task: 'pi_vision', provider: 'aliyun_bailian', capability: 'vision', model: 'old-snapshot', success: false, error_code: 'not_found' };
  const ordinary = { ...pi, task: 'image_captioning', success: true };
  assert.match(modelResultLine(pi), /Pi 独立图片理解/);
  assert.match(modelResultLine(ordinary), /图片理解.*通过/);
  const hint = modelTestHint([ordinary, pi], { source: '/repo' });
  assert.match(hint, /setup --rebuild/);
  assert.match(hint, /独立模型/);
  assert.ok(!hint.includes('检查余额'));
  assert.ok(!modelTestHint([pi]).includes('git pull'));
});

test('authentication and network failures retain their own recovery advice', () => {
  assert.match(modelTestHint([{ success: false, error_code: 'access_denied' }]), /模型权限/);
  const network = modelTestHint([{ success: false, error_code: 'network' }], { source: '/repo' });
  assert.match(network, /网络/);
  assert.ok(!network.includes('--rebuild'));
});
