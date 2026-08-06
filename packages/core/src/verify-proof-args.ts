export function proofPathFromArguments(
  arguments_: readonly string[],
): string | undefined {
  return arguments_.find((value) => value !== '--');
}
