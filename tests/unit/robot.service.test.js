import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  queueGesture,
  queueDirectAngles,
  popNextCommand,
  getRobotState,
  GESTURES,
} from '../../backend/src/services/robot.service.js';

describe('Robot Service Unit Tests', () => {
  test('should validate and queue known gestures', async () => {
    const cmd = await queueGesture('GREET_WAVE');
    assert.equal(cmd.type, 'GESTURE');
    assert.equal(cmd.gesture, 'GREET_WAVE');
    assert.ok(cmd.steps.length > 0);
  });

  test('should throw error on unknown gesture', async () => {
    await assert.rejects(async () => {
      await queueGesture('FLY_AWAY');
    }, /Invalid gesture/);
  });

  test('should clamp direct servo angles to safe physical limits', async () => {
    const cmd = await queueDirectAngles({ headPan: 250, headTilt: -10, armWave: 300 });
    const step = cmd.steps[0];

    assert.equal(step.headPan, 180, 'Head Pan clamped to max 180');
    assert.equal(step.headTilt, 45, 'Head Tilt clamped to min 45');
    assert.equal(step.armWave, 160, 'Arm Wave clamped to max 160');
  });

  test('should pop pending command from the FIFO queue', async () => {
    // Drain any remaining commands from prior tests
    while ((await popNextCommand()) !== null) {}

    await queueGesture('NOD_YES');
    const popped = await popNextCommand();
    assert.ok(popped);
    assert.equal(popped.gesture, 'NOD_YES');
  });

  test('should return current robot state structure', async () => {
    const state = await getRobotState();
    assert.ok('online' in state);
    assert.ok('servos' in state);
    assert.ok('headPan' in state.servos);
    assert.ok('headTilt' in state.servos);
    assert.ok('armWave' in state.servos);
  });
});
