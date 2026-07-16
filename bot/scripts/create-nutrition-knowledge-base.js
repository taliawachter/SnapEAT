import "dotenv/config";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWLEDGE_DIR = path.resolve(
  __dirname,
  "..",
  "knowledge",
);

function fail(message) {
  console.error(`[knowledge:create] ${message}`);
  process.exit(1);
}

async function attachFileWithPolling(client, vectorStoreId, fileId) {
  if (
    client?.vectorStores?.files
    && typeof client.vectorStores.files.createAndPoll === "function"
  ) {
    return client.vectorStores.files.createAndPoll(vectorStoreId, { file_id: fileId });
  }

  if (
    client?.vectorStores?.fileBatches
    && typeof client.vectorStores.fileBatches.createAndPoll === "function"
  ) {
    return client.vectorStores.fileBatches.createAndPoll(vectorStoreId, { file_ids: [fileId] });
  }

  const created = await client.vectorStores.files.create(vectorStoreId, { file_id: fileId });
  let status = created?.status || "in_progress";
  let latest = created;

  while (status === "in_progress") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    latest = await client.vectorStores.files.retrieve(vectorStoreId, created.id);
    status = latest?.status || "in_progress";
  }

  return latest;
}

async function main() {
  console.log("[knowledge:create] Starting nutrition knowledge base setup.");
  console.log("[knowledge:create] Warning: running repeatedly may create duplicate Vector Stores.");

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    fail("Missing OPENAI_API_KEY. Add it to your local environment before running this script.");
  }

  if (!fs.existsSync(KNOWLEDGE_DIR)) {
  fail(`Knowledge directory not found: ${KNOWLEDGE_DIR}`);
}

const knowledgeFiles = fs
  .readdirSync(KNOWLEDGE_DIR)
  .filter((file) => file.endsWith(".md"))
  .sort();

if (knowledgeFiles.length === 0) {
  fail("No markdown files found inside knowledge directory.");
}

  const client = new OpenAI({ apiKey });

console.log(`[knowledge:create] Uploading ${knowledgeFiles.length} knowledge files...`);

const uploadedFiles = [];

for (const fileName of knowledgeFiles) {
  console.log(`Uploading ${fileName}...`);

  const uploaded = await client.files.create({
    file: fs.createReadStream(path.join(KNOWLEDGE_DIR, fileName)),
    purpose: "assistants",
  });

  uploadedFiles.push(uploaded);
}


  console.log("[knowledge:create] Creating Vector Store...");
  const vectorStore = await client.vectorStores.create({
    name: "snap-eat-nutrition-knowledge",
  });

  console.log("[knowledge:create] Attaching file and waiting for processing...");

for (const uploadedFile of uploadedFiles) {
  console.log(`Indexing ${uploadedFile.filename}...`);

  await attachFileWithPolling(
    client,
    vectorStore.id,
    uploadedFile.id,
  );
}

  console.log("[knowledge:create] Done.");
  console.log(`[knowledge:create] Vector Store ID: ${vectorStore.id}`);
  console.log("[knowledge:create] Copy this value into OPENAI_VECTOR_STORE_ID in your local .env file.");
}

main().catch((error) => {
  const safeMessage = String(error?.message || "Unknown failure").slice(0, 240);
  console.error(`[knowledge:create] Failed: ${safeMessage}`);
  process.exit(1);
});
