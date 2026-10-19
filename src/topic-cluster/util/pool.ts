/**
 * 并发池（无限流语义，真正的限流由 llm.ts 的全局速率限制器负责）。
 *
 * 存在的理由：切面抽取是「几百次串行 LLM 调用」，串行会让每日任务耗时过长，
 * 无限并发又会打爆上游。这里只控制**并发窗口大小**，不做重试与退避。
 */

/**
 * 按指定并发度映射数组，保持输出顺序与输入一致。
 *
 * 单项失败不会中断整批——由 `worker` 自行捕获并返回结果对象，
 * 这样「某一篇抽取失败」不会让当天整批任务回滚。
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;

  const window = Math.max(1, Math.floor(concurrency));
  let cursor = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const lanes = Array.from({ length: Math.min(window, items.length) }, () => run());
  await Promise.all(lanes);
  return results;
}
