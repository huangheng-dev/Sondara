let migrationQueue = Promise.resolve();

export const withMigrationLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = migrationQueue;
  let releaseQueue: () => void = () => undefined;
  migrationQueue = new Promise<void>(resolve => { releaseQueue = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    releaseQueue();
  }
};
