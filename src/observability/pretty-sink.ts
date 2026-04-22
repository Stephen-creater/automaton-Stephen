import chalk from "chalk";
import type { LogEntry } from "../types.js";

const accent = chalk.rgb(131, 127, 255);

const PREFIX_STYLES: Array<[RegExp, (label: string, rest: string) => string]> = [
  [/^\[WAKE UP\]/, (label, rest) => accent.bold(label) + " " + chalk.white(rest)],
  [/^\[SLEEP\]/, (label, rest) => chalk.blue.dim(label) + " " + chalk.dim(rest)],
  [/^\[THINK\]/, (label, rest) => accent.dim(label) + " " + chalk.dim(rest)],
  [/^\[THOUGHT\]/, (label, rest) => chalk.dim(label) + " " + chalk.white(rest)],
  [/^\[TOOL\]/, (label, rest) => chalk.magenta(label) + " " + chalk.white(rest)],
  [/^\[TOOL RESULT\]/, (label, rest) => {
    const isError = rest.startsWith("ERROR:") || rest.includes(": ERROR:");
    return (isError ? chalk.red(label) : chalk.green(label)) + " " + (isError ? chalk.red(rest) : chalk.dim(rest));
  }],
  [/^\[CRITICAL\]/, (label, rest) => chalk.red.bold(label) + " " + chalk.red(rest)],
  [/^\[FATAL\]/, (label, rest) => chalk.red.bold(label) + " " + chalk.red(rest)],
  [/^\[ERROR\]/, (label, rest) => chalk.red(label) + " " + chalk.red(rest)],
  [/^\[LOOP\]/, (label, rest) => chalk.yellow(label) + " " + chalk.yellow(rest)],
  [/^\[LOOP END\]/, (label, rest) => accent(label) + " " + chalk.dim(rest)],
  [/^\[IDLE\]/, (label, rest) => chalk.dim(label) + " " + chalk.dim(rest)],
  [/^\[ORCHESTRATOR\]/, (label, rest) => chalk.cyan(label) + " " + chalk.white(rest)],
  [/^\[AUTO-TOPUP\]/, (label, rest) => chalk.green.bold(label) + " " + chalk.green(rest)],
  [/^\[CYCLE LIMIT\]/, (label, rest) => chalk.yellow(label) + " " + chalk.dim(rest)],
  [/^\[API_UNREACHABLE\]/, (label, rest) => chalk.yellow(label) + " " + chalk.dim(rest)],
  [/^\[INBOX\]/, (label, rest) => chalk.dim(label) + " " + chalk.dim(rest)],
];

const LEVEL_STYLES: Record<string, (input: string) => string> = {
  debug: chalk.gray,
  info: chalk.white,
  warn: chalk.yellow,
  error: chalk.red,
  fatal: chalk.red.bold,
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return chalk.dim(`${hh}:${mm}:${ss}`);
}

function formatMessage(message: string): string {
  const bracketMatch = message.match(/^(\[[A-Z][A-Z _-]*\])(.*)/s);
  if (bracketMatch) {
    const label = bracketMatch[1];
    const rest = bracketMatch[2].trim();
    for (const [pattern, style] of PREFIX_STYLES) {
      if (pattern.test(label)) {
        return style(label, rest);
      }
    }
    return accent(label) + " " + rest;
  }

  return chalk.white(message);
}

export function prettySink(entry: LogEntry): void {
  try {
    const time = formatTime(entry.timestamp);
    const levelFn = LEVEL_STYLES[entry.level] ?? chalk.white;
    const level = levelFn(entry.level.toUpperCase().padEnd(5));
    const module = chalk.dim(entry.module.padEnd(12));
    const message = formatMessage(entry.message);

    let line = `${time} ${level} ${module} ${message}`;

    if (entry.error) {
      line += "\n" + chalk.red("  " + entry.error.message);
    }

    process.stdout.write(line + "\n");
  } catch {
    process.stdout.write(entry.message + "\n");
  }
}
