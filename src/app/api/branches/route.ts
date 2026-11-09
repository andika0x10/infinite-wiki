import { generationHandler } from "@/lib/generation-api";
import { generateBranches } from "@/services/gemini";
export const POST = generationHandler(async (topic, exclude, key) => ({ branches: await generateBranches(topic, exclude, key) }));
