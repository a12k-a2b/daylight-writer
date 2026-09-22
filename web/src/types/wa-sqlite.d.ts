declare module '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs' {
  const SQLiteAsyncESMFactory: (config?: any) => Promise<any>;
  export default SQLiteAsyncESMFactory;
}

declare module '@journeyapps/wa-sqlite/src/examples/AccessHandlePoolVFS.js' {
  export class AccessHandlePoolVFS {
    static create(name: string, module: any): Promise<any>;
  }
}

declare module '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js' {
  export class IDBBatchAtomicVFS {
    static create(name: string, module: any): Promise<any>;
  }
}

declare module '@journeyapps/wa-sqlite/src/examples/MemoryVFS.js' {
  export class MemoryVFS {
    static create(name: string, module: any): Promise<any>;
    mapNameToFile: Map<string, any>;
    mapIdToFile: Map<number, any>;
  }
}
