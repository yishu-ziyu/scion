/** Period alarm that wakes the MV3 worker while a task is running. */

export const TASK_KEEP_ALIVE_ALARM = 'chijie-task-keep-alive';
/** 24s — inside the 20–25s keep-alive window. */
const TASK_KEEP_ALIVE_PERIOD_MINUTES = 24 / 60;

type AlarmInfo = { name: string };
type AlarmsApi = {
  create: (name: string, alarmInfo: { periodInMinutes?: number; delayInMinutes?: number }) => Promise<void> | void;
  clear: (name: string) => Promise<boolean> | boolean;
  get?: (name: string) => Promise<AlarmInfo | undefined>;
  onAlarm?: { addListener: (callback: (alarm: AlarmInfo) => void) => void };
};

function alarmsApi(): AlarmsApi | undefined {
  return (globalThis as { chrome?: { alarms?: AlarmsApi } }).chrome?.alarms;
}

export async function syncTaskKeepAlive(hasRunningTask: boolean): Promise<void> {
  const alarms = alarmsApi();
  if (!alarms?.create || !alarms.clear) return;
  if (!hasRunningTask) {
    await alarms.clear(TASK_KEEP_ALIVE_ALARM);
    return;
  }
  const existing = alarms.get ? await alarms.get(TASK_KEEP_ALIVE_ALARM) : undefined;
  if (existing) return;
  await alarms.create(TASK_KEEP_ALIVE_ALARM, {
    delayInMinutes: TASK_KEEP_ALIVE_PERIOD_MINUTES,
    periodInMinutes: TASK_KEEP_ALIVE_PERIOD_MINUTES,
  });
}

/** Alarm only needs to wake the worker; boot already runs recover(). */
export function installTaskKeepAliveListener(): void {
  alarmsApi()?.onAlarm?.addListener(alarm => {
    if (alarm.name !== TASK_KEEP_ALIVE_ALARM) return;
  });
}
