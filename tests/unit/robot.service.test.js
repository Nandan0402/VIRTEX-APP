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
    for (const g of ['WAVE', 'NOD', 'SHAKE', 'IDLE', 'GREET_WAVE', 'NOD_YES', 'RESET_IDLE']) {
      const cmd = await queueGesture(g);
      assert.equal(cmd.type, 'GESTURE');
      assert.equal(cmd.gesture, g);
      assert.ok(cmd.steps.length > 0);
      assert.ok(cmd.steps[0].headPan !== undefined);
      assert.ok(cmd.steps[0].head !== undefined);
      assert.ok(cmd.steps[0].leftArm !== undefined);
      assert.ok(cmd.steps[0].rightArm !== undefined);
    }
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
    assert.equal(step.head, 180, 'Head alias clamped to max 180');
    assert.equal(step.leftArm, 45, 'Left arm alias clamped to min 45');
    assert.equal(step.rightArm, 160, 'Right arm alias clamped to max 160');
  });

  test('should support individual servo positioning using head, leftArm, rightArm', async () => {
    const cmd = await queueDirectAngles({ head: 75, leftArm: 90, rightArm: 30 });
    const step = cmd.steps[0];

    assert.equal(step.head, 75);
    assert.equal(step.headPan, 75);
    assert.equal(step.leftArm, 90);
    assert.equal(step.headTilt, 90);
    assert.equal(step.rightArm, 30);
    assert.equal(step.armWave, 30);
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
