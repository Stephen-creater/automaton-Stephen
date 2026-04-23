import type { SocialClientInterface, ParentChildMessage } from "../types.js";
import { MESSAGE_LIMITS } from "../types.js";

export async function sendToChild(
  social: SocialClientInterface,
  childAddress: string,
  content: string,
  type: string = "parent_message",
): Promise<{ id: string }> {
  if (content.length > MESSAGE_LIMITS.maxContentLength) {
    throw new Error(`Message too long: ${content.length} bytes (max ${MESSAGE_LIMITS.maxContentLength})`);
  }

  const result = await social.send(childAddress, JSON.stringify({
    type,
    content,
    sentAt: new Date().toISOString(),
  } as ParentChildMessage));

  return { id: result.id };
}

export async function sendToParent(
  social: SocialClientInterface,
  parentAddress: string,
  content: string,
  type: string = "child_message",
): Promise<{ id: string }> {
  if (content.length > MESSAGE_LIMITS.maxContentLength) {
    throw new Error(`Message too long: ${content.length} bytes (max ${MESSAGE_LIMITS.maxContentLength})`);
  }

  const result = await social.send(parentAddress, JSON.stringify({
    type,
    content,
    sentAt: new Date().toISOString(),
  } as ParentChildMessage));

  return { id: result.id };
}
