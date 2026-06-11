import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit for base64 image transfers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Lazy initializer for Gemini client to prevent crashes if key is omitted during startup
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required for card parsing");
    }
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return geminiClient;
}

// Helper function to call generateContent with retry and model fallback support
async function generateWithRetryAndFallback(
  ai: GoogleGenAI,
  cleanBase64: string,
  cleanMimeType: string,
  promptText: string
): Promise<any> {
  // Ordered sequence of robust models supporting multimodal scans
  const models = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  for (const model of models) {
    let attempts = 3;
    let delay = 1000;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        console.log(`[Gemini API] Querying model ${model} (attempt ${attempt}/${attempts})...`);
        const response = await ai.models.generateContent({
          model: model,
          contents: {
            parts: [
              {
                inlineData: {
                  data: cleanBase64,
                  mimeType: cleanMimeType,
                },
              },
              {
                text: promptText,
              },
            ],
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Full name of the contact" },
                company: { type: Type.STRING, description: "Company or organization name" },
                title: { type: Type.STRING, description: "Job title or position" },
                emails: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Email addresses parsed" },
                phones: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Phone numbers parsed" },
                websites: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Websites or URLs" },
                address: { type: Type.STRING, description: "Physical street address, city, country, postal code" },
                socials: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Social handles, LinkedIn profile URL, Twitter etc." },
                notes: { type: Type.STRING, description: "Summary description of services, specializations, tags, or general notes" },
              },
              required: ["name"],
            },
          },
        });

        if (response && response.text) {
          console.log(`[Gemini API] Successfully parsed content using model ${model}`);
          return response;
        }
        throw new Error(`Empty response text returned from model ${model}`);
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || String(err);
        console.warn(`[Gemini API Error] Model ${model} failed (attempt ${attempt}/${attempts}):`, errMsg);

        // Check if error is a transient/temporary glitch, e.g., 503 high demand or 429
        const isTemporary = 
          errMsg.includes("503") || 
          errMsg.toLowerCase().includes("unavailable") || 
          errMsg.toLowerCase().includes("overloaded") || 
          errMsg.toLowerCase().includes("rate limit") || 
          errMsg.toLowerCase().includes("demand") ||
          errMsg.includes("429");

        if (isTemporary && attempt < attempts) {
          console.log(`[Gemini Retry] Rate limited or service unavailable. Backing off for ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        } else {
          // If not temporary, or run out of attempts on this model, try the next model candidate
          console.log(`[Gemini Failover] Fast-failing or exhausted retries for model ${model}. Moving to fallback model if available.`);
          break;
        }
      }
    }
  }

  throw lastError || new Error("All Gemini model candidates and retry attempts failed.");
}

// REST Endpoint: Parse Business Card Image with Gemini AI
app.post("/api/parser", async (req, res): Promise<any> => {
  try {
    const { base64, mimeType } = req.body;
    if (!base64) {
      return res.status(400).json({ error: "Missing image base64 data" });
    }

    const ai = getGeminiClient();
    const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, "");
    const cleanMimeType = mimeType || "image/jpeg";

    const promptText = `
You are an advanced, expert AI business card reader.
Parse the contact information from this scanned business card.
Check both sides if they are merged horizontally or vertically.
Verify the spelling of names, emails, and phone numbers.
Extract URLs, social profiles (LinkedIn, X/Twitter, etc.), physical address, company, and job title.
In the \"notes\" field, summarize the card's business category, specializations listed on the card, or other tags.
Return a valid JSON output matching the required schema. Ensure Name is extracted correctly.
    `;

    const aiResponse = await generateWithRetryAndFallback(ai, cleanBase64, cleanMimeType, promptText);

    const parsedText = aiResponse.text;
    if (!parsedText) {
      throw new Error("No response from Gemini API");
    }

    try {
      const parsedData = JSON.parse(parsedText);
      return res.json(parsedData);
    } catch (parseErr) {
      console.error("Failed to parse response JSON from model:", parsedText);
      return res.json({
        name: "Unknown Contact",
        notes: parsedText,
      });
    }
  } catch (error: any) {
    console.error("Error parsing business card:", error);
    return res.status(500).json({
      error: error.message || "An error occurred during Gemini AI card parsing.",
    });
  }
});

// Mounting Vite Server (Dev) vs Static Files (Prod)
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in development mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in production mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running and accessible on http://localhost:${PORT}`);
  });
}

setupServer();
