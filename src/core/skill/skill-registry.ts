import type { Skill } from "./skill.js";

export function buildSkillRegistry(skills: Readonly<Record<string, Skill<unknown, unknown, unknown>>>) {
  return (name: string) => {
    const skill = skills[name];
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    return skill;
  };
}
