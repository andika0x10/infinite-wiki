import { generationHandler } from "@/lib/generation-api";
import { generateArticle } from "@/services/gemini";
export const POST = generationHandler((topic, _exclude, key) => generateArticle(topic, key));
