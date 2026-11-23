import dotenv from "dotenv";

// Same precedence as Next.js: .env.local overrides .env. Imported first in worker/index.ts.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
