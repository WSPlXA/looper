export function shouldStopRepair(input: {
  attempt: number;
  maxAttempts: number;
  scores: readonly number[];
  maxStagnantIterations: number;
}): boolean {
  if (input.attempt >= input.maxAttempts) return true;
  if (input.scores.length <= input.maxStagnantIterations) return false;
  const recent = input.scores.slice(-(input.maxStagnantIterations + 1));
  return recent.every(score => score <= recent[0]!);
}
