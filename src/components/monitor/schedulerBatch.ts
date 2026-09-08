export async function stopScheduledTaskBatch<T extends { id: string; name: string }>(
  tasks: T[],
  stop: (task: T) => Promise<unknown>,
): Promise<{ stopped: T[]; failed: Array<{ task: T; message: string }> }> {
  const stopped: T[] = []
  const failed: Array<{ task: T; message: string }> = []
  for (const task of tasks) {
    try {
      await stop(task)
      stopped.push(task)
    } catch (error) {
      failed.push({ task, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { stopped, failed }
}
