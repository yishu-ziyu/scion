import { describe, expect, it } from 'vitest';
import { missionPlanItemStatus } from '../MissionPlanList';

describe('missionPlanItemStatus', () => {
  it('preserves durable completed, planned, and blocked phase states', () => {
    expect(missionPlanItemStatus('done', 'paused')).toBe('done');
    expect(missionPlanItemStatus('planned', 'failed')).toBe('planned');
    expect(missionPlanItemStatus('blocked', 'working')).toBe('blocked');
  });

  it('projects an active phase as running only while the task is active', () => {
    expect(missionPlanItemStatus('active', 'planning')).toBe('active');
    expect(missionPlanItemStatus('active', 'working')).toBe('active');
    expect(missionPlanItemStatus('active', 'verifying')).toBe('active');
    expect(missionPlanItemStatus('active', 'delivering')).toBe('active');
  });

  it('never presents stale active motion while paused, waiting for the user, or failed', () => {
    expect(missionPlanItemStatus('active', 'paused')).toBe('paused');
    expect(missionPlanItemStatus('active', 'needs_user')).toBe('waiting_user');
    expect(missionPlanItemStatus('active', 'failed')).toBe('failed');
  });

  it('renders every stage as done after verified task completion', () => {
    expect(missionPlanItemStatus('active', 'completed')).toBe('done');
    expect(missionPlanItemStatus('planned', 'completed')).toBe('done');
    expect(missionPlanItemStatus('blocked', 'completed')).toBe('done');
  });
});
