export type EventStore = {
  claim: (id: string, type: string) => Promise<boolean>;
};

export async function processOnce(
  store: EventStore,
  id: string,
  type: string,
  handler: () => Promise<void>,
): Promise<boolean> {
  if (!(await store.claim(id, type))) return false;
  await handler();
  return true;
}
