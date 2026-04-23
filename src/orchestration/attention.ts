import type { ChatMessage } from "../types.js";
import { getActiveGoals, getTasksByGoal } from "../state/database.js";

export function generateTodoMd(db: import("better-sqlite3").Database): string {
  const goals = getActiveGoals(db);
  if (goals.length === 0) {
    return "# todo\n\n- No active goals.";
  }

  const lines = ["# todo", ""];
  for (const goal of goals) {
    lines.push(`## ${goal.title}`);
    lines.push(goal.description);
    const tasks = getTasksByGoal(db, goal.id).slice(0, 10);
    if (tasks.length === 0) {
      lines.push("- No tasks yet.");
    } else {
      for (const task of tasks) {
        lines.push(`- ${task.title} [${task.status}]`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function injectTodoContext(messages: ChatMessage[], todoMd: string): ChatMessage[] {
  return [...messages, { role: "system", content: todoMd }];
}
