export type BenchPluginFactoryOptions = {
  pluginId: string;
  protocolVersion: 1;
};

export function defineBenchPluginFactory<T>(factory: (options: BenchPluginFactoryOptions) => T): (options: BenchPluginFactoryOptions) => T {
  return factory;
}
