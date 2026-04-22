import readline from "readline";

let rl: readline.Interface | null = null;

function getReadline(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  return rl;
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    getReadline().question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function promptRequired(question: string): Promise<string> {
  while (true) {
    const answer = await prompt(question);

    if (answer) {
      return answer;
    }

    console.log("This field is required. Please enter a value.");
  }
}

export async function promptOptional(question: string): Promise<string> {
  return prompt(question);
}

export async function promptMultiline(label: string): Promise<string> {
  console.log(`${label} (press Enter twice to finish):`);

  const lines: string[] = [];
  let lastLineWasEmpty = false;

  while (true) {
    const line = await prompt("> ");

    if (line === "") {
      if (lastLineWasEmpty && lines.length > 0) {
        break;
      }

      lastLineWasEmpty = true;
      lines.push("");
      continue;
    }

    lastLineWasEmpty = false;
    lines.push(line);
  }

  const result = lines.join("\n").trim();

  if (result) {
    console.log("");
    return result;
  }

  console.log("Genesis prompt is required. Please enter a value.");
  return promptMultiline(label);
}

export async function promptWithDefault(question: string, defaultValue: number): Promise<number> {
  const answer = await prompt(`${question} [${defaultValue}]: `);

  if (!answer) {
    return defaultValue;
  }

  const parsed = parseInt(answer, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    console.log(`Invalid input, using default: ${defaultValue}`);
    return defaultValue;
  }

  return parsed;
}

export function closePrompts(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
