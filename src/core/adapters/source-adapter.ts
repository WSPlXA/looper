export type LegacyProgram = {
  programId: string;
  sourceFile: string;
  expandedSource: string;
  callees: string[];
  linkage: Array<{ name: string; pic: string }>;
  workingStorageNames: string[];
  linkageNames: string[];
};

export type LegacyInventory = {
  sourceKind: string;
  sourceRoot: string;
  programs: LegacyProgram[];
  copybookFiles: string[];
  risks: string[];
};

export interface SourceAdapter {
  readonly id: string;
  discover(sourceRoot: string): Promise<LegacyInventory>;
}
