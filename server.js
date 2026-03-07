// 🔧 Dependencies
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require('express');
const { SarvamAIClient } = require("sarvamai");
// const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const bodyParser = require('body-parser');

// AWS DynamoDB
const { getUser, putUser, scanAllUsers } = require('./config/dynamo');

const rolesByType = {
  "1v1": { prop: ["pm"], opp: ["lo"] },
  "3v3": { prop: ["pm", "dpm", "gw"], opp: ["lo", "dlo", "ow"] },
  "5v5": { prop: ["pm", "dpm", "gw", "member", "whip"], opp: ["lo", "dlo", "ow", "member", "whip"] }
};

const app = express();
// app.use(cors());
app.use(cors({
  origin: 'https://main.d395dqck1v36zk.amplifyapp.com'  // Your Amplify URL
}));
app.use(express.json());
app.use(bodyParser.json());

const client = new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY });
const GEMINI_API_KEY = "AIzaSyBHegUnS4i4YRxv7NseCjimY18HSe8_QVY";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const upload = multer({ storage: multer.memoryStorage() });

//tetstttt
// ==================== UPDATE YOUR EXISTING /api/save-arina-session ROUTE (server.js) ====================
// (Replace the old one I gave you with this — it's the same but now logs more clearly and handles empty summaries safely)

app.post('/api/save-arina-session', async (req, res) => {
  const { email, topic, userTranscripts, aiTranscripts, userSummaries, aiSummaries } = req.body;

  if (!email || !topic || !Array.isArray(userTranscripts) || !Array.isArray(aiTranscripts)) {
    return res.status(400).json({ error: 'Missing required fields: email, topic, userTranscripts[], aiTranscripts[]' });
  }

  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const topicSlug = topic.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
    if (!user.entries?.[topicSlug]) {
      return res.status(404).json({ error: 'Debate entry not found for this topic' });
    }

    const entry = user.entries[topicSlug];

    const userTeam = (entry.stance || '').toLowerCase() === 'proposition' ? 'proposition' : 'opposition';
    const userRole = (entry.userrole || '').toLowerCase() || (userTeam === 'proposition' ? 'pm' : 'lo');

    const oppTeam = userTeam === 'proposition' ? 'opposition' : 'proposition';
    const oppRole = userTeam === 'proposition' ? 'lo' : 'pm';

    if (!entry[userTeam]) entry[userTeam] = {};
    if (!entry[userTeam][userRole]) entry[userTeam][userRole] = { transcript: [], summary: [], aifeedback: {} };
    if (!entry[oppTeam]) entry[oppTeam] = {};
    if (!entry[oppTeam][oppRole]) entry[oppTeam][oppRole] = { transcript: [], summary: [], aifeedback: {} };

    // === KEEP ADDING (append every time this route is called) ===
    const userBlock = entry[userTeam][userRole];
    userBlock.transcript.push(...userTranscripts.map(t => typeof t === 'string' ? t : t.text || ''));

    const oppBlock = entry[oppTeam][oppRole];
    oppBlock.transcript.push(...aiTranscripts.map(t => typeof t === 'string' ? t : t.text || ''));

    if (Array.isArray(userSummaries) && userSummaries.length > 0) {
      userBlock.summary.push(...userSummaries);
    }
    if (Array.isArray(aiSummaries) && aiSummaries.length > 0) {
      oppBlock.summary.push(...aiSummaries);
    }

    entry.updatedAt = new Date().toISOString();
    await putUser(user);

    console.log(`✅ Arina session UPDATED in DynamoDB → ${userTranscripts.length} user turns | ${aiTranscripts.length} AI turns saved for ${email}`);
    res.status(200).json({ success: true, message: 'Transcript + Summary appended successfully' });
  } catch (err) {
    console.error('❌ Error saving Arina session:', err);
    res.status(500).json({ error: 'Failed to save to DynamoDB' });
  }
});



//CALLING ARINA.JSX API - UPDATED BY ANIKET
// ✅ FIXED & IMPROVED TTS ROUTE

// app.post('/api/tts', async (req, res) => {
//   try {
//     const { text, speaker } = req.body; // speaker is the voice name

//     const response = await client.textToSpeech.convert({
//       text,
//       target_language_code: "en-IN",
//       speaker: speaker || 'manisha', // fallback to 'manisha'
//       pitch: 0.1,
//       pace: 0.8,
//       loudness: 1.7,
//       speech_sample_rate: 24000,
//       enable_preprocessing: true,
//       model: "bulbul:v2"
//     });

//     const base64Audio = response.audios?.[0];
//     if (!base64Audio) {
//       throw new Error("No audio data received");
//     }

//     res.json({ audioBase64: base64Audio });
//   } catch (error) {
//     console.error("TTS Error:", error);
//     res.status(500).json({ error: error.message });
//   }
// });

app.post('/api/tts', async (req, res) => {
  try {
    const { text, speaker } = req.body;
    const response = await client.textToSpeech.convert({
      text, target_language_code: "en-IN", speaker: speaker || 'manisha',
      pitch: 0.1, pace: 0.8, loudness: 1.7, speech_sample_rate: 24000,
      enable_preprocessing: true, model: "bulbul:v2"
    });
    const base64Audio = response.audios?.[0];
    if (!base64Audio) throw new Error("No audio data received");
    res.json({ audioBase64: base64Audio });
  } catch (error) {
    console.error("TTS Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- YOUR API KEY ---


// const upload = multer({ storage: multer.memoryStorage() });

// app.post('/evaluate', upload.single('audio'), async (req, res) => {
//     try {
//         const { targetText } = req.body;
//         if (!req.file) return res.status(400).json({ error: "No audio received" });

//         const model = genAI.getGenerativeModel({
//             model: "gemini-2.5-flash",           // ← Best free model right now (250/day)
//             generationConfig: {
//                 responseMimeType: "application/json"
//             }
//         });

//         const prompt = `
// Target Text: "${targetText}"

// You are a very very strict but helpful English pronunciation coach.
// rate very strictly, if bad below 40
// Do not autocorrect. 
// CRITICAL RULES:
// - If no clear human voice → 
//   {"score": 0, "overall_feedback": "No voice detected. Please speak clearly into the microphone.", "phonetic_target": "", "phonetic_heard": "", "mistakes": []}
// - Otherwise analyze phonetically with IPA.

// Return ONLY this JSON:

// {
//   "score": number (0-100),
//   "overall_feedback": "one short encouraging sentence",
//   "phonetic_target": "full IPA of target sentence",
//   "phonetic_heard": "full IPA of what you actually heard",
//   "mistakes": [
//     {
//       "word": "the word",
//       "user_pronunciation": "IPA you heard",
//       "correct_phoneme": "correct IPA",
//       "issue": "short description",
//       "how_to_correct": "how to fix it (1-2 sentences)"
//     }
//   ]
// }
// `;

//         const result = await model.generateContent([
//             { text: prompt },
//             {
//                 inlineData: {
//                     data: req.file.buffer.toString('base64'),
//                     mimeType: "audio/wav"
//                 }
//             }
//         ]);

//         const jsonString = await result.response.text();
//         const data = JSON.parse(jsonString);
        
//         res.json(data);

//     } catch (error) {
//         console.error("ERROR:", error.message);
//         res.status(500).json({ error: "Server error", details: error.message });
//     }
// });

// ADD THIS ENTIRE BLOCK AT THE VERY END OF YOUR SERVER FILE (after the existing app.post('/evaluate', ...) route)
// // ====================== NEW PROGRESS ENDPOINTS ======================
// app.post('/get-user-progress', async (req, res) => {
//   const { email } = req.body;
//   if (!email) return res.status(400).json({ error: "Email required" });

//   try {
//     const user = await getUser(email);
//     if (!user) return res.status(404).json({ error: "User not found" });

//     res.json({ videoProgress: user.videoProgress || {} });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: "Server error" });
//   }
// });

// app.post('/save-video-progress', async (req, res) => {
//   const { email, videoId, pronunciationScore, understandingScore, transcription, pronunciationFeedback, understandingFeedback, mistakes, completedAt } = req.body;

//   if (!email || !videoId) return res.status(400).json({ error: "Missing email or videoId" });

//   try {
//     let user = await getUser(email);
//     if (!user) return res.status(404).json({ error: "User not found" });

//     if (!user.videoProgress) user.videoProgress = {};

//     const avgScore = Math.round((pronunciationScore + understandingScore) / 2);

//     user.videoProgress[videoId] = {
//       pronunciationScore,
//       understandingScore,
//       avgScore,
//       transcription: transcription || "",
//       pronunciationFeedback,
//       understandingFeedback,
//       mistakes: mistakes || [],
//       completedAt: completedAt || Date.now()
//     };

//     await putUser(user);
//     res.json({ success: true });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ error: "Failed to save progress" });
//   }
// });
// app.post('/evaluate-pronunciation-and-understanding', upload.single('audio'), async (req, res) => {
//   try {
//     const summary = req.body.summary;
//     if (!summary) {
//       return res.status(400).json({ error: "No summary provided" });
//     }
//     if (!req.file) {
//       return res.status(400).json({ error: "No audio received" });
//     }

//     const model = genAI.getGenerativeModel({
//       model: "gemini-2.5-flash", // keep exactly what you already use
//       generationConfig: { responseMimeType: "application/json" }
//     });

//     const prompt = `
// Target Summary: ${JSON.stringify(summary)}

// You are a world-class English pronunciation coach, public speaking mentor, and content evaluator — strict yet highly encouraging.

// Analyze the audio of the user explaining the video in their own words.

// Return ONLY this exact JSON (no extra text, no markdown, no explanations):

// {
//   "transcription": "exact full transcription of what the user said (cleaned but 100% faithful). If no clear speech, use empty string.",
//   "pronunciationScore": number (0-100, very strict: clarity, phonemes, intonation, pacing, fluency, accent issues),
//   "pronunciationFeedback": "one short, encouraging paragraph (2-4 sentences) focused only on pronunciation",
//   "understandingScore": number (0-100),
//   "understandingFeedback": "beautiful, motivational paragraph that covers:
//     • how accurately the user matched the Target Summary (key points: hook, transition, credibility, structure)
//     • sentence formation, grammar, vocabulary, coherence and professionalism
//     • overall final verdict in a warm, celebratory tone (e.g. 'Outstanding performance!', 'Solid foundation with room to shine', etc.)
//     Make it feel premium and inspiring.",
//   "mistakes": [
//     {
//       "issue": "short clear description of ONE pronunciation issue",
//       "how_to_correct": "1-2 sentence practical tip"
//     }
//     // max 5 items, empty array if none or only minor
//   ]
// }

// CRITICAL RULES:
// - If no clear human voice or audio too short/silent → set pronunciationScore: 0, understandingScore: 0, transcription: "", mistakes: [], and friendly "no voice" messages in both feedbacks.
// - Pronunciation is evaluated on audio quality only (not against any script — user is speaking freely).
// - UnderstandingScore = accuracy of content match (60%) + sentence formation/grammar/coherence (40%).
// - Be strict on scores but always kind and constructive in feedback.
// - Use beautiful, professional language for the final verdict inside understandingFeedback.
// `;

//     const result = await model.generateContent([
//       { text: prompt },
//       {
//         inlineData: {
//           data: req.file.buffer.toString('base64'),
//           mimeType: "audio/wav"
//         }
//       }
//     ]);

//     const responseText = await result.response.text();
//     const data = JSON.parse(responseText);

//     // Optional safety: ensure required fields exist
//     if (!data.transcription) data.transcription = "";
//     if (!data.mistakes) data.mistakes = [];

//     res.json(data);
//   } catch (error) {
//     console.error("ERROR in /evaluate-pronunciation-and-understanding:", error.message);
//     res.status(500).json({
//       error: "Server error during analysis",
//       details: error.message
//     });
//   }
// });

// app.post('/evaluate', upload.single('audio'), async (req, res) => {
//   try {
//     const { targetText } = req.body;
//     if (!req.file) return res.status(400).json({ error: "No audio received" });
//     const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
//     const prompt = `
// Target Text: "${targetText}"

// You are a very very strict but helpful English pronunciation coach.
// rate very strictly, if bad below 40
// Do not autocorrect. 
// CRITICAL RULES:
// - If no clear human voice → 
//   {"score": 0, "overall_feedback": "No voice detected. Please speak clearly into the microphone.", "phonetic_target": "", "phonetic_heard": "", "mistakes": []}
// - Otherwise analyze phonetically with IPA.

// Return ONLY this JSON:

// {
//   "score": number (0-100),
//   "overall_feedback": "one short encouraging sentence",
//   "phonetic_target": "full IPA of target sentence",
//   "phonetic_heard": "full IPA of what you actually heard",
//   "mistakes": [
//     {
//       "word": "the word",
//       "user_pronunciation": "IPA you heard",
//       "correct_phoneme": "correct IPA",
//       "issue": "short description",
//       "how_to_correct": "how to fix it (1-2 sentences)"
//     }
//   ]
//  }
//  `;
//     const result = await model.generateContent([{ text: prompt }, { inlineData: { data: req.file.buffer.toString('base64'), mimeType: "audio/wav" } }]);
//     const data = JSON.parse(await result.response.text());
//     res.json(data);
//   } catch (error) {
//     console.error("ERROR:", error.message);
//     res.status(500).json({ error: "Server error", details: error.message });
//   }
// });
app.post('/get-user-progress', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    const user = await getUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ videoProgress: user.videoProgress || {} });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post('/save-video-progress', async (req, res) => {
  const { email, videoId, pronunciationScore, understandingScore, transcription, pronunciationFeedback, understandingFeedback, mistakes, completedAt } = req.body;

  if (!email || !videoId) return res.status(400).json({ error: "Missing email or videoId" });

  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.videoProgress) user.videoProgress = {};

    const avgScore = Math.round((pronunciationScore + understandingScore) / 2);

    user.videoProgress[videoId] = {
      pronunciationScore,
      understandingScore,
      avgScore,
      transcription: transcription || "",
      pronunciationFeedback,
      understandingFeedback,
      mistakes: mistakes || [],
      completedAt: completedAt || Date.now()
    };

    await putUser(user);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save progress" });
  }
});
app.post('/evaluate-pronunciation-and-understanding', upload.single('audio'), async (req, res) => {
  try {
    const summary = req.body.summary;
    if (!summary) {
      return res.status(400).json({ error: "No summary provided" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No audio received" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", // keep exactly what you already use
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
Target Summary: ${JSON.stringify(summary)}

You are a world-class English pronunciation coach, public speaking mentor, and content evaluator — strict yet highly encouraging.

Analyze the audio of the user explaining the video in their own words.
be very strict while giving the score

Return ONLY this exact JSON (no extra text, no markdown, no explanations):

{
  "transcription": "exact full transcription of what the user said (cleaned but 100% faithful). If no clear speech, use empty string.",
  "pronunciationScore": number (0-100, very strict: clarity, phonemes, intonation, pacing, fluency, accent issues),
  "pronunciationFeedback": "one short, encouraging paragraph (2-4 sentences) focused only on pronunciation, including tips on mispronounced words",
  "understandingScore": number (0-100),
  "understandingFeedback": "beautiful, motivational paragraph that covers:
    • how accurately the user matched the Target Summary (key points: hook, transition, credibility, structure)
    • sentence formation, grammar, vocabulary, coherence and professionalism
    • overall final verdict in a warm, celebratory tone (e.g. 'Outstanding performance!', 'Solid foundation with room to shine', etc.)
    Make it feel premium and inspiring.",
  "mistakes": [
    {
      "word": "the mispronounced word",
      "user_pronunciation": "human-readable phonetic spelling of what the user said for this word, using syllable separation with · (e.g., 'en·vai·uh·muhnt')",
      "correct_pronunciation": "correct human-readable phonetic spelling for the word, using syllable separation with · (e.g., 'en·vai·uh·muhnt')",
      "issue": "short clear description of the pronunciation issue",
      "how_to_correct": "1-2 sentence practical tip to improve"
    }
    // max 5 items, empty array if none or only minor. Focus on specific words that were mispronounced.
  ]
}

CRITICAL RULES:
- If no clear human voice or audio too short/silent → set pronunciationScore: 0, understandingScore: 0, transcription: "", mistakes: [], and friendly "no voice" messages in both feedbacks.
- Pronunciation is evaluated on audio quality only (not against any script — user is speaking freely). Use human-readable phonetic spellings (not IPA) in mistakes, with syllables separated by ·.
- UnderstandingScore = accuracy of content match (60%) + sentence formation/grammar/coherence (40%).
- Be strict on scores but always kind and constructive in feedback.
- Use beautiful, professional language for the final verdict inside understandingFeedback.
- For mistakes, only include entries for clearly mispronounced words, with accurate human-readable phonetic spellings for heard vs correct.
`;

    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: "audio/wav"
        }
      }
    ]);

    const responseText = await result.response.text();
    const data = JSON.parse(responseText);

    // Optional safety: ensure required fields exist
    if (!data.transcription) data.transcription = "";
    if (!data.mistakes) data.mistakes = [];

    res.json(data);
  } catch (error) {
    console.error("ERROR in /evaluate-pronunciation-and-understanding:", error.message);
    res.status(500).json({
      error: "Server error during analysis",
      details: error.message
    });
  }
});

app.post('/evaluate', upload.single('audio'), async (req, res) => {
  try {
    const { targetText } = req.body;
    if (!req.file) return res.status(400).json({ error: "No audio received" });
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });
    const prompt = `
Target Text: "${targetText}"

You are a very very strict but helpful English pronunciation coach.
rate very very strictly, if bad below 30
Do not autocorrect. 
CRITICAL RULES:
- If no clear human voice → 
  {"score": 0, "overall_feedback": "No voice detected. Please speak clearly into the microphone.", "phonetic_target": "", "phonetic_heard": "", "mistakes": []}
- Otherwise analyze phonetically with human-readable spellings.

Return ONLY this JSON:

{
  "score": number (0-100),
  "overall_feedback": "one short encouraging sentence",
  "phonetic_target": "full human-readable phonetic spelling of target sentence, using syllable separation with · (e.g., 'en·vai·uh·muhnt')",
  "phonetic_heard": "full human-readable phonetic spelling of what you actually heard, using syllable separation with · (e.g., 'en·vai·uh·muhnt')",
  "mistakes": [
    {
      "word": "the word",
      "user_pronunciation": "human-readable phonetic spelling you heard, using syllable separation with · (e.g., 'en·vai·uh·muhnt')",
      "correct_pronunciation": "correct human-readable phonetic spelling, using syllable separation with · (e.g., 'en·vai·uh·muhnt')",
      "issue": "short description",
      "how_to_correct": "how to fix it (1-2 sentences)"
    }
  ]
 }
 `;
    const result = await model.generateContent([{ text: prompt }, { inlineData: { data: req.file.buffer.toString('base64'), mimeType: "audio/wav" } }]);
    const data = JSON.parse(await result.response.text());
    res.json(data);
  } catch (error) {
    console.error("ERROR:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});



// 🔌 MongoDB Connection
// mongoose.connect(process.env.MONGO_URI)
//   .then(() => console.log("✅ Connected to MongoDB Atlas"))
//   .catch(err => console.error("❌ MongoDB Error:", err));
// // 📝 AI Judge Feedback Subschema (Per Role)
// const RoleFeedbackSchema = new mongoose.Schema({
//   feedbackText: { type: String, default: "" },
//   logic: { type: Number, default: 0 },
//   clarity: { type: Number, default: 0 },
//   relevance: { type: Number, default: 0 },
//   persuasiveness: { type: Number, default: 0 },
//   depth: { type: Number, default: 0 },
//   evidenceUsage: { type: Number, default: 0 },
//   emotionalAppeal: { type: Number, default: 0 },
//   rebuttalStrength: { type: Number, default: 0 },
//   structure: { type: Number, default: 0 },
//   overall: { type: Number, default: 0 }
// }, { _id: false });


// // 📝 AI Judge Feedback per team (Map of roles)
// const TeamFeedbackSchema = new mongoose.Schema({
//   pm: RoleFeedbackSchema,
//   dpm: RoleFeedbackSchema,
//   gw: RoleFeedbackSchema,
//   member: RoleFeedbackSchema,
//   whip: RoleFeedbackSchema,
//   lo: RoleFeedbackSchema,
//   dlo: RoleFeedbackSchema,
//   ow: RoleFeedbackSchema
// }, { _id: false });

// // 🧠 Full AI Judgement Subschema
// const AIFeedbackSchema = new mongoose.Schema({
//   proposition: TeamFeedbackSchema,
//   opposition: TeamFeedbackSchema,
//   winner: String,
//   reason: String
// }, { _id: false });

// // 🎤 Debate Role Schema
// const RoleSchema = new mongoose.Schema({
//   prep: String,
//   notes:{ type: String, default: "" },
//   transcript: [String],
//   summary: [String],
//   aifeedback: { type: RoleFeedbackSchema, default: () => ({}) },
  
// }, { _id: false });

// // 🗣️ Entry Schema for each debate
// const EntrySchema = new mongoose.Schema({
//   type: { type: String, default: "Beginner" },
//   debateType: { type: String, default: "1v1" }, // "1v1", "3v3", "5v5"
//   topic: String,
//   stance: String,
//   userrole: String,
//   createdAt: { type: Date, default: Date.now },
//   updatedAt: { type: Date, default: Date.now },

//   proposition: {
//     pm: RoleSchema,
//     dpm: RoleSchema,
//     gw: RoleSchema,
//     member: RoleSchema,
//     whip: RoleSchema
//   },

//   opposition: {
//     lo: RoleSchema,
//     dlo: RoleSchema,
//     ow: RoleSchema,
//     member: RoleSchema,
//     whip: RoleSchema
//   },

//   winner: { type: String, default: "" },
//   reason: { type: String, default: "" }
// }, { _id: false });


// // 👤 User Schema & Model
// const UserSchema = new mongoose.Schema({
//   displayName: String,
//   email: { type: String, unique: true },
//   password: String,
//   entries: {
//     type: Map,
//     of: EntrySchema,
//     default: {}
//   }
// });
// const User = mongoose.model("User", UserSchema);



// ✅ SIGNUP
// app.post('/api/signup', async (req, res) => {
//   try {
//     const { email, password, displayName } = req.body;
//     const existingUser = await User.findOne({ email });
//     if (existingUser) return res.status(400).json({ error: 'Email already exists' });

//     const hashedPassword = await bcrypt.hash(password, 10);
//     const newUser = await User.create({ email, password: hashedPassword, displayName });

//     res.status(201).json({ message: 'User created', user: { email, displayName } });
//   } catch (err) {
//     console.error("Signup error:", err);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// app.get('/api/ping', (req, res) => {
//   res.json({ message: 'pong 🏓 from Debattlex backend' });
// });

app.post('/api/signup', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    const existing = await getUser(email);
    if (existing) return res.status(400).json({ error: 'Email already exists' });
    const hashedPassword = await bcrypt.hash(password, 10);
    await putUser({ email, password: hashedPassword, displayName, entries: {} });
    res.status(201).json({ message: 'User created', user: { email, displayName } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/ping', (req, res) => res.json({ message: 'pong 🏓 from Debattlex backend' }));
app.get('/', (req, res) => res.send('<h1>✅ Debattlex Backend is Live!</h1>'));
 

// ✅ LOGIN
// app.post('/api/login', async (req, res) => {
//   try {
//     const { email, password } = req.body;
//     const user = await User.findOne({ email });
//     if (!user) return res.status(404).json({ error: 'User not found' });

//     const match = await bcrypt.compare(password, user.password);
//     if (!match) return res.status(401).json({ error: 'Invalid credentials' });

//     const token = jwt.sign({ id: user._id }, 'secret123', { expiresIn: '1d' });

//     res.json({
//       message: 'Login successful',
//       user: { email, displayName: user.displayName },
//       token
//     });
//   } catch (err) {
//     console.error("Login error:", err);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });const normalizeDebateType = (raw) => raw.replace(/\s+/g, '').toLowerCase();

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await getUser(email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: email }, 'secret123', { expiresIn: '1d' });
    res.json({ message: 'Login successful', user: { email, displayName: user.displayName }, token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const normalizeDebateType = (raw) => raw.replace(/\s+/g, '').toLowerCase();

app.get('/', (req, res) => {
  res.send('<h1>✅ Debattlex Backend is Live!</h1>');
});

// COMMIT BY ANIKET 
// ====================== CREATE NEW DEBATE ENTRY (Stepper calls this - POST) ======================
app.post('/api/userdata', async (req, res) => {
  const { email, entry } = req.body;
  if (!email || !entry || !entry.topic || !entry.debateType || !entry.stance || !entry.userrole) {
    return res.status(400).json({ error: 'Missing required fields: email, topic, debateType, stance, userrole' });
  }
  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let key = entry.topic.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
    let uniqueKey = key, counter = 1;
    while (user.entries?.[uniqueKey]) uniqueKey = `${key}_${counter++}`;

    const initializeRoleData = () => ({ prep: "", notes: "", transcript: [], summary: [], aifeedback: {} });
    const normalizedType = normalizeDebateType(entry.debateType);
    const roles = rolesByType[normalizedType] || { prop: ["pm"], opp: ["lo"] };

    const initializedEntry = {
      type: entry.type || "Beginner",
      debateType: normalizedType,
      topic: entry.topic,
      stance: entry.stance,
      userrole: entry.userrole,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      winner: "", reason: "",
      proposition: {}, opposition: {}
    };
    roles.prop.forEach(r => initializedEntry.proposition[r] = initializeRoleData());
    roles.opp.forEach(r => initializedEntry.opposition[r] = initializeRoleData());

    user.entries = user.entries || {};
    user.entries[uniqueKey] = initializedEntry;
    await putUser(user);

    res.status(200).json({ message: 'Entry saved', key: uniqueKey, entries: user.entries });
  } catch (err) {
    console.error('❌ Error saving user entry (POST):', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});



app.patch('/api/saveSummaries', async (req, res) => {
  const { email, summaries } = req.body;
  if (
    !email ||
    !summaries ||
    !summaries.topic ||
    !summaries.debateType ||
    !summaries.stance ||
    !summaries.userrole ||
    !Array.isArray(summaries.points)
  ) {
    return res.status(400).json({
      error: 'Missing required fields: email, topic, debateType, stance, userrole, points[]'
    });
  }
  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const key = summaries.topic.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
    if (!user.entries?.[key]) {
      return res.status(404).json({ error: 'Entry not found for this topic' });
    }

    const entry = user.entries[key];
    const teamKey = summaries.stance === "proposition" ? "proposition" : "opposition";
    const roleKey = summaries.userrole;

    if (!entry[teamKey] || !entry[teamKey][roleKey]) {
      return res.status(400).json({ error: `Role ${roleKey} not found in ${teamKey}` });
    }

    entry[teamKey][roleKey].summary.push(...summaries.points);
    entry.updatedAt = new Date().toISOString();

    await putUser(user);
    res.status(200).json({ message: 'Summaries saved successfully' });
  } catch (err) {
    console.error("❌ Error saving summaries:", err);
    res.status(500).json({ error: 'Failed to save summaries' });
  }
});



// ✅ FETCH ENTRIES (with support for role-based schema)
app.post('/api/fetchEntries', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await getUser(email);   // ← your DynamoDB getUser
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rawEntries = user.entries || {};

    const formattedEntries = Object.entries(rawEntries).reduce((acc, [topicKey, entry]) => {
      const stance = entry.stance?.toLowerCase() || 'proposition';
      const userrole = entry.userrole?.toLowerCase();
      const team = entry[stance] || {};
      const roleData = team?.[userrole] || {};

      acc[topicKey] = {
        type: entry.type || 'beginner',
        debateType: entry.debateType || '1v1',
        topic: entry.topic || topicKey.replace(/_/g, ' '),
        stance,
        userrole,
        createdAt: entry.createdAt || new Date(),
        updatedAt: entry.updatedAt || new Date(),
        winner: entry.winner || "Not determined",
        reason: entry.reason || "No reason provided",
        aiJudgeFeedback: entry.winner && entry.reason ? { winner: entry.winner, reason: entry.reason } : null,
        proposition: entry.proposition || {},
        opposition: entry.opposition || {},
        transcript: roleData.transcript || [],
        summary: roleData.summary || [],
        aifeedback: {
          feedbackText: roleData.aifeedback?.feedbackText || '',
          logic: roleData.aifeedback?.logic || 0,
          clarity: roleData.aifeedback?.clarity || 0,
          relevance: roleData.aifeedback?.relevance || 0,
          persuasiveness: roleData.aifeedback?.persuasiveness || 0,
          depth: roleData.aifeedback?.depth || 0,
          evidenceUsage: roleData.aifeedback?.evidenceUsage || 0,
          emotionalAppeal: roleData.aifeedback?.emotionalAppeal || 0,
          rebuttalStrength: roleData.aifeedback?.rebuttalStrength || 0,
          structure: roleData.aifeedback?.structure || 0,
          overall: roleData.aifeedback?.overall || 0
        }
      };
      return acc;
    }, {});

    // 🔥 SORTED so lastKey = latest debate (DynamoDB fix)
    const sortedEntries = Object.entries(formattedEntries)
      .sort(([, a], [, b]) => new Date(a.createdAt) - new Date(b.createdAt))
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});

    res.json({
      entries: sortedEntries,
      displayName: user.displayName || 'User',
      email: user.email,
      id: user.email
    });
  } catch (err) {
    console.error('❌ Error fetching entries:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});




app.post("/api/getStats", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await getUser(email);
    if (!user) return res.status(404).json({ message: "User not found" });
    const entries = Object.values(user.entries || {});
    const totalDebates = entries.length;
    let wins = 0, losses = 0;
    const winLossHistory = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const stance = entry.stance?.toLowerCase();
      const winner = entry.winner?.toLowerCase();
      if (stance && winner) {
        if (stance === winner) { wins++; winLossHistory.push({ index: i + 1, result: 'win' }); }
        else { losses++; winLossHistory.push({ index: i + 1, result: 'loss' }); }
      }
    }
    const winRate = totalDebates > 0 ? Math.round((wins / totalDebates) * 100) : 0;
    res.json({ totalDebates, winRate, wins, losses, winLossHistory });
  } catch (err) {
    console.error("Error in getStats:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// 🧠 Sarvam AI Integration
app.post('/ask', async (req, res) => {
  const { question, topic, stance, type, transcripts } = req.body;
  if (!question || !topic || !stance || !type || !Array.isArray(transcripts)) {
    return res.status(400).json({ error: 'Missing or invalid fields in /ask request' });
  }
  try {
    const context = `Debate Topic: ${topic}
Stance: ${stance}
Type: ${type}
Previous Transcripts:\n${transcripts.map(t => `${t.speaker}: ${t.text}`).join('\n')}
Now continue the debate based on the following user input:\n"${question}"`;
    const response = await client.chat.completions({ messages: [{ role: 'user', content: context }] });
    const answer = response.choices?.[0]?.message?.content || "No response from AI.";
    res.json({ answer });
  } catch (err) {
    console.error('Sarvam API Error:', err.message || err);
    res.status(500).json({ error: 'Failed to get response from Sarvam AI' });
  }
});



// 🧠 Transcript Summarization
app.post('/api/summarize-transcripts', async (req, res) => {
  const { userTranscripts, aiTranscripts } = req.body;
  if (!Array.isArray(userTranscripts) || !Array.isArray(aiTranscripts)) {
    return res.status(400).json({ error: 'userTranscripts and aiTranscripts must be arrays' });
  }
  try {
    const userText = userTranscripts.map(t => t.text).reverse().join(' ');
    const aiText = aiTranscripts.map(t => t.text).reverse().join(' ');
    const userPrompt = `Summarize user's arguments as very short bullet points: dont add extra points, its a debate it should be as it is\n${userText}`;
    const aiPrompt = `Summarize AI's arguments as very short bullet points:dont add extra points, its a debate it should be as it is\n${aiText}`;
    const [userRes, aiRes] = await Promise.all([
      client.chat.completions({ messages: [{ role: 'user', content: userPrompt }] }),
      client.chat.completions({ messages: [{ role: 'user', content: aiPrompt }] })
    ]);
    const userSummary = userRes.choices[0].message.content.trim();
    const aiSummary = aiRes.choices[0].message.content.trim();
    res.json({ userSummary, aiSummary });
  } catch (err) {
    console.error("❌ Sarvam summary API error:", err.message || err);
    res.status(500).json({ error: "Failed to generate summaries" });
  }
});


// 🎯 Topic Generator

app.post('/api/generate-debate-topic', async (req, res) => {
  const { interest } = req.body;
  if (!interest) return res.status(400).json({ error: 'Interest is required' });
  try {
    const prompt = `Generate only one thought-provoking debate topic with out ' " ' based on : "${interest}".`;
    const response = await client.chat.completions({ messages: [{ role: 'user', content: prompt }] });
    const generatedTopic = response.choices[0].message.content.trim();
    res.json({ generatedTopic });
  } catch (err) {
    console.error('Sarvam API Error:', err.message || err);
    res.status(500).json({ error: 'Failed to generate topic' });
  }
});



// ====================== /api/judge ======================
app.post("/api/judge", async (req, res) => {
  const { email, topic } = req.body;
  if (!email || !topic) return res.status(400).json({ error: 'Email and topic are required' });
  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const key = topic.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
    const entry = user.entries?.[key];
    if (!entry) return res.status(404).json({ error: 'Entry not found for this topic' });

    const systemPrompt = `
You are an AI debate judge. Evaluate the two arguments below on the topic "${topic}" using the following 10 criteria, scoring each from 0 to 10:
    
1. Logic
2. Clarity
3. Relevance
4. Persuasiveness
5. Depth
6. Evidence Usage
7. Emotional Appeal
8. Rebuttal Strength
9. Structure
10. Overall (average of the above 9)
if you get no transpript then return 0 for the above parameters
Return only the following JSON (no extra explanation):

{
  "user": {
    "feedbackText": "...",
    "logic": number,
    "clarity": number,
    "relevance": number,
    "persuasiveness": number,
    "depth": number,
    "evidenceUsage": number,
    "emotionalAppeal": number,
    "rebuttalStrength": number,
    "structure": number,
    "overall": number
  },
  "ai": {
    "feedbackText": "...",
    "logic": number,
    "clarity": number,
    "relevance": number,
    "persuasiveness": number,
    "depth": number,
    "evidenceUsage": number,
    "emotionalAppeal": number,
    "rebuttalStrength": number,
    "structure": number,
    "overall": number
  }
}`;

    const propositionRoles = ['pm', 'dpm', 'gw'];
    const oppositionRoles = ['lo', 'dlo', 'ow'];
    let propScore = 0, oppScore = 0;
    entry.aifeedback = { proposition: {}, opposition: {}, winner: "", reason: "" };
    const fullResult = {};

    for (let i = 0; i < 3; i++) {
      const proRole = propositionRoles[i];
      const oppRole = oppositionRoles[i];
      const proTranscript = (entry.proposition?.[proRole]?.transcript || []).join(" ");
      const oppTranscript = (entry.opposition?.[oppRole]?.transcript || []).join(" ");
      const input = `Debate Topic: ${topic}\n\nUser: ${proTranscript}\n\nAI: ${oppTranscript}`;
      const response = await client.chat.completions({ messages: [{ role: "system", content: systemPrompt }, { role: "user", content: input }] });
      const reply = response.choices[0].message.content;
      let parsed = JSON.parse(reply);
      const makeFb = (obj) => ({ feedbackText: obj.feedbackText || "", logic: obj.logic ?? 0, clarity: obj.clarity ?? 0, relevance: obj.relevance ?? 0, persuasiveness: obj.persuasiveness ?? 0, depth: obj.depth ?? 0, evidenceUsage: obj.evidenceUsage ?? 0, emotionalAppeal: obj.emotionalAppeal ?? 0, rebuttalStrength: obj.rebuttalStrength ?? 0, structure: obj.structure ?? 0, overall: obj.overall ?? 0 });
      const proFb = makeFb(parsed.user);
      const oppFb = makeFb(parsed.ai);
      entry.aifeedback.proposition[proRole] = proFb;
      entry.aifeedback.opposition[oppRole] = oppFb;
      fullResult[proRole] = proFb;
      fullResult[oppRole] = oppFb;
      propScore += proFb.overall;
      oppScore += oppFb.overall;
    }

    const winner = propScore > oppScore ? "Proposition" : "Opposition";
    const reasonRes = await client.chat.completions({ messages: [{ role: "user", content: `The proposition team scored ${propScore.toFixed(2)}. The opposition team scored ${oppScore.toFixed(2)}. Explain in 4 lines why "${winner}" won...` }] });
    const reasonText = reasonRes.choices[0].message.content.trim();

    entry.aifeedback.winner = winner;
    entry.aifeedback.reason = reasonText;
    user.entries[key] = entry;
    await putUser(user);   // ← your DynamoDB putUser

    res.json({ message: "All roles judged and result saved.", result: { ...fullResult, propositionScore: propScore, oppositionScore: oppScore, winner, reason: reasonText } });
  } catch (err) {
    console.error("❌ Judging failed:", err.message);
    res.status(500).json({ error: "Judging error" });
  }
});



app.get('/api/fetchJudgement', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // 1. Get the user
    const user = await getUser(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Get all entries (they are in user.entries object)
    const entries = user.entries || {};

    if (Object.keys(entries).length === 0) {
      return res.status(404).json({ error: 'No entries found for this user' });
    }

    // 3. Find the latest entry by comparing createdAt
    let latestEntry = null;
    let latestDate = null;

    for (const [topicKey, entry] of Object.entries(entries)) {
      const created = new Date(entry.createdAt);
      if (!latestDate || created > latestDate) {
        latestDate = created;
        latestEntry = entry;
        latestEntry.topicKey = topicKey; // optional - if frontend needs the key
      }
    }

    if (!latestEntry) {
      return res.status(404).json({ error: 'No entry found' });
    }

    // 4. Build the response (same structure as before)
    const result = {
      winner: latestEntry.winner || null,
      reason: latestEntry.reason || null,
      topic: latestEntry.topic || null,
      proposition: latestEntry.aifeedback?.proposition || {},
      opposition: latestEntry.aifeedback?.opposition || {},
    };

    const userRole = latestEntry.userrole?.toLowerCase();
    const teamSide = latestEntry.stance?.toLowerCase(); // assuming stance = "proposition" or "opposition"

    if (teamSide && userRole && latestEntry.aifeedback?.[teamSide]?.[userRole]) {
      const userFeedback = latestEntry.aifeedback[teamSide][userRole];
      result.user = {
        ...userFeedback,
        role: userRole,
        team: teamSide,
      };
    }

    // Optional: log for debugging
    console.log("📦 Judgement Result Sent to Client:", JSON.stringify(result, null, 2));

    return res.json({ result });
  } catch (err) {
    console.error('Error fetching judgement:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



// In your server file (e.g., server.js or routes.js)
// 🧠 Save Judgement Route
// ✅ Route: Save AI Judgement

app.post('/api/save-judgement', async (req, res) => {
  const { email, topicKey, judgeResult } = req.body;
  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.entries?.[topicKey]) return res.status(404).json({ error: "Topic entry not found" });

    const entry = user.entries[topicKey];
    const rolesMap = { pm: 'proposition', dpm: 'proposition', gw: 'proposition', lo: 'opposition', dlo: 'opposition', ow: 'opposition' };

    for (const [role, team] of Object.entries(rolesMap)) {
      const roleFeedback = judgeResult[role];
      if (!roleFeedback) continue;
      const feedback = {
        feedbackText: roleFeedback.feedbackText || 'yes',
        logic: roleFeedback.logic ?? 0,
        clarity: roleFeedback.clarity ?? 0,
        relevance: roleFeedback.relevance ?? 0,
        persuasiveness: roleFeedback.persuasiveness ?? 0,
        depth: roleFeedback.depth ?? 0,
        evidenceUsage: roleFeedback.evidenceUsage ?? 0,
        emotionalAppeal: roleFeedback.emotionalAppeal ?? 0,
        rebuttalStrength: roleFeedback.rebuttalStrength ?? 0,
        structure: roleFeedback.structure ?? 0,
        overall: roleFeedback.overall ?? 0,
      };
      if (entry[team]?.[role]) entry[team][role].aifeedback = feedback;
    }

    entry.winner = judgeResult.winner || '';
    entry.reason = judgeResult.reason || '';
    user.entries[topicKey] = entry;
    await putUser(user);
    res.status(200).json({ message: "Judgement saved successfully" });
  } catch (err) {
    console.error("❌ Error saving judgement:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ✅ Route: Generate AI Speech
app.post('/api/generateAISpeech', async (req, res) => {
  const { email, role, team, topic, topicSlug, prep = "", previousSummaries = "" } = req.body;

  if (!email || !role || !team || (!topic && !topicSlug)) {
    return res.status(400).json({ error: 'Missing required fields: email, role, team, topic/topicSlug' });
  }

  try {
    const prompt = `As ${role} of the ${team === 'prop' ? 'Proposition' : 'Opposition'} team in an Asian Parliamentary debate, deliver a strong 30s speech on the topic: "${topic}". Use the following preparation as context: "${prep}". Consider the following previous summaries and reply to them if needed: "${previousSummaries}". Speak in first person. Use a logical and persuasive tone.`;

    const response = await client.chat.completions({
      messages: [{ role: 'user', content: prompt }],
      model: "sarvam-llama-2",
      temperature: 0.7
    });

    const transcript = response.choices?.[0]?.message?.content?.trim();

    if (!transcript || transcript.length < 10) {
      console.error("Empty or invalid transcript from Sarvam");
      return res.status(500).json({ error: 'Failed to generate valid speech from AI' });
    }

    // Save to DynamoDB (persistent!)
    let user = await getUser(req.body.email); // ← add email to req.body from frontend if needed
    if (!user) return res.status(404).json({ error: 'User not found - email required' });

    const topicSlug = topic.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
    if (!user.entries?.[topicSlug]) return res.status(404).json({ error: 'Debate entry not found' });

    const entry = user.entries[topicSlug];
    const teamKey = team === 'prop' ? 'proposition' : 'opposition';

    if (!entry[teamKey]) entry[teamKey] = {};
    if (!entry[teamKey][role]) entry[teamKey][role] = { prep: "", transcript: [], summary: [], aifeedback: {} };

    // Append transcript (array)
    entry[teamKey][role].transcript.push(transcript);
    entry.updatedAt = new Date().toISOString();

    await putUser(user);

    console.log(`✅ AI speech saved for ${team}/${role}: ${transcript.substring(0, 50)}...`);

    res.status(200).json({ transcript });
  } catch (err) {
    console.error("❌ /api/generateAISpeech error:", err.message, err.stack);
    res.status(500).json({ error: 'Failed to generate AI speech' });
  }
});


// ✅ Route: Generate Summary
// ✅ Route: Generate Summary (DEBUG + FIXED version)
// ✅ Route: Generate Summary (FINAL FIXED VERSION)
// ✅ FIXED: /api/generateSummary (robust, matches your judge style, works with DynamoDB)
app.post('/api/generateSummary', async (req, res) => {
  const { transcript, role, team, topic } = req.body;

  if (!transcript || transcript.trim().length < 5) {
    return res.status(400).json({ error: 'Transcript too short or missing' });
  }

  try {
    const systemPrompt = `
You are a professional debate summarizer. 
Summarize the ${role.toUpperCase()} (${team}) speech on topic "${topic || 'the debate'}" 
into 4-6 clear, concise bullet points. 
Return ONLY a valid JSON array of strings. No extra text, no explanation.

Example: 
["Strong point on economy", "Rebuttal to opposition claim", "Key evidence used"]

Speech:
${transcript}
`;

    const response = await client.chat.completions({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Summarize now." }
      ]
    });

    let reply = response.choices[0].message.content.trim();
    reply = reply.replace(/```json|```/g, '').trim();

    let summaryArray;
    try {
      summaryArray = JSON.parse(reply);
      if (!Array.isArray(summaryArray)) throw new Error();
    } catch {
      // Fallback if JSON fails
      summaryArray = reply
        .split('\n')
        .map(line => line.replace(/^[-•*\s]+/, '').trim())
        .filter(line => line.length > 5);
    }

    if (summaryArray.length === 0) {
      summaryArray = ["Main arguments delivered effectively."];
    }

    res.json({ summary: summaryArray });

  } catch (err) {
    console.error('❌ Summary generation failed:', err.message);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// ✅ Optional: Get full memory state
app.get('/api/debateData', (req, res) => {
  res.json(debateStorage);
});

app.post("/api/userdata3v3", async (req, res) => {
  const { email, topicSlug, team, role, transcript, summary } = req.body;
  if (!email || !topicSlug || !team || !role || !transcript || !summary) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.entries = user.entries || {};
    if (!user.entries[topicSlug]) {
      user.entries[topicSlug] = {
        topic: topicSlug.replace(/_/g, ' '),
        type: "Beginner",
        debateType: "3v3",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    const entry = user.entries[topicSlug];
    const targetTeam = team.toLowerCase();
    const targetRole = role.toLowerCase();

    if (!entry[targetTeam]) entry[targetTeam] = {};
    if (!entry[targetTeam][targetRole]) {
      entry[targetTeam][targetRole] = { transcript: [], summary: [] };
    }

    entry[targetTeam][targetRole].transcript.push(transcript);
    entry[targetTeam][targetRole].summary.push(...(Array.isArray(summary) ? summary : [summary]));

    entry.updatedAt = new Date().toISOString();
    await putUser(user);

    res.status(200).json({ message: "3v3 entry updated", topicSlug });
  } catch (err) {
    console.error("❌ Error updating 3v3 entry:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Save Role Transcript and Summary
// ✅ UPDATED: Save Role Transcript and Summary (DynamoDB safe version)
// ✅ UPDATED: Save Role Transcript and Summary (DynamoDB safe version)
app.post('/api/saveRoleTranscript', async (req, res) => {
  const { email, topicSlug, team, role, transcript, summary } = req.body;
  if (!email || !topicSlug || !team || !role || !transcript) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.entries = user.entries || {};
    if (!user.entries[topicSlug]) return res.status(404).json({ message: 'Topic not found' });

    const entry = user.entries[topicSlug];
    const roleLower = role.toLowerCase();   // ensures 'pm', 'lo', etc. (matches your DB)

    // 🔥 Auto-create if missing (this was the missing piece)
    if (!entry[team]) entry[team] = {};
    if (!entry[team][roleLower]) {
      entry[team][roleLower] = { transcript: [], summary: [] };
    }

    const roleBlock = entry[team][roleLower];

    if (!Array.isArray(roleBlock.transcript)) roleBlock.transcript = [];
    roleBlock.transcript.push(transcript);

    // summary can be array or string
    roleBlock.summary = Array.isArray(summary) ? summary : [summary || ''];

    entry.updatedAt = new Date().toISOString();
    await putUser(user);

    console.log(`✅ Saved for ${team}.${roleLower} (3v3)`);
    res.status(200).json({ message: 'Transcript and summary saved successfully' });
  } catch (err) {
    console.error('❌ Error saving transcript:', err);
    res.status(500).json({ message: 'Server error' });
  }
});




// Minimal schema setup for user
app.patch('/api/savePrep', async (req, res) => {
  const { email, topic, stance, debateType, userrole, userPrep, teammates } = req.body;
  const topicKey = topic.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.entries = user.entries || {};
    if (!user.entries[topicKey]) {
      user.entries[topicKey] = {
        topic,
        type: debateType,
        stance,
        userrole,
        proposition: {},
        opposition: {}
      };
    }

    const entry = user.entries[topicKey];
    const teamKey = stance === 'proposition' ? 'proposition' : 'opposition';

    if (!entry[teamKey]) entry[teamKey] = {};
    if (!entry[teamKey][userrole]) {
      entry[teamKey][userrole] = { prep: "", transcript: [], summary: [] };
    }
    entry[teamKey][userrole].prep = userPrep;

    teammates.forEach(({ role, prep }) => {
      if (!entry[teamKey][role]) {
        entry[teamKey][role] = { prep: "", transcript: [], summary: [] };
      }
      entry[teamKey][role].prep = prep;
    });

    entry.updatedAt = new Date().toISOString();
    await putUser(user);

    res.status(200).json({ message: "Prep saved successfully." });
  } catch (err) {
    console.error("❌ savePrep error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post('/api/userentry', async (req, res) => {
  const { email, topic } = req.body;
  if (!email || !topic) {
    return res.status(400).json({ error: "Missing email or topic" });
  }
  const topicKey = topic.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, '_');
  try {
    const user = await getUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const entry = user.entries?.[topicKey];
    if (!entry) return res.status(404).json({ error: "Topic entry not found" });

    return res.status(200).json({ entry });
  } catch (err) {
    console.error("❌ POST /api/userentry error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});



// Dummy teammate responses for role-based simulation
const teammateResponses = {
  teammate1: [
    "Let's begin with a solid foundation for our arguments.",
    "I'll ensure to handle logical fallacies and contradictions from the opposition.",
    "Don't forget to define key terms clearly in your opening."
  ],
  teammate2: [
    "I'll summarize our stance by tying back to the motion.",
    "I'll emphasize the long-term impacts of our argument.",
    "I'll highlight contradictions in the opposition's case during summary."
  ]
};

// Main endpoint for AI teammate simulation


// Route: Fetch user and debate entry
app.get('/api/getUserDebateData', async (req, res) => {
  const { email } = req.query;
  try {
    const user = await getUser(email);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});



const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const SARVAM_API_URL = 'https://api.sarvam.ai/v1/chat/completions';
app.post('/api/teama', async (req, res) => {
  const { userInput, topic = 'General debate', role, stance = 'Neutral' } = req.body;

  if (!userInput || !role) {
    return res.status(400).json({ error: 'Missing userInput or role in /api/teammate' });
  }

  const prompt = `You are a AI debate teammate.
Debate Topic: ${topic}
Side: ${stance}
Role: ${role}
Teammate said: "${userInput}"
Suggest  ideas, present your point of view, answer in first person in short 40words, in informal`;

  try {
    const fetchResponse = await fetch(process.env.SARVAM_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SARVAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      }),
    });

    if (!fetchResponse.ok) {
      const errText = await fetchResponse.text();
      throw new Error(`Sarvam API error: ${fetchResponse.status} ${fetchResponse.statusText} — ${errText}`);
    }

    const data = await fetchResponse.json();
    const result = data.choices?.[0]?.message?.content || 'No response from Sarvam AI';
    res.json({ result });
  } catch (err) {
    console.error('Sarvam API Error (/api/teammate):', err.message || err);
    res.status(500).json({ error: `Failed to get response from Sarvam AI: ${err.message}` });
  }
});




//caseprep


// /api/teamma — Strategic teammate suggestions

app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!process.env.SARVAM_API_URL) {
  console.error('❌ SARVAM_API_URL is not set in .env');
}

  if (!query) {
    return res.status(400).json({ error: 'Missing query in /api/search' });
  }

  const prompt = `You are a research assistant for a debate preparation tool. Provide concise, relevant evidence, statistics, or case studies for the following query: "${query}"`;

  try {
    const fetchResponse = await fetch(process.env.SARVAM_API_URL, {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      throw new Error(`Sarvam API error: ${fetchResponse.status} ${fetchResponse.statusText} — ${errorText}`);
    }

    const data = await fetchResponse.json();
    const result = data.choices?.[0]?.message?.content || 'No results found.';
    res.json({ result });
  } catch (err) {
    console.error('Sarvam API Error (/api/search):', err.message || err);
    res.status(500).json({
      error: `Failed to get search results from Sarvam AI: ${err.message}`,
    });
  }
});

app.post('/api/teamma', async (req, res) => {
  const { userInput, topic = 'General debate', role, stance = 'Neutral' } = req.body;

  if (!userInput || !role) {
    return res.status(400).json({ error: 'Missing userInput or role in /api/teammate' });
  }

  const prompt = `You are a  AI debate teammate.
Debate Topic: ${topic}
Side: ${stance}
Role: ${role}
Teammate said: "${userInput}"
Suggest strategic ideas, questions to consider, or relevant points. start by hara krishna`;

  try {
    const response = await client.chat.completions({
      messages: [{ role: 'user', content: prompt }]
    });

    const result = response.choices?.[0]?.message?.content || 'No response from Sarvam AI';
    res.json({ result });
  } catch (err) {
    console.error('Sarvam API Error (/api/teammate):', err.message || err);
    res.status(500).json({ error: `Failed to get response from Sarvam AI` });
  }
});




// /api/summarize — Concise summarizer
app.post('/api/summarize', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Missing text in /api/summarize' });
  }

  const prompt = `Summarize this text in 1-2 short sentences, max 50 characters: "${text}"`;

  try {
    const response = await client.chat.completions({
      messages: [
        { role: 'system', content: 'You are an AI that summarizes text concisely.' },
        { role: 'user', content: prompt }
      ]
    });

    const summary = response.choices?.[0]?.message?.content || 'No summary generated.';
    res.json({ summary });
  } catch (err) {
    console.error('Sarvam API Error (/api/summarize):', err.message || err);
    res.status(500).json({ error: `Failed to summarize text` });
  }
});

app.post('/api/factcheck', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Missing text in /api/factcheck' });
  }

  const prompt = `You are a fact-checking AI. Verify the accuracy of the following text and provide a concise assessment of its factual correctness, including any corrections or clarifications if needed: "${text}"`;

  try {
    const response = await client.chat.completions({
      messages: [
        { role: 'system', content: 'You are an AI that verifies facts accurately.' },
        { role: 'user', content: prompt }
      ]
    });

    const result = response.choices?.[0]?.message?.content || 'No fact-check results available.';
    res.json({ result });
  } catch (err) {
    console.error('Sarvam API Error (/api/factcheck):', err.message || err);
    res.status(500).json({ error: `Failed to fact-check text` });
  }
});

app.post('/api/caseprepfetchdata', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      console.error('❌ Request missing email');
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await getUser(email);
    if (!user) {
      console.error(`❌ User not found for email: ${email}`);
      return res.status(404).json({ error: 'User not found' });
    }

    const entries = user.entries || {};
    const entryKeys = Object.keys(entries);

    if (entryKeys.length === 0) {
      console.error(`❌ No entries found for user: ${email}`);
      return res.status(404).json({ error: 'No debate entries found for this user' });
    }

    // Find the latest entry by comparing createdAt
    let latestKey = entryKeys[0];
    let latestDate = new Date(entries[latestKey].createdAt || 0);

    for (const key of entryKeys) {
      const created = new Date(entries[key].createdAt || 0);
      if (created > latestDate) {
        latestDate = created;
        latestKey = key;
      }
    }

    const latestEntry = entries[latestKey];

    const topicSlug = latestKey || 'Untitled Debate Topic';
    const topic = latestEntry.topic || latestKey.replace(/_/g, ' ') || 'Untitled Debate Topic';
    const userRole = latestEntry.userrole || 'PM';
    const stance = latestEntry.stance || "dont know";
    const proposition = latestEntry.proposition || {};
    const opposition = latestEntry.opposition || {};

    // Debug logging (keep it for now)
    console.log('🟢 Proposition Summaries:', proposition);
    console.log('🔴 Opposition Summaries:', opposition);

    return res.json({
      topic,
      userRole,
      stance,
      proposition,
      opposition,
      topicSlug
    });
  } catch (err) {
    console.error(`❌ Internal error while fetching case prep data for ${req.body?.email}:`, err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



// /api/caseprepsummariser endpoint (no authMiddleware)
app.post('/api/caseprepsummariser', async (req, res) => {
  const { transcript, role, topic = 'General debate' } = req.body;

  if (!transcript || !role) {
    return res.status(400).json({ error: 'Missing transcript or role in /api/caseprepsummariser' });
  }

  const prompt = `You are an AI debate assistant summarizing a team member's transcript.
Debate Topic: ${topic}
Role: ${role}
Transcript: "${transcript}"
Summarize the transcript into exactly three key points to highlight in the main debate, each point being a concise sentence. Return the points as a JSON array, e.g., ["Point 1", "Point 2", "Point 3"].`;

  try {
    const fetchResponse = await fetch(process.env.SARVAM_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SARVAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sarvam-m',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      }),
    });

    if (!fetchResponse.ok) {
      const errText = await fetchResponse.text();
      throw new Error(`Sarvam API error: ${fetchResponse.status} ${fetchResponse.statusText} — ${errText}`);
    }

    const data = await fetchResponse.json();
    let highlights = data.choices?.[0]?.message?.content || '[]';

    try {
      highlights = JSON.parse(highlights);
      if (!Array.isArray(highlights) || highlights.length !== 3 || !highlights.every(h => typeof h === 'string')) {
        throw new Error('Highlights must be an array of exactly three strings');
      }
    } catch (err) {
      console.warn('Invalid JSON format, attempting to parse as text:', highlights);
      // Fallback: Split text into sentences and take first three
      const sentences = highlights.match(/[^.!?]+[.!?]+/g) || [highlights];
      highlights = sentences.slice(0, 3).map(s => s.trim());
      if (highlights.length < 3) {
        // Pad with placeholders if fewer than three sentences
        while (highlights.length < 3) {
          highlights.push('Summary point not available');
        }
      }
    }

    res.json({ highlights });
  } catch (err) {
    console.error('Sarvam API Error (/api/caseprepsummariser):', err.message || err);
    res.status(500).json({ error: `Failed to summarize transcript: ${err.message}` });
  }
});



// /api/saveSummary endpoint
// /api/saveSummary endpoint

// /api/saveSummary endpoint
// /api/saveSummary endpoint
app.post('/api/saveSummary', async (req, res) => {
  const { email, topic, topicSlug, team, role, highlights } = req.body;
  console.log('📝 /api/saveSummary: Received request:', { email, topic, topicSlug, team, role, highlights });

  if (!email || !topic || !topicSlug || !team || !role || !highlights) {
    console.error('❌ /api/saveSummary: Missing required fields');
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const validTeams = ['proposition', 'opposition'];
  const validRoles = team === 'proposition' ? ['pm', 'dpm', 'gw'] : ['lo', 'dlo', 'ow'];

  if (!validTeams.includes(team)) {
    return res.status(400).json({ message: `Invalid team: ${team}` });
  }
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: `Invalid role: ${role}` });
  }

  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.entries = user.entries || {};
    if (!user.entries[topicSlug]) return res.status(404).json({ message: 'Topic not found' });

    const entry = user.entries[topicSlug];
    if (!entry[team] || !entry[team][role]) {
      return res.status(400).json({ message: `Invalid team or role` });
    }

    const newPrep = Array.isArray(highlights) ? highlights.join(' ') : String(highlights || '');
    entry[team][role].prep = newPrep;
    entry.updatedAt = new Date().toISOString();

    await putUser(user);
    res.json({ message: 'Summary saved successfully' });
  } catch (err) {
    console.error('❌ /api/saveSummary error:', err);
    res.status(500).json({ message: 'Failed to save summary' });
  }
});

// /api/saveNotes endpoint
app.post('/api/saveNotes', async (req, res) => {
  const { email, topic, topicSlug, team, role, notes } = req.body;
  if (!email || !topic || !topicSlug || !team || !role || notes === undefined) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  try {
    let user = await getUser(email);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.entries = user.entries || {};
    if (!user.entries[topicSlug]) return res.status(404).json({ message: 'Topic not found' });

    const entry = user.entries[topicSlug];
    if (!entry[team] || !entry[team][role]) return res.status(400).json({ message: 'Invalid team or role' });

    entry[team][role].notes = notes;
    entry.updatedAt = new Date().toISOString();

    await putUser(user);
    res.json({ message: 'Notes saved successfully' });
  } catch (err) {
    console.error('Error saving notes:', err);
    res.status(500).json({ message: 'Failed to save notes' });
  }
});

app.get('/api/fetchNotes', async (req, res) => {
  try {
    const { email, topic, topicSlug, team, role } = req.query;
    if (!['pm', 'dpm', 'gw', 'lo', 'dlo', 'ow'].includes(role)) {
      return res.status(400).json({ status: 'fail', message: 'Invalid role value' });
    }

    const user = await getUser(email);
    if (!user) return res.status(404).json({ status: 'fail', message: 'User not found' });

    const entry = user.entries?.[topicSlug];
    if (!entry) return res.status(404).json({ status: 'fail', message: 'Topic not found' });

    if (!entry[team]) return res.status(400).json({ status: 'fail', message: 'Invalid team' });
    if (!entry[team][role]) return res.status(400).json({ status: 'fail', message: 'Role not found in team' });

    const notes = entry[team][role].notes || '';
    res.status(200).json({ status: 'success', notes });
  } catch (err) {
    console.error('Error fetching notes:', err);
    res.status(500).json({ status: 'fail', message: 'Failed to fetch notes' });
  }
});

//ranking
// API Endpoint to Get Rankings
app.get('/api/rankings', async (req, res) => {
  try {
    const allUsers = await scanAllUsers();

    const rankings = allUsers.map(user => {
      const entries = Object.values(user.entries || {});
      const totalDebates = entries.length;
      let wins = 0;
      for (const entry of entries) {
        const stance = entry.stance?.toLowerCase();
        const winner = entry.winner?.toLowerCase();
        if (stance && winner && stance === winner) wins++;
      }
      const winRate = totalDebates > 0 ? Math.round((wins / totalDebates) * 100) : 0;
      return {
        displayName: user.displayName || 'Anonymous',
        wins,
        totalDebates,
        winRate
      };
    });

    // Sort by winRate desc, then wins desc
    rankings.sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);

    const top10 = rankings.slice(0, 10);

    // Current user rank (hardcoded example - replace with real auth later)
    const currentUserDisplayName = 'Bhushan'; // ← change this or use auth
    const currentUser = rankings.find(r => r.displayName === currentUserDisplayName);
    const currentUserRankInfo = currentUser ? { ...currentUser, rank: rankings.indexOf(currentUser) + 1 } : null;

    res.json({ top10, currentUser: currentUserRankInfo });
  } catch (error) {
    console.error('Error fetching rankings:', error);
    res.status(500).json({ error: 'Failed to fetch rankings' });
  }
});

// ====================== NEW: SAVE TRANSCRIPTS + SUMMARIES (DynamoDB) ======================
app.post('/api/save-transcripts', async (req, res) => {
  const { email, topicKey, userRole, userTranscripts, aiTranscripts, userSummary, aiSummary, userStance } = req.body;

  if (!email || !topicKey || !userRole) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    let user = await getUser(email);
    if (!user || !user.entries?.[topicKey]) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const entry = user.entries[topicKey];
    const userTeam = userStance.toLowerCase();
    const aiTeam = userTeam === 'proposition' ? 'opposition' : 'proposition';

    // AI gets the matching opposite role (pm↔lo, dpm↔dlo, gw↔ow)
    const roleMap = { pm: 'lo', dpm: 'dlo', gw: 'ow', lo: 'pm', dlo: 'dpm', ow: 'gw' };
    const aiRole = roleMap[userRole.toLowerCase()] || 'lo';

    const userRoleLower = userRole.toLowerCase();

    // Ensure objects exist
    if (!entry[userTeam]) entry[userTeam] = {};
    if (!entry[userTeam][userRoleLower]) entry[userTeam][userRoleLower] = { transcript: [], summary: [] };
    if (!entry[aiTeam]) entry[aiTeam] = {};
    if (!entry[aiTeam][aiRole]) entry[aiTeam][aiRole] = { transcript: [], summary: [] };

    // Append full history
    entry[userTeam][userRoleLower].transcript = [
      ...(entry[userTeam][userRoleLower].transcript || []),
      ...userTranscripts
    ];
    entry[aiTeam][aiRole].transcript = [
      ...(entry[aiTeam][aiRole].transcript || []),
      ...aiTranscripts
    ];

    // Save latest summaries (overwrites with current summary of recent turns)
    entry[userTeam][userRoleLower].summary = userSummary || [];
    entry[aiTeam][aiRole].summary = aiSummary || [];

    user.entries[topicKey] = entry;
    await putUser(user);

    res.json({ message: 'Transcripts and summaries saved successfully' });
  } catch (err) {
    console.error('❌ Save transcripts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🚀 Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} (DynamoDB - Users table only)`));

