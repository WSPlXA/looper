import { join } from "node:path";
import type { GraphContext } from "../../core/graph/graph.types.js";
import type { AssemblyMigrationState } from "../../schemas/assembly-state.schema.js";
import { assembleJavaClass } from "../../skills/java/assemble-java-class.skill.js";
import { assembleSpringBootProject } from "../../skills/java/assemble-spring-boot-project.skill.js";
import { writeTextFileTool } from "../../tools/filesystem.tool.js";
import { runTracedCall } from "../../core/trace/traced-call.js";

export type AssembledOutput = {
  assembledSource: string;
  assembledFilePath: string;
  generatedSourceFiles: string[];
  programFilePaths: Record<string, string>;
} & Partial<Pick<AssemblyMigrationState, "assembledMethodRanges" | "generatedProjectDir">>;

export async function writeAssembledOutput(
  state: AssemblyMigrationState,
  context: GraphContext<AssemblyMigrationState>,
  translatedMethods = state.translatedMethods,
  extraClassFieldDeclarations = state.extraClassFieldDeclarations,
): Promise<AssembledOutput> {
  const entryProgramId = state.callOrder.at(-1) ?? translatedMethods.at(-1)?.programId ?? state.outputClassName;
  const outputDir = state.targetProfile === "spring-boot-multi-class-v1"
    ? state.outputDir
    : join(state.runDir, "output");

  if (state.targetProfile === "spring-boot-multi-class-v1") {
    const project = assembleSpringBootProject({
      applicationClassName: `${state.outputClassName}Application`,
      packageName: state.targetPackage,
      entryProgramId,
      subprograms: state.subprograms,
      translatedMethods,
      failedTranslations: state.failedTranslations,
      extraClassFields: extraClassFieldDeclarations,
      springBootVersion: state.springBootVersion,
    });

    for (const file of project.files) {
      const path = join(outputDir, ...file.relativePath.split("/"));
      await runTracedCall(context.trace, "tool.call", { tool: "write-text-file", path }, () =>
        writeTextFileTool.execute({ path, content: file.content }),
      );
    }

    const absoluteProgramPaths = Object.fromEntries(
      Object.entries(project.programFilePaths).map(([programId, path]) => [programId, join(outputDir, ...path.split("/"))]),
    );
    const entrypointPath = join(outputDir, ...project.entrypointRelativePath.split("/"));
    const entrypointSource = project.files.find(file => file.relativePath === project.entrypointRelativePath)?.content ?? "";
    return {
      assembledSource: entrypointSource,
      assembledFilePath: entrypointPath,
      generatedProjectDir: outputDir,
      generatedSourceFiles: project.files.map(file => join(outputDir, ...file.relativePath.split("/"))),
      programFilePaths: absoluteProgramPaths,
    };
  }

  const { source, methodLineStarts } = assembleJavaClass(
    state.outputClassName,
    entryProgramId,
    translatedMethods,
    state.failedTranslations,
    extraClassFieldDeclarations,
  );
  const assembledFilePath = join(outputDir, `${state.outputClassName}.java`);
  await runTracedCall(context.trace, "tool.call", { tool: "write-text-file", path: assembledFilePath }, () =>
    writeTextFileTool.execute({ path: assembledFilePath, content: source }),
  );
  return {
    assembledSource: source,
    assembledFilePath,
    assembledMethodRanges: methodLineStarts,
    generatedSourceFiles: [assembledFilePath],
    programFilePaths: {},
  };
}
