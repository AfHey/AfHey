/**
 * Manual live smoke check for the OpenAI extraction adapter. Requires
 * OPENAI_API_KEY in .env. Uses wholly fictional input. Run:
 *   npm run extraction:smoke
 */
import { OpenAIExtractionProvider } from "../src/ai/adapters/openai-extraction";
import { loadLocalEnv } from "../src/lib/env";

loadLocalEnv();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is not set in .env; add it and re-run.");
  process.exit(1);
}

const provider = new OpenAIExtractionProvider({ apiKey });
provider
  .extract({
    payloadText:
      "Tomorrow I need to email [PERSON_1] about the tile order, book a table for Friday dinner, and note: the retry design doc lives in the shared drive. Also ask [PERSON_2] for the budget numbers for [PROJECT_1].",
    mentions: [
      {
        placeholder: "[PERSON_1]",
        entityType: "person",
        candidateIds: ["c0000000-0000-4000-8000-000000000003"],
        confidence: "high",
      },
      {
        placeholder: "[PERSON_2]",
        entityType: "person",
        candidateIds: [
          "c0000000-0000-4000-8000-000000000001",
          "c0000000-0000-4000-8000-000000000002",
        ],
        confidence: "needs_confirmation",
      },
      {
        placeholder: "[PROJECT_1]",
        entityType: "project",
        candidateIds: ["b0000000-0000-4000-8000-000000000001"],
        confidence: "high",
      },
    ],
    currentDateTime: new Date().toISOString(),
    timezone: "America/New_York",
  })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    console.log(`OK: ${result.items.length} item(s), prompt ${result.prompt_version}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
