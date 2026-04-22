import { loadConfig } from "./config.js";
import { loadApiKeyFromConfig } from "./identity/provision.js";
import { runSetupWizard } from "./setup/wizard.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config) {
    console.log(`Loaded existing config for ${config.name}.`);
    const conwayApiKey = config.conwayApiKey || loadApiKeyFromConfig();

    if (conwayApiKey) {
      console.log("Conway access is configured.");
    } else {
      console.log("Conway API key is missing. Setup is complete, but Conway features are not ready yet.");
    }

    console.log("Setup skipped.");
    return;
  }

  await runSetupWizard();
}

main().catch((error) => {
  console.error("Setup failed.");
  console.error(error);
  process.exit(1);
});
